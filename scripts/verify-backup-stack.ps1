<#
  Owner-run, read-only (runbook S7/S8/S10): prints the backup stack's verification evidence — worker code and concurrency, schedule,
  objects with their encryption and retention, FinancialOS/Backup metrics, alarm states and history, alert wiring, CloudTrail
  data-event coverage of the bucket, and dead-letter depth. Changes nothing; prints no secret, value or e-mail address.
  Usage: powershell -ExecutionPolicy Bypass -File scripts\verify-backup-stack.ps1 [-AwsProfile financial-os] [-Environment staging] [-Hours 30]
#>
param(
  [string]$AwsProfile = "financial-os",
  [string]$Region = "eu-central-1",
  [ValidateSet("staging", "production")][string]$Environment = "staging",
  [string]$TrailName = "financial-os-management-trail",
  [int]$Hours = 30
)
$ErrorActionPreference = "Stop"
$env:AWS_RETRY_MODE = "standard"; $env:AWS_MAX_ATTEMPTS = "10"
function Invoke-Aws {
  $output = & aws @args --profile $AwsProfile --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "aws $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
  ($output -join "`n") | ConvertFrom-Json
}
$stack = "financial-os-$Environment-backup"; $fn = "financial-os-$Environment-backup-worker"
$since = (Get-Date).ToUniversalTime().AddHours(-$Hours).ToString("yyyy-MM-ddTHH:mm:ssZ"); $until = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
try {
  $s = (Invoke-Aws cloudformation describe-stacks --stack-name $stack).Stacks[0]
  $out = @{}; foreach ($o in $s.Outputs) { $out[$o.OutputKey] = $o.OutputValue }
  $bucket = $out.BackupBucketName
  "== stack: $($s.StackStatus)"

  $cfg = Invoke-Aws lambda get-function-configuration --function-name $fn
  $reserved = (Invoke-Aws lambda get-function-concurrency --function-name $fn).ReservedConcurrentExecutions
  $limit = (Invoke-Aws lambda get-account-settings).AccountLimit.ConcurrentExecutions
  "== worker: $($cfg.Runtime) $($cfg.Architectures -join ',') $($cfg.MemorySize)MB timeout=$($cfg.Timeout)s state=$($cfg.State)/$($cfg.LastUpdateStatus) code=$($cfg.CodeSha256)"
  "   reserved concurrency: $(if ($null -eq $reserved) { 'none' } else { $reserved }); account limit: $limit"

  $scheduleName = (Invoke-Aws cloudformation describe-stack-resource --stack-name $stack --logical-resource-id WorkerSchedule).StackResourceDetail.PhysicalResourceId
  $sch = Invoke-Aws scheduler get-schedule --name $scheduleName
  "== schedule: $($sch.State) $($sch.ScheduleExpression) $($sch.ScheduleExpressionTimezone) retries=$($sch.Target.RetryPolicy.MaximumRetryAttempts) dlq=$([bool]$sch.Target.DeadLetterConfig.Arn)"

  "== objects (key, bytes, encryption, lock mode, retain until):"
  $objects = (Invoke-Aws s3api list-objects-v2 --bucket $bucket).Contents
  foreach ($o in $objects) {
    $h = Invoke-Aws s3api head-object --bucket $bucket --key $o.Key
    "   $($o.Key)  $($o.Size)  $($h.ServerSideEncryption)  $($h.ObjectLockMode)  $($h.ObjectLockRetainUntilDate)"
  }

  "== metrics FinancialOS/Backup, Environment=$Environment, last $Hours h (hour, maximum):"
  foreach ($m in "BackupSucceeded", "LedgerHead", "PrimaryLogicalSizeBytes", "LedgerLogicalSizeBytes") {
    $points = (Invoke-Aws cloudwatch get-metric-statistics --namespace FinancialOS/Backup --metric-name $m --dimensions "Name=Environment,Value=$Environment" --start-time $since --end-time $until --period 3600 --statistics Maximum).Datapoints | Sort-Object Timestamp
    "   ${m}: $(if ($points) { ($points | ForEach-Object { "$($_.Timestamp)=$($_.Maximum)" }) -join '; ' } else { 'no data' })"
  }
  $dur = (Invoke-Aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Duration --dimensions "Name=FunctionName,Value=$fn" --start-time $since --end-time $until --period 3600 --statistics Maximum).Datapoints | Sort-Object Timestamp
  "   Lambda Duration max ms: $(if ($dur) { ($dur | ForEach-Object { "$($_.Timestamp)=$([math]::Round($_.Maximum))" }) -join '; ' } else { 'no data' })"

  "== alarms (state, since; recent transitions):"
  foreach ($a in (Invoke-Aws cloudwatch describe-alarms --alarm-name-prefix $stack).MetricAlarms) {
    $short = $a.AlarmName.Substring($stack.Length).Trim("-")
    "   $short  $($a.StateValue)  $($a.StateUpdatedTimestamp)  actions=$($a.ActionsEnabled)/$(@($a.AlarmActions).Count)"
    foreach ($item in (Invoke-Aws cloudwatch describe-alarm-history --alarm-name $a.AlarmName --history-item-type StateUpdate --max-records 6).AlarmHistoryItems) {
      "      $($item.Timestamp)  $($item.HistorySummary)"
    }
  }

  $subs = (Invoke-Aws sns list-subscriptions-by-topic --topic-arn $out.AlarmTopicArn).Subscriptions
  "== alert topic subscriptions: $(($subs | ForEach-Object { "$($_.Protocol):$(if ($_.SubscriptionArn -like 'arn:*') { 'confirmed' } else { $_.SubscriptionArn })" }) -join ', ')"
  # By stack resource, not name prefix: generated rule names are truncated to 64 characters.
  $rules = (Invoke-Aws cloudformation list-stack-resources --stack-name $stack).StackResourceSummaries | Where-Object ResourceType -eq "AWS::Events::Rule"
  "== event rules: $(($rules | ForEach-Object { "$($_.LogicalResourceId)=$((Invoke-Aws events describe-rule --name $_.PhysicalResourceId).State)/targets=$(@((Invoke-Aws events list-targets-by-rule --rule $_.PhysicalResourceId).Targets).Count)" }) -join ', ')"

  $trail = Invoke-Aws cloudtrail get-trail-status --name $TrailName
  $selectors = Invoke-Aws cloudtrail get-event-selectors --trail-name $TrailName
  "== CloudTrail ${TrailName}: logging=$($trail.IsLogging)"
  "   event selectors: $(@{ basic = $selectors.EventSelectors; advanced = $selectors.AdvancedEventSelectors } | ConvertTo-Json -Depth 10 -Compress)"

  $queueUrl = (Invoke-Aws cloudformation describe-stack-resource --stack-name $stack --logical-resource-id WorkerDeadLetterQueue).StackResourceDetail.PhysicalResourceId
  "== dead-letter queue depth: $((Invoke-Aws sqs get-queue-attributes --queue-url $queueUrl --attribute-names ApproximateNumberOfMessages).Attributes.ApproximateNumberOfMessages)"
  "== done (read-only)"
} catch {
  "STOPPED: $($_.Exception.Message)"
  exit 1
}
