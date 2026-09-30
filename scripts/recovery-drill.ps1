<#
  Owner-run S11 (isolated restore drill) and S12 (ledger rebuild drill), local only, on the BitLocker-encrypted C: drive.
  Fail-fast, one step per run, in this order:
    -Step prepare   Builds the drill tools, creates the workspace and starts a loopback-only single-node replica set (port 27020).
    -Step sync      As the restore-operator role (short-lived credentials): copies the backup bucket and saves the authoritative
                    listing right after; records the latest LedgerHead metric. Prints counts only.
    -Step restore   S11: restores the newest package into a fresh loopback database, applies quarantines, runs the release fence
                    (checked against the live staging ledger, read-only user). Prints counts, barriers and timings only.
    -Step rebuild   S12: plans the ledger from the signed evidence (expected head = the LedgerHead metric), rebuilds it into a fresh
                    loopback database, compares digests, then repeats the S11 drill against the rebuilt ledger.
    -Step cleanup   Stops the local node and deletes the whole workspace (the copy, the listing and every restored database).
  Keys and URIs go from SSM into this process's environment for the drill tool only and are removed afterwards; nothing secret
  is printed. Usage: powershell -ExecutionPolicy Bypass -File scripts\recovery-drill.ps1 -Step <prepare|sync|restore|rebuild|cleanup>
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("prepare", "sync", "restore", "rebuild", "cleanup")][string]$Step,
  [ValidatePattern('^C:\\')][string]$Workspace = "C:\financial-os-drill",
  [int]$Port = 27020,
  [string]$Mongod = "C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe",
  [string]$AwsProfile = "financial-os",
  [string]$Region = "eu-central-1",
  [ValidateSet("staging")][string]$Environment = "staging"
)
$ErrorActionPreference = "Stop"
$env:AWS_RETRY_MODE = "standard"; $env:AWS_MAX_ATTEMPTS = "10"
$repo = Split-Path $PSScriptRoot -Parent
$stack = "financial-os-$Environment-backup"
$store = Join-Path $Workspace "store"; $listing = Join-Path $Workspace "listing.json"; $data = Join-Path $Workspace "rs"
$local = "mongodb://127.0.0.1:$Port"
$secretNames = [System.Collections.Generic.List[string]]::new()
function Invoke-Aws {
  $output = & aws @args --profile $AwsProfile --region $Region
  if ($LASTEXITCODE -ne 0) { throw "aws $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
  $output
}
function Invoke-Mongosh([string]$eval) {
  $output = & mongosh --quiet "$local/?directConnection=true" --eval $eval
  if ($LASTEXITCODE -ne 0) { throw "mongosh failed (exit $LASTEXITCODE)" }
  "$output".Trim()
}
function Port-Open { $c = New-Object Net.Sockets.TcpClient; try { $c.Connect("127.0.0.1", $Port); $true } catch { $false } finally { $c.Dispose() } }
function Require-Node { if (-not (Port-Open) -or (Invoke-Mongosh "db.hello().isWritablePrimary") -ne "true") { throw "the local drill node is not running - run -Step prepare" } }
function Require-Copy { if (-not (Test-Path $listing) -or -not (Test-Path $store)) { throw "no synced copy - run -Step sync" } }
function Set-Secret([string]$name, [string]$value) { Set-Item "Env:$name" $value; $secretNames.Add($name) }
function Clear-Secrets { foreach ($name in $secretNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }; $secretNames.Clear() }
# Same mapping as the worker (workers/backup/index.ts mapParameters), limited to what the drills need; values stay in memory.
function Load-Secrets {
  $prefix = "/financial-os/$Environment"
  $parameters = (Invoke-Aws ssm get-parameters-by-path --path $prefix --recursive --with-decryption --query "Parameters[].[Name,Value]" --output json) -join "`n" | ConvertFrom-Json
  foreach ($p in $parameters) {
    $path = $p[0].Substring($prefix.Length + 1); $name = $null
    if ($path -eq "ledger/read-uri") { $name = "FINANCIAL_OS_LEDGER_READ_URI" }
    elseif ($path -eq "backup/package-key-active-version") { $name = "FINANCIAL_OS_RECOVERY_PACKAGE_KEY_ACTIVE_VERSION" }
    elseif ($path -eq "ledger/key-active-version") { $name = "FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION" }
    elseif ($path -eq "ledger/mirror-key-active-version") { $name = "FINANCIAL_OS_LEDGER_MIRROR_KEY_ACTIVE_VERSION" }
    elseif ($path -match '^backup/package-key-v([1-9][0-9]{0,5})$') { $name = "FINANCIAL_OS_RECOVERY_PACKAGE_KEY_V$($Matches[1])" }
    elseif ($path -match '^ledger/mirror-key-v([1-9][0-9]{0,5})$') { $name = "FINANCIAL_OS_LEDGER_MIRROR_KEY_V$($Matches[1])" }
    elseif ($path -match '^ledger/key-v([1-9][0-9]{0,5})$') { $name = "FINANCIAL_OS_DELETION_LEDGER_KEY_V$($Matches[1])" }
    if ($name) { Set-Secret $name $p[1] }
  }
  foreach ($required in "FINANCIAL_OS_LEDGER_READ_URI", "FINANCIAL_OS_RECOVERY_PACKAGE_KEY_ACTIVE_VERSION", "FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION", "FINANCIAL_OS_LEDGER_MIRROR_KEY_ACTIVE_VERSION") {
    if (-not (Test-Path "Env:$required")) { throw "SSM has no value for $required" }
  }
  Set-Secret FINANCIAL_OS_ENVIRONMENT $Environment
  Set-Secret FINANCIAL_OS_LEDGER_DATABASE "deletion_ledger"
  Set-Secret RESTORE_TARGET_URI $local
}
function Invoke-Tool([string]$tool, [string[]]$arguments) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  & node (Join-Path $repo ".build\$tool\index.mjs") @arguments
  $code = $LASTEXITCODE; $watch.Stop()
  "(${tool}: exit $code, $([math]::Round($watch.Elapsed.TotalSeconds, 1)) s)"
  if ($code -ne 0) { throw "${tool} refused or failed (exit $code) - see its message above" }
}
try {
  if ($Step -eq "prepare") {
    if (Test-Path $Workspace) { throw "$Workspace already exists - run -Step cleanup first" }
    if (Port-Open) { throw "port $Port is already in use" }
    if (-not (Test-Path $Mongod)) { throw "mongod not found at $Mongod (pass -Mongod)" }
    Push-Location $repo; try { npm run -s workers:build | Out-Null; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { throw "worker build failed" }
    "build: ok"
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $process = Start-Process -FilePath $Mongod -WindowStyle Hidden -PassThru -ArgumentList @("--replSet", "drill", "--port", "$Port", "--bind_ip", "127.0.0.1", "--dbpath", "`"$data`"", "--logpath", "`"$(Join-Path $Workspace 'mongod.log')`"")
    Set-Content (Join-Path $Workspace "mongod.pid") $process.Id
    $deadline = (Get-Date).AddSeconds(30); while (-not (Port-Open)) { if ((Get-Date) -gt $deadline) { throw "mongod did not start (see mongod.log)" }; Start-Sleep 1 }
    Invoke-Mongosh "rs.initiate({ _id: 'drill', members: [{ _id: 0, host: '127.0.0.1:$Port' }] }).ok" | Out-Null
    $deadline = (Get-Date).AddSeconds(30); while ((Invoke-Mongosh "db.hello().isWritablePrimary") -ne "true") { if ((Get-Date) -gt $deadline) { throw "replica set did not become primary" }; Start-Sleep 1 }
    "prepare: ok (workspace $Workspace; loopback replica set on 127.0.0.1:$Port)"
  }

  if ($Step -eq "sync") {
    Require-Node
    if (Test-Path $listing) { throw "a copy already exists - run cleanup and prepare for a fresh drill" }
    $outputs = @{}; foreach ($o in ((Invoke-Aws cloudformation describe-stacks --stack-name $stack --output json) -join "`n" | ConvertFrom-Json).Stacks[0].Outputs) { $outputs[$o.OutputKey] = $o.OutputValue }
    $since = (Get-Date).ToUniversalTime().AddDays(-3).ToString("yyyy-MM-ddTHH:mm:ssZ"); $until = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $heads = ((Invoke-Aws cloudwatch get-metric-statistics --namespace FinancialOS/Backup --metric-name LedgerHead --dimensions "Name=Environment,Value=$Environment" --start-time $since --end-time $until --period 3600 --statistics Maximum --output json) -join "`n" | ConvertFrom-Json).Datapoints
    if (-not $heads) { throw "no LedgerHead metric in the last 3 days" }
    $head = [long](($heads | Sort-Object Timestamp | Select-Object -Last 1).Maximum)
    Set-Content (Join-Path $Workspace "ledger-head.txt") $head
    $c = ((Invoke-Aws sts assume-role --role-arn $outputs.RestoreOperatorRoleArn --role-session-name "restore-drill" --duration-seconds 900 --output json) -join "`n" | ConvertFrom-Json).Credentials
    try {
      $env:AWS_ACCESS_KEY_ID = $c.AccessKeyId; $env:AWS_SECRET_ACCESS_KEY = $c.SecretAccessKey; $env:AWS_SESSION_TOKEN = $c.SessionToken
      & aws s3 sync "s3://$($outputs.BackupBucketName)" $store --region $Region --only-show-errors
      if ($LASTEXITCODE -ne 0) { throw "s3 sync failed (exit $LASTEXITCODE)" }
      $json = & aws s3api list-objects-v2 --bucket $outputs.BackupBucketName --region $Region --output json
      if ($LASTEXITCODE -ne 0) { throw "listing failed (exit $LASTEXITCODE)" }
      [IO.File]::WriteAllText($listing, ($json -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
    } finally { Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue }
    $keys = (Get-Content $listing -Raw | ConvertFrom-Json).Contents.Key
    "sync: ok - packages $(@($keys | Where-Object { $_ -like 'packages/*' }).Count), ledger mirrors $(@($keys | Where-Object { $_ -like 'ledger-mirror/*' }).Count), journal entries $(@($keys | Where-Object { $_ -like 'ledger-journal/*' }).Count); LedgerHead metric $head (restore-operator credentials cleared)"
  }

  if ($Step -eq "restore") {
    Require-Node; Require-Copy; Load-Secrets
    "drill start (UTC): $((Get-Date).ToUniversalTime().ToString('o'))"
    Invoke-Tool "restore-drill" @("--store", $store, "--listing", $listing)
    "restore: ok - S11 evidence above (fence, barriers, counts, timings)"
  }

  if ($Step -eq "rebuild") {
    Require-Node; Require-Copy; Load-Secrets
    $head = (Get-Content (Join-Path $Workspace "ledger-head.txt") -Raw).Trim()
    "plan (expected head >= $head):"
    $plan = & node (Join-Path $repo ".build\ledger-rebuild\index.mjs") --store $store --listing $listing --expect-head $head --plan
    if ($LASTEXITCODE -ne 0) { throw "ledger rebuild plan refused (exit $LASTEXITCODE)" }
    $plan; $planned = ($plan -join "`n" | ConvertFrom-Json)
    $database = "ledger_rebuild_$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
    Set-Secret LEDGER_REBUILD_TARGET_URI $local; Set-Secret LEDGER_REBUILD_TARGET_DATABASE $database
    "rebuild into loopback database ${database}:"
    $built = & node (Join-Path $repo ".build\ledger-rebuild\index.mjs") --store $store --listing $listing --expect-head $head
    if ($LASTEXITCODE -ne 0) { throw "ledger rebuild refused (exit $LASTEXITCODE)" }
    $built; $rebuilt = ($built -join "`n" | ConvertFrom-Json)
    if ($rebuilt.digest -ne $planned.digest -or $rebuilt.head -ne $planned.head) { throw "the rebuilt ledger does not match its plan" }
    "rebuild digest = plan digest; head $($rebuilt.head)"
    Set-Secret FINANCIAL_OS_LEDGER_READ_URI $local; Set-Secret FINANCIAL_OS_LEDGER_DATABASE $database
    "S11 drill against the rebuilt ledger:"
    Invoke-Tool "restore-drill" @("--store", $store, "--listing", $listing)
    "rebuild: ok - S12 evidence above"
  }

  if ($Step -eq "cleanup") {
    $pidFile = Join-Path $Workspace "mongod.pid"
    if (Test-Path $pidFile) {
      $id = [int](Get-Content $pidFile -Raw).Trim()
      $process = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -eq "mongod") {
        # The shutdown drops mongosh's own connection (an expected error on stderr), so it must not stop this script.
        & { $ErrorActionPreference = "Continue"; & mongosh --quiet "$local/?directConnection=true" --eval "db.getSiblingDB('admin').shutdownServer({ force: true })" 2>&1 | Out-Null }
        if (-not $process.WaitForExit(30000)) { Stop-Process -Id $id -Force }
      }
    }
    if (Port-Open) { throw "something still listens on port $Port - not deleting the workspace" }
    if (Test-Path $Workspace) { Remove-Item $Workspace -Recurse -Force }
    if (Test-Path $Workspace) { throw "the workspace could not be deleted" }
    "cleanup: ok (node stopped; $Workspace deleted)"
  }
} catch {
  "STOPPED: $($_.Exception.Message)"
  exit 1
} finally {
  Clear-Secrets
  Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
}
