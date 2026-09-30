<#
  Owner-run S8 alert proofs, one step per run, each fail-fast. Prints no secret or e-mail address.
    -Step data-events   Adds CloudTrail S3 data events for WRITES to this backup bucket only (management events kept unchanged),
                        so the ProtectedBucketChangeRule can see object deletes/retention changes. Reads back and verifies.
    -Step dead-letter   Sends one synthetic message to the empty dead-letter queue, waits for DeadLetterAlarm = ALARM,
                        then deletes exactly that message. Refuses to start if the queue is not empty.
    -Step break-glass   DESTRUCTIVE FOR ITS OWN TEST OBJECT ONLY: writes s8-breakglass-test/<time>.txt (Governance-retained),
                        proves the administrator cannot delete it, then deletes that one version through the break-glass role.
                        Refuses to start unless data events cover the bucket.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\s8-alert-tests.ps1 -Step <data-events|dead-letter|break-glass>
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("data-events", "dead-letter", "break-glass")][string]$Step,
  [string]$AwsProfile = "financial-os",
  [string]$Region = "eu-central-1",
  [ValidateSet("staging", "production")][string]$Environment = "staging",
  [string]$TrailName = "financial-os-management-trail"
)
$ErrorActionPreference = "Stop"
$env:AWS_RETRY_MODE = "standard"; $env:AWS_MAX_ATTEMPTS = "10"
function Invoke-Aws {
  $output = & aws @args --profile $AwsProfile --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "aws $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
  ($output -join "`n") | ConvertFrom-Json
}
function Write-Utf8([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false))) }
function Resource([string]$logicalId) { (Invoke-Aws cloudformation describe-stack-resource --stack-name $stack --logical-resource-id $logicalId).StackResourceDetail.PhysicalResourceId }
function Covered($selectors) { if ($null -eq $selectors) { return $false }; (ConvertTo-Json -InputObject $selectors -Depth 10 -Compress).Contains("arn:aws:s3:::$bucket/") }
# A native command expected to fail: returns its exit code without letting stderr become a terminating error under Stop.
function Try-Aws { $ErrorActionPreference = "Continue"; & aws @args --profile $AwsProfile --region $Region 2>&1 | Out-String; $LASTEXITCODE }
$stack = "financial-os-$Environment-backup"
try {
  $out = @{}; foreach ($o in (Invoke-Aws cloudformation describe-stacks --stack-name $stack).Stacks[0].Outputs) { $out[$o.OutputKey] = $o.OutputValue }
  $bucket = $out.BackupBucketName

  if ($Step -eq "data-events") {
    $before = Invoke-Aws cloudtrail get-event-selectors --trail-name $TrailName
    "before: $(@{ basic = $before.EventSelectors; advanced = $before.AdvancedEventSelectors } | ConvertTo-Json -Depth 10 -Compress)"
    $basic = @($before.EventSelectors)
    if ($before.AdvancedEventSelectors -or $basic.Count -ne 1 -or $basic[0].ReadWriteType -ne "All" -or -not $basic[0].IncludeManagementEvents -or @($basic[0].DataResources).Count -ne 0 -or @($basic[0].ExcludeManagementEventSources).Count -ne 0) {
      throw "the trail's selectors are not the expected S0 baseline (all management events, no data events); not changing them"
    }
    $selectors = @(
      @{ Name = "Management events (unchanged)"; FieldSelectors = @(@{ Field = "eventCategory"; Equals = @("Management") }) },
      @{ Name = "Backup bucket object writes"; FieldSelectors = @(
          @{ Field = "eventCategory"; Equals = @("Data") }, @{ Field = "resources.type"; Equals = @("AWS::S3::Object") },
          @{ Field = "readOnly"; Equals = @("false") }, @{ Field = "resources.ARN"; StartsWith = @("arn:aws:s3:::$bucket/") }) }
    )
    $file = Join-Path $env:TEMP "s8-selectors.json"; Write-Utf8 $file (ConvertTo-Json -InputObject $selectors -Depth 10)
    Invoke-Aws cloudtrail put-event-selectors --trail-name $TrailName --advanced-event-selectors "file://$file" | Out-Null
    Remove-Item $file
    $after = Invoke-Aws cloudtrail get-event-selectors --trail-name $TrailName
    $json = $after.AdvancedEventSelectors | ConvertTo-Json -Depth 10 -Compress
    if (-not (Covered $after.AdvancedEventSelectors) -or -not $json.Contains('"Management"') -or -not $json.Contains('"readOnly"')) { throw "read-back does not show the expected selectors" }
    if (-not (Invoke-Aws cloudtrail get-trail-status --name $TrailName).IsLogging) { throw "trail is not logging" }
    "after: $json"
    "data-events: ok (writes to s3://$bucket/* only; management events unchanged; trail logging)"
    "rollback if ever needed: aws cloudtrail put-event-selectors --trail-name $TrailName --event-selectors '[{""ReadWriteType"":""All"",""IncludeManagementEvents"":true}]' --profile $AwsProfile --region $Region"
  }

  if ($Step -eq "dead-letter") {
    $queueUrl = Resource "WorkerDeadLetterQueue"
    $depth = [int](Invoke-Aws sqs get-queue-attributes --queue-url $queueUrl --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible).Attributes.ApproximateNumberOfMessages
    if ($depth -ne 0) { throw "the dead-letter queue holds $depth message(s) - investigate those first; nothing sent" }
    $alarm = (Invoke-Aws cloudwatch describe-alarms --alarm-name-prefix "$stack-DeadLetterAlarm").MetricAlarms[0].AlarmName
    $marker = "S8 synthetic dead-letter alarm test $([guid]::NewGuid())"
    Invoke-Aws sqs send-message --queue-url $queueUrl --message-body $marker | Out-Null
    "sent: synthetic message; waiting for DeadLetterAlarm (up to 25 minutes)"
    $state = ""; $deadline = (Get-Date).AddMinutes(25)
    while ((Get-Date) -lt $deadline) {
      $state = (Invoke-Aws cloudwatch describe-alarms --alarm-names $alarm).MetricAlarms[0].StateValue
      if ($state -eq "ALARM") { break }
      Start-Sleep -Seconds 30
    }
    "alarm: $state"
    $deleted = $false
    for ($i = 0; $i -lt 10 -and -not $deleted; $i++) {
      foreach ($m in @((Invoke-Aws sqs receive-message --queue-url $queueUrl --max-number-of-messages 10 --visibility-timeout 30 --wait-time-seconds 5).Messages)) {
        if ($m -and $m.Body -eq $marker) { Invoke-Aws sqs delete-message --queue-url $queueUrl --receipt-handle $m.ReceiptHandle | Out-Null; $deleted = $true }
      }
    }
    if (-not $deleted) { throw "the synthetic message was not found to delete - check the queue" }
    "cleanup: synthetic message deleted"
    if ($state -ne "ALARM") { throw "DeadLetterAlarm did not reach ALARM within 25 minutes" }
    "dead-letter: ok (expect one alarm e-mail; the alarm returns to OK on its own - it has no OK notification)"
  }

  if ($Step -eq "break-glass") {
    if (-not (Covered (Invoke-Aws cloudtrail get-event-selectors --trail-name $TrailName).AdvancedEventSelectors)) { throw "data events do not cover the bucket - run -Step data-events first" }
    $key = "s8-breakglass-test/$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).txt"
    $file = Join-Path $env:TEMP "s8-breakglass.txt"; Write-Utf8 $file "synthetic S8 break-glass test object - no data"
    $version = (Invoke-Aws s3api put-object --bucket $bucket --key $key --body $file --if-none-match "*").VersionId
    Remove-Item $file
    $h = Invoke-Aws s3api head-object --bucket $bucket --key $key --version-id $version
    if ($h.ObjectLockMode -ne "GOVERNANCE") { throw "test object is not Governance-retained" }
    "test object: $key (GOVERNANCE until $($h.ObjectLockRetainUntilDate))"

    $text, $code = Try-Aws s3api delete-object --bucket $bucket --key $key --version-id $version --bypass-governance-retention
    if ($code -eq 0) { throw "CRITICAL: the administrator deleted a Governance-retained version - the bucket policy is not protecting the bucket" }
    if ($text -notmatch "AccessDenied") { throw "administrator delete failed for a reason other than AccessDenied" }
    "administrator delete: refused (AccessDenied) - as designed"

    $c = (Invoke-Aws sts assume-role --role-arn $out.BreakGlassRoleArn --role-session-name s8-breakglass-test --duration-seconds 900).Credentials
    try {
      $env:AWS_ACCESS_KEY_ID = $c.AccessKeyId; $env:AWS_SECRET_ACCESS_KEY = $c.SecretAccessKey; $env:AWS_SESSION_TOKEN = $c.SessionToken
      & aws s3api delete-object --bucket $bucket --key $key --version-id $version --bypass-governance-retention --region $Region --output json | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "break-glass delete failed" }
    } finally { Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue }
    "break-glass delete: ok (test object version removed; session credentials cleared)"
    $text, $code = Try-Aws s3api head-object --bucket $bucket --key $key --version-id $version
    if ($code -eq 0) { throw "the test object version still exists" }
    "break-glass: ok (expect 3 alert e-mails within ~15 minutes: role assumption, refused administrator delete, break-glass delete)"
  }
} catch {
  Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
  "STOPPED: $($_.Exception.Message)"
  exit 1
}
