// Phase 18 rows 18-07/18-20 (repository portion): every logging/telemetry emission point and external SDK call in src/, workers/
// and scripts/ (found by tests/security/emission-sites.ts), what reaches its destination and how each field is treated. CI
// (tests/unit/logging-sink-inventory.test.ts) fails on any unclassified, stale or miscounted site, and on a sink whose sentinel test
// is not a live it()/test(). Implicit sinks (framework/runtime logging of uncaught errors, platform request logs) are listed
// separately because no repository line emits them.
//
// Treatments: literal (fixed text in code) | enum (closed allowlist; anything else is replaced) | count (bounded non-negative
// integer, else null) | random-id (fresh UUID per event, derived from nothing, stored nowhere else) | omitted (present in the input,
// never emitted) | raw (emitted as is). No sink emits a pseudonymized identifier: a hash/HMAC of an identifier would still be
// personal data, so the sinks omit identifiers rather than transform them.

export type Treatment = "literal" | "enum" | "count" | "random-id" | "omitted" | "raw";
export type SinkEntry = Readonly<{
  /** `<file> <kind>` -> occurrences, exactly as emissionSites() reports them. */
  sites: Readonly<Record<string, number>>;
  /** false only for external reads/writes that are classified here but are not logs/telemetry (they need no sentinel test). */
  logSink: boolean;
  destination: string;
  payload: Readonly<Record<string, readonly [Treatment, string]>>;
  sentinelTests: readonly string[];
}>;

const OPERATOR_TERMINAL = "operator's local terminal (not a hosted log); run by hand per runbook";

export const sinkMatrix: Readonly<Record<string, SinkEntry>> = {
  "ai-provider-telemetry": {
    logSink: true,
    sites: { "src/lib/ai/ai-telemetry.ts console.info": 1, "src/lib/ai/ai-telemetry.ts console.warn": 1, "src/lib/ai/ai-service.ts emit": 2, "src/lib/reports/report-summary-service.ts emit": 2 },
    destination: "Vercel function logs (stdout/stderr) via ConsoleAiTelemetrySink -> safeProviderTelemetry(event, \"anthropic\")",
    payload: {
      message: ["literal", "\"AI provider telemetry\""], provider: ["literal", "\"anthropic\""], status: ["enum", "success | failure"],
      durationMs: ["count", "bounded integer or null"], retryCount: ["count", "bounded integer or null"],
      errorCategory: ["enum", "operational category allowlist, else UNKNOWN_FAILURE; null on success"],
      inputTokens: ["count", "bounded integer or null"], outputTokens: ["count", "bounded integer or null"], redactionVersion: ["literal", "operational-telemetry-v1"],
      requestId: ["omitted", "per-call UUID"], model: ["omitted", "provider model string"], minimizationVersion: ["omitted", "policy versions"],
      "anything else": ["omitted", "explicit projection: question text, context, evidence, response, user/report ids never reach the sink"],
    },
    sentinelTests: ["log-provider-projection", "log-ai-sink", "log-ai-service-path", "log-report-summary-path"],
  },
  "notification-provider-telemetry": {
    logSink: true,
    sites: { "src/lib/notifications/notification-telemetry.ts console.info": 1, "src/lib/notifications/notification-telemetry.ts console.warn": 1, "src/lib/adapters/resend/resend-notification-email-provider.ts emit": 4 },
    destination: "Vercel function logs via ConsoleNotificationTelemetrySink -> safeProviderTelemetry(event, \"resend\")",
    payload: {
      message: ["literal", "\"Notification provider telemetry\""], provider: ["literal", "\"resend\""], status: ["enum", "success | failure"],
      durationMs: ["count", "bounded integer or null"], retryCount: ["count", "bounded integer or null"],
      errorCategory: ["enum", "operational category allowlist, else UNKNOWN_FAILURE"], inputTokens: ["literal", "null"], outputTokens: ["literal", "null"],
      redactionVersion: ["literal", "operational-telemetry-v1"], requestId: ["omitted", "per-call id"], adapterVersion: ["omitted", "adapter version"], operation: ["omitted", "submit | status"],
      "anything else": ["omitted", "recipient address, subject, body, provider message id, API key and provider error bodies never reach the sink"],
    },
    sentinelTests: ["log-provider-projection", "log-notification-sink", "log-resend-path"],
  },
  "auth-logger": {
    logSink: true,
    sites: { "src/lib/auth/safe-logger.ts console.error": 1, "src/lib/auth/safe-logger.ts console.warn": 1, "src/lib/auth/safe-logger.ts config:debug": 1, "src/lib/auth/config.ts config:logger": 1, "src/lib/auth/config.ts config:debug": 1 },
    destination: "Vercel function logs; Auth.js is configured with debug: false and logger: safeAuthLogger (every level overridden)",
    payload: {
      message: ["literal", "\"Authentication failure\" | \"Authentication warning\""], category: ["enum", "instanceof checks over @auth/core error classes; AuthWarning for warnings"],
      correlationId: ["random-id", "fresh UUID per log line"], redactionVersion: ["literal", "auth-log-v1"],
      "error message/cause/stack/name, warning code, debug metadata": ["omitted", "never read or serialized; debug() is a no-op"],
    },
    sentinelTests: ["log-auth-logger", "log-auth-config"],
  },
  "route-error": {
    logSink: true,
    sites: { "src/lib/http/route-response.ts console.error": 1 },
    destination: "Vercel function logs for errors that are not ApplicationError, from every route handler's catch -> errorResponse",
    payload: {
      message: ["literal", "\"Unhandled route error\""], correlationId: ["random-id", "fresh UUID; also returned to the requester in the response body"],
      errorName: ["literal", "\"UnexpectedError\""], "the error itself": ["omitted", "message, cause, stack, driver error fields (e.g. MongoServerError keyValue) are never read"],
      "response body": ["enum", "ApplicationError code + fixed message; validation issues carry field paths and zod messages (no input values); unknown errors -> INTERNAL_ERROR"],
    },
    sentinelTests: ["log-route-error", "log-validation-echo"],
  },
  "restore-drill-cli": {
    logSink: true,
    sites: { "workers/restore-drill/cli.ts console.log": 1, "workers/restore-drill/cli.ts console.error": 1 },
    destination: OPERATOR_TERMINAL,
    payload: {
      result: ["raw", "runRestoreDrill result: package name, counts, ledger head, barriers, timings - no record content or user id"],
      "error.message": ["raw", "fixed fail-closed categories from app code; a third-party (driver/TLS) message would print verbatim to the operator only"],
    },
    sentinelTests: ["log-restore-drill-output"],
  },
  "ledger-rebuild-cli": {
    logSink: true,
    sites: { "workers/ledger-rebuild/cli.ts console.log": 2, "workers/ledger-rebuild/cli.ts console.error": 1 },
    destination: OPERATOR_TERMINAL,
    payload: {
      summary: ["raw", "head, row count, digest, base mirror object name, base head, mirror count, applied journal revisions - never a receipt, subject or key"],
      "error.message": ["raw", "fixed \"Ledger rebuild refused: <reason>\" categories; a third-party message would print verbatim to the operator only"],
    },
    sentinelTests: ["log-ledger-rebuild-output"],
  },
  "backup-metrics": {
    logSink: true,
    sites: { "workers/backup/index.ts aws:PutMetricDataCommand": 1, "workers/backup/index.ts sdk:@aws-sdk/client-cloudwatch": 1 },
    destination: "CloudWatch metrics, namespace FinancialOS/Backup, after each successful backup run (backupMetrics in workers/backup/index.ts)",
    payload: {
      MetricName: ["literal", "BackupSucceeded | LedgerHead | PrimaryLogicalSizeBytes | LedgerLogicalSizeBytes"], Value: ["count", "1, ledger head revision, logical byte sizes"],
      Unit: ["literal", "Count | None | Bytes"], Dimensions: ["enum", "Environment = staging | production"],
      "everything else": ["omitted", "no user, record, key or URI ever reaches a metric"],
    },
    sentinelTests: ["log-backup-metrics"],
  },
  "backup-aws-data-plane": {
    logSink: false,
    sites: { "workers/backup/index.ts aws:GetParametersByPathCommand": 1, "workers/backup/index.ts aws:PutObjectCommand": 1, "workers/backup/index.ts sdk:@aws-sdk/client-s3": 1,
      "workers/backup/index.ts sdk:@aws-sdk/client-ssm": 1, "scripts/build-workers.mjs sdk:@aws-sdk/credential-providers": 1 },
    destination: "not a log: SSM parameter reads (keys/URIs, held in memory) and create-only S3 writes of encrypted packages / signed ledger mirrors (see dataStores); the build script only marks an optional driver dependency external",
    payload: { "object bodies": ["omitted", "packages are AES-256-GCM encrypted; mirrors are pseudonymous and signed (PHASE_18_DATA_AND_LOGGING_CLASSIFICATION.md §2)"] },
    sentinelTests: [],
  },
  "operator-scripts": {
    logSink: true,
    sites: {
      "scripts/atlas-alerts.mjs console.log": 3, "scripts/build-workers.mjs console.log": 1, "scripts/index-manifest.mjs console.info": 2, "scripts/index-manifest.mjs console.log": 1,
      "scripts/ledger-bootstrap.mjs console.log": 4, "scripts/ledger-privilege-check.mjs console.log": 3, "scripts/ledger-probe.mjs console.log": 4,
      "scripts/security-check.mjs console.error": 1, "scripts/security-check.mjs console.info": 1, "scripts/snapshot-session-probe.mjs console.log": 4,
    },
    destination: `${OPERATOR_TERMINAL}; security-check and index-manifest also run in GitHub Actions logs`,
    payload: {
      output: ["literal", "fixed status lines, counts, alert/collection names, digests, MongoDB codeName/error name - never a URI, password, document or user id"],
    },
    sentinelTests: ["log-operator-scripts"],
  },
};

/** PowerShell operator scripts (not parsed by emissionSites): every one must be listed; they print to the operator's terminal. */
export const operatorPowerShell: Readonly<Record<string, string>> = {
  "scripts/deploy-backup-worker.ps1": "deployment status lines; secrets come from SSM/hidden prompts and are never echoed",
  "scripts/recovery-drill.ps1": "drill step status, counts and the drill CLIs' output; credentials via hidden prompt",
  "scripts/s8-alert-tests.ps1": "alert test status lines",
  "scripts/vercel-ledger-env.ps1": "environment-variable names and status (values read via hidden prompt, passed to vercel through a temporary file, never printed); on a failed `vercel env add` it throws with the Vercel CLI's own output (not known to echo values; not tested)",
  "scripts/verify-backup-stack.ps1": "stack/bucket/alarm verification lines",
};

/** Logging that no repository line emits, but that repository behaviour feeds. Platform evidence for these is separately gated. */
export const implicitSinks = [
  { sink: "Next.js server error logging", what: "an error thrown out of a page, layout or server action (route handlers catch into errorResponse) is printed by the framework with message and stack", exposure: "app-thrown messages are fixed or name a field/category; a third-party error (e.g. a MongoServerError E11000 message includes the duplicate key VALUE) would be printed verbatim. Pages only read; the two server actions are sign-in/sign-out" },
  { sink: "AWS Lambda runtime (backup worker)", what: "an uncaught error from the scheduled worker is written to the CloudWatch log group (30-day retention in the template)", exposure: "the worker's own failures are `Backup worker failed closed: <reason>` / `Backup capture failed closed: <reason>` with fixed reasons, collection names and driver error codes (codeOf); but errors from connect (backup-worker.ts:54-55), dbStats (:63), the CloudWatch metric call (:64) and S3 writes (workers/backup/index.ts rethrows) reach the runtime with the raw driver/SDK message (host names possible; no keys or documents observed) - F-18-20-08" },
  { sink: "Platform request logs (Vercel)", what: "method, path and QUERY STRING of every request", exposure: "GET /api/search carries the user's search text (financial text, up to 100 chars) in `query`; other query strings carry record/household ids, report periods and pagination cursors (finding F-18-20-01)" },
  { sink: "MongoDB driver logging", what: "enabled only by MONGODB_LOG_* environment variables in the deployment", exposure: "would print commands including document values; no repository code enables it (checked in CI); the platform environment is outside the repository" },
] as const;

/**
 * Exact text of every console call argument in operator-run code (workers' CLIs, scripts/*.mjs). Pinned so that any change to what
 * an operator terminal prints (e.g. printing a URI, a whole error object or an extra result field) fails CI until re-reviewed.
 */
export const operatorOutputs: Readonly<Record<string, readonly string[]>> = {
  "scripts/atlas-alerts.mjs": [
    "`wrote ${alerts.length} alert files`",
    "`not available on ${argument(\"--tier\")}: ${unavailable.join(\", \")}`",
    "\"failed: --role ledger|primary --tier free --cluster <name> --email <address> --out <directory>\"",
  ],
  "scripts/build-workers.mjs": [
    "`built .build/${name}/index.mjs (index manifest ${digest.slice(0, 12)}…)`",
  ],
  "scripts/index-manifest.mjs": [
    "createHash(\"sha256\").update(JSON.stringify([\"index-source-manifest-v1\", entries])).digest(\"hex\")",
    "\"Index manifest: 90 source definitions; 88 runtime, 2 offline; no DB operation\"",
    "JSON.stringify({ version: \"index-source-manifest-v1\", executable: false, requiresCollectionResolution: true, definitions }, null, 2)",
  ],
  "scripts/ledger-bootstrap.mjs": [
    "\"failed: LEDGER_BOOTSTRAP_URI and a valid LEDGER_BOOTSTRAP_DATABASE are required\"",
    "\"failed: the ledger database contains other collections\"",
    "`ok: ledger collections present; head revision ${current?.revision}`",
    "`failed: ${error?.codeName ?? error?.name ?? \"error\"}`",
  ],
  "scripts/ledger-privilege-check.mjs": [
    "\"failed: LEDGER_CHECK_URI and a valid LEDGER_CHECK_DATABASE are required\"",
    "line",
    "`failed: connection (${code(error)})`",
  ],
  "scripts/ledger-probe.mjs": [
    "\"failed: PROBE_MONGODB_URI and a valid, dedicated PROBE_DATABASE are required\"",
    "line",
    "`unsupported: connection — fail (${code(error)})`",
    "\"cleanup: done\"",
  ],
  "scripts/security-check.mjs": [
    "`Security check: ${findings.join(\",\")} (${file})`",
    "`Security check: ${new Set(files).size} files; ${failures} findings`",
  ],
  "scripts/snapshot-session-probe.mjs": [
    "\"unsupported: PROBE_MONGODB_URI and PROBE_DATABASE are required\"",
    "\"unsupported: no snapshot time returned\"",
    "stable ? `supported: snapshot session and snapshot reads of ${read} collections at one cluster time` : \"unsupported: cluster time moved\"",
    "`unsupported: ${error?.codeName ?? error?.name ?? \"error\"}`",
  ],
  "workers/ledger-rebuild/cli.ts": [
    "JSON.stringify(summary(await planLedgerRebuild({ store, environment, ledgerKeys, mirrorKeys, minimumHead })), null, 2)",
    "JSON.stringify(summary(await rebuildLedger({ store, environment, ledgerKeys, mirrorKeys, minimumHead, target: client.db(database) })), null, 2)",
    "error instanceof Error ? error.message : \"Ledger rebuild failed\"",
  ],
  "workers/restore-drill/cli.ts": [
    "JSON.stringify(result, null, 2)",
    "error instanceof Error ? error.message : \"Restore drill failed\"",
  ],
};
