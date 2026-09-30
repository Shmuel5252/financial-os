<#
  Owner-run S9: wires the STAGING app (the Production environment of the Vercel staging project) to the deletion ledger.
  Values never appear on screen, in chat or in shell history: the ledger key goes from SSM straight to Vercel, the ledger-app
  password is read with a hidden prompt, and each value is handed to `vercel env add` through a private temporary file with no
  trailing newline that is deleted immediately. Fail-fast; one step per run.
    -Step check      Read-only: Vercel login and linked project, which ledger variable NAMES exist, SSM parameter names.
    -Step apply      Proves the ledger-app credential with scripts/ledger-privilege-check.mjs (changes nothing) BEFORE touching
                     Vercel, then adds FINANCIAL_OS_LEDGER_MONGODB_URI, FINANCIAL_OS_DELETION_LEDGER_KEY_V1 (sensitive),
                     FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION, FINANCIAL_OS_LEDGER_DATABASE and, if absent,
                     FINANCIAL_OS_ENVIRONMENT=staging. Refuses if any ledger variable already exists.
    -Step unusable   Fail-closed test: points FINANCIAL_OS_LEDGER_DATABASE at a database ledger-app may not read (no secret touched).
    -Step restore    Points FINANCIAL_OS_LEDGER_DATABASE back to deletion_ledger.
    -Step rollback   Removes the four ledger variables (the app returns to "no ledger configured").
  Every change takes effect on the next redeploy of the staging Production deployment.
  The Vercel link lives outside the repository (-LinkDir), so nothing here can deploy local files.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\vercel-ledger-env.ps1 -Step <check|apply|unusable|restore|rollback>
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("check", "apply", "unusable", "restore", "rollback")][string]$Step,
  [string]$LinkDir = (Join-Path $env:LOCALAPPDATA "financial-os-vercel-staging"),
  [string]$AwsProfile = "financial-os",
  [string]$Region = "eu-central-1"
)
$ErrorActionPreference = "Stop"
$env:AWS_RETRY_MODE = "standard"; $env:AWS_MAX_ATTEMPTS = "10"
$repo = Split-Path $PSScriptRoot -Parent
$ledgerNames = "FINANCIAL_OS_LEDGER_MONGODB_URI", "FINANCIAL_OS_DELETION_LEDGER_KEY_V1", "FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION", "FINANCIAL_OS_LEDGER_DATABASE"
function Invoke-Aws {
  $output = & aws @args --profile $AwsProfile --region $Region
  if ($LASTEXITCODE -ne 0) { throw "aws $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
  $output
}
function Invoke-Vercel {
  # vercel writes status lines to stderr; under Stop those would become terminating errors, so merge them here.
  $ErrorActionPreference = "Continue"
  Push-Location $LinkDir
  try { $output = & vercel @args 2>&1 | ForEach-Object { "$_" } | Out-String; $code = $LASTEXITCODE } finally { Pop-Location }
  if ($code -ne 0) { throw "vercel $($args[0]) $($args[1]) failed (exit $code)" }
  $output
}
function Present-Names {
  $table = Invoke-Vercel env ls production
  @("FINANCIAL_OS_ENVIRONMENT") + $ledgerNames | Where-Object { $table -match "(?m)^\s*$_\s" }
}
# The value reaches vercel through stdin redirection from a file with exactly its bytes (no newline), then the file is deleted.
function Add-Env([string]$name, [string]$value, [switch]$Sensitive) {
  $file = Join-Path $script:private ([guid]::NewGuid().ToString("n"))
  [IO.File]::WriteAllText($file, $value, (New-Object System.Text.UTF8Encoding($false)))
  try {
    $flag = if ($Sensitive) { " --sensitive" } else { "" }
    Push-Location $LinkDir
    try { $output = cmd /c "vercel env add $name production$flag < `"$file`" 2>&1" | Out-String; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { throw "vercel env add $name failed (exit $code): $($output.Trim())" }
  } finally { Remove-Item $file -Force -ErrorAction SilentlyContinue }
  "added: $name"
}
function Remove-Env([string]$name) { Invoke-Vercel env rm $name production --yes | Out-Null; "removed: $name" }
try {
  if (-not (Test-Path (Join-Path $LinkDir ".vercel\project.json"))) {
    throw "no Vercel link in $LinkDir - run once: New-Item -ItemType Directory -Force '$LinkDir'; Set-Location '$LinkDir'; vercel link  (choose the staging project), then Set-Location back"
  }
  $project = Get-Content (Join-Path $LinkDir ".vercel\project.json") -Raw | ConvertFrom-Json
  "vercel: $(((Invoke-Vercel whoami) -split "`r?`n" | Where-Object { $_ -and $_ -notmatch '^Vercel CLI' } | Select-Object -Last 1).Trim()) / project $(if ($project.projectName) { $project.projectName } else { $project.projectId })"

  if ($Step -eq "check") {
    $present = @(Present-Names)
    "production variables present: $(if ($present) { $present -join ', ' } else { 'none of the ledger/environment names' })"
    $ssm = Invoke-Aws ssm describe-parameters --parameter-filters "Key=Name,Option=BeginsWith,Values=/financial-os/staging/ledger/" --query "Parameters[].[Name,Type]" --output text
    "ssm ledger parameters:"; $ssm
    "check: ok (read-only)"
  }

  if ($Step -eq "apply") {
    $present = @(Present-Names | Where-Object { $_ -ne "FINANCIAL_OS_ENVIRONMENT" })
    if ($present) { throw "already present: $($present -join ', ') - run -Step rollback first if you mean to replace them" }
    $active = (Invoke-Aws ssm get-parameter --name /financial-os/staging/ledger/key-active-version --query Parameter.Value --output text).Trim()
    if ($active -notmatch '^[1-9][0-9]{0,2}$') { throw "unexpected ledger key active version" }
    $key = (Invoke-Aws ssm get-parameter --name "/financial-os/staging/ledger/key-v$active" --with-decryption --query Parameter.Value --output text).Trim()
    try { $ok = [Convert]::FromBase64String($key).Length -eq 32 } catch { $ok = $false }
    if (-not $ok) { throw "the SSM ledger key is not 32 bytes of base64" }

    $hostName = (Read-Host "ledger-staging host (the part after @ in Atlas's connection string, e.g. ledger-staging.xxxxx.mongodb.net)").Trim().ToLowerInvariant()
    if ($hostName -notmatch '^[a-z0-9-]+\.[a-z0-9]+\.mongodb\.net$') { throw "that does not look like an Atlas cluster host" }
    $secure = Read-Host "ledger-app password (hidden)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if (-not $password) { throw "empty password" }
    $uri = "mongodb+srv://ledger-app:$([Uri]::EscapeDataString($password))@$hostName/?retryWrites=true&w=majority&appName=financial-os-staging"
    Remove-Variable password

    "privilege check (ledger-app, changes nothing):"
    $env:LEDGER_CHECK_URI = $uri; $env:LEDGER_CHECK_DATABASE = "deletion_ledger"
    try { & node (Join-Path $repo "scripts\ledger-privilege-check.mjs"); $code = $LASTEXITCODE } finally { Remove-Item Env:LEDGER_CHECK_URI, Env:LEDGER_CHECK_DATABASE -ErrorAction SilentlyContinue }
    if ($code -ne 0) { throw "privilege check failed (exit $code) - nothing was written to Vercel" }

    $script:private = Join-Path $env:TEMP ("fos-" + [guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Path $script:private | Out-Null
    try {
      Add-Env FINANCIAL_OS_LEDGER_MONGODB_URI $uri -Sensitive
      Add-Env FINANCIAL_OS_DELETION_LEDGER_KEY_V1 $key -Sensitive
      Add-Env FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION $active
      Add-Env FINANCIAL_OS_LEDGER_DATABASE "deletion_ledger"
      if (-not (@(Present-Names) -contains "FINANCIAL_OS_ENVIRONMENT")) { Add-Env FINANCIAL_OS_ENVIRONMENT "staging" }
      else { "kept: FINANCIAL_OS_ENVIRONMENT (already present; its value is not read here - readiness shows a wrong value as unavailable)" }
    } finally { Remove-Item $script:private -Recurse -Force -ErrorAction SilentlyContinue; Remove-Variable uri, key -ErrorAction SilentlyContinue }
    $missing = @($ledgerNames + "FINANCIAL_OS_ENVIRONMENT" | Where-Object { @(Present-Names) -notcontains $_ })
    if ($missing) { throw "not listed after adding: $($missing -join ', ')" }
    "apply: ok - redeploy the staging Production deployment, then check /api/ops/readiness"
  }

  if ($Step -eq "unusable" -or $Step -eq "restore") {
    if (@(Present-Names) -notcontains "FINANCIAL_OS_LEDGER_DATABASE") { throw "FINANCIAL_OS_LEDGER_DATABASE is not configured" }
    $script:private = Join-Path $env:TEMP ("fos-" + [guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Path $script:private | Out-Null
    try {
      Remove-Env FINANCIAL_OS_LEDGER_DATABASE
      Add-Env FINANCIAL_OS_LEDGER_DATABASE $(if ($Step -eq "unusable") { "deletion_ledger_s9_unusable" } else { "deletion_ledger" })
    } finally { Remove-Item $script:private -Recurse -Force -ErrorAction SilentlyContinue }
    "${Step}: ok - redeploy, then check /api/ops/readiness (expect $(if ($Step -eq 'unusable') { 'unavailable' } else { 'ready' }))"
  }

  if ($Step -eq "rollback") {
    foreach ($name in @(Present-Names | Where-Object { $ledgerNames -contains $_ })) { Remove-Env $name }
    "rollback: ok (FINANCIAL_OS_ENVIRONMENT kept) - redeploy to return to no ledger"
  }
} catch {
  Remove-Item Env:LEDGER_CHECK_URI, Env:LEDGER_CHECK_DATABASE -ErrorAction SilentlyContinue
  "STOPPED: $($_.Exception.Message)"
  exit 1
}
