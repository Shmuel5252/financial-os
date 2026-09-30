<#
  Owner-run (runbook S7): build, upload and deploy the backup worker, then prove the code running in Lambda is exactly this build.
  Fails fast: the first failed step stops everything, and the worker is invoked (with -Invoke) only after the live CodeSha256 equals
  the uploaded zip's SHA-256. AWS CLI calls use standard retries for transient connection/DNS errors. Prints no secret.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\deploy-backup-worker.ps1 [-AwsProfile financial-os] [-Environment staging] [-Invoke]
#>
param(
  [string]$AwsProfile = "financial-os",
  [string]$Region = "eu-central-1",
  [ValidateSet("staging", "production")][string]$Environment = "staging",
  [switch]$Invoke
)
$ErrorActionPreference = "Stop"
$env:AWS_RETRY_MODE = "standard"; $env:AWS_MAX_ATTEMPTS = "10"
function Invoke-Aws {
  $output = & aws @args --profile $AwsProfile --region $Region
  if ($LASTEXITCODE -ne 0) { throw "aws $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
  $output
}
Set-Location (Split-Path $PSScriptRoot -Parent)
$stack = "financial-os-$Environment-backup"; $fn = "financial-os-$Environment-backup-worker"
try {
  "commit: $(git log --oneline -1)"
  $account = Invoke-Aws sts get-caller-identity --query Account --output text
  if ($account -notmatch '^\d{12}$') { throw "unexpected account id" }
  $bucket = "financial-os-artifacts-$account"
  npm run workers:build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "worker build failed" }
  "build: ok"
  $zip = Join-Path $env:TEMP "backup-worker.zip"
  Remove-Item $zip -ErrorAction SilentlyContinue
  Compress-Archive -Path .build\backup-worker\index.mjs -DestinationPath $zip
  $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($zip))
  $key = "backup-worker/" + (-join ($sha[0..7] | ForEach-Object { $_.ToString("x2") })) + ".zip"
  $expected = [Convert]::ToBase64String($sha)
  Invoke-Aws s3 cp $zip "s3://$bucket/$key" | Out-Null
  Invoke-Aws s3api head-object --bucket $bucket --key $key --query ContentLength --output text | Out-Null
  Remove-Item $zip
  "upload: ok ($key)"
  Invoke-Aws cloudformation deploy --stack-name $stack --template-file infra/aws/financial-os-backup.template.json --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides "WorkerCodeKey=$key" | Out-Null
  $status = Invoke-Aws cloudformation describe-stacks --stack-name $stack --query "Stacks[0].StackStatus" --output text
  if ($status -notin @("CREATE_COMPLETE", "UPDATE_COMPLETE")) { throw "stack status $status" }
  $live = Invoke-Aws lambda get-function-configuration --function-name $fn --query CodeSha256 --output text
  if ($live -ne $expected) { throw "the deployed code is not this build (CodeSha256 mismatch)" }
  "deploy: ok ($status; live code = this build)"
  if ($Invoke) {
    $out = Join-Path $env:TEMP "worker-out.json"
    "invoke: $(Invoke-Aws lambda invoke --function-name $fn --cli-read-timeout 700 $out --query '[StatusCode,FunctionError]' --output text)"
    Get-Content $out
    Remove-Item $out
    $backup = Invoke-Aws cloudformation describe-stacks --stack-name $stack --query "Stacks[0].Outputs[?OutputKey=='BackupBucketName'].OutputValue" --output text
    Invoke-Aws s3api list-objects-v2 --bucket $backup --query "Contents[].[Key,Size]" --output text
    $package = Invoke-Aws s3api list-objects-v2 --bucket $backup --prefix packages/ --query "Contents[-1].Key" --output text
    if ($package -and $package -ne "None") { "retention: $(Invoke-Aws s3api get-object-retention --bucket $backup --key $package --query 'Retention.[Mode,RetainUntilDate]' --output text)" }
  }
} catch {
  "STOPPED: $($_.Exception.Message)"
  $events = & aws cloudformation describe-stack-events --stack-name $stack --profile $AwsProfile --region $Region --max-items 20 --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text 2>$null
  if ($events) { "recent stack failures:"; $events }
  exit 1
}
