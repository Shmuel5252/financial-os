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
      "workers/backup/index.ts sdk:@aws-sdk/client-ssm": 1, "workers/backup/index.ts import:dynamic": 1, "scripts/build-workers.mjs sdk:@aws-sdk/credential-providers": 1 },
    destination: "not a log: SSM parameter reads (keys/URIs, held in memory) and create-only S3 writes of encrypted packages / signed ledger mirrors (see dataStores); `import:dynamic` is the worker's load() of exactly those three @aws-sdk modules; the build script only marks an optional driver dependency external",
    payload: { "object bodies": ["omitted", "packages are AES-256-GCM encrypted; mirrors are pseudonymous and signed (PHASE_18_DATA_AND_LOGGING_CLASSIFICATION.md §2)"] },
    sentinelTests: [],
  },
  "provider-egress": {
    logSink: false,
    sites: { "src/lib/adapters/anthropic/anthropic-ai-provider.ts http:fetch": 1, "src/lib/adapters/anthropic/anthropic-ai-provider.ts url:external": 1,
      "src/lib/adapters/resend/resend-notification-email-provider.ts http:fetch": 2, "src/lib/adapters/resend/resend-notification-email-provider.ts url:external": 1,
      "src/lib/adapters/financy/financy-open-banking-provider.ts http:fetch": 2, "src/lib/adapters/financy/financy-open-banking-provider.ts url:external": 3,
      "src/lib/operations/deletion-ledger-runtime.ts http:fetch": 1, "src/lib/operations/deletion-ledger-runtime.ts url:external": 1 },
    destination: "not a log: the three external processors, each behind its server-only adapter (fixed endpoint constants), and AWS STS for the deletion-ledger role",
    payload: {
      anthropic: ["omitted", "only the minimized, redacted AI context (evidence facts, sanitized question) - Phase 8 minimization tests (phase-eight-ai.integration, ai-safety)"],
      resend: ["omitted", "the fixed generic template, the recipient address and an idempotency key - Phase 15 minimization tests (notification-provider)"],
      financy: ["omitted", "token request with the provider credentials, then read requests for the user's provider data; responses are aliased before storage (Phase 9)"],
      sts: ["omitted", "AssumeRoleWithWebIdentity with the role ARN and the platform OIDC token; no user data; the response is parsed for credentials only and never logged"],
    },
    sentinelTests: [],
  },
  "fixed-origins": {
    logSink: false,
    sites: { "src/lib/operations/environment-binding.ts url:external": 1, "src/lib/operations/load-rehearsal.ts url:external": 2 },
    destination: "not egress: the staging origin the binding check compares against, and the localhost-only guard of the load rehearsal",
    payload: { value: ["literal", "fixed origins, never requested with user data"] },
    sentinelTests: [],
  },
  "browser-same-origin-api": {
    logSink: false,
    sites: Object.fromEntries(["budgets/budget-planner", "debt-strategies/debt-strategy-center", "forecasts/forecast-center", "goals/goal-center",
      "households/household-center", "notifications/notification-center", "open-banking/open-banking-center", "progress-journeys/progress-journey-center",
      "reports/report-center", "transaction-intelligence/transaction-intelligence-review"].map((name) => [`src/components/${name}.tsx http:fetch`, 1])
      .concat([["src/components/onboarding/manual-section-form.tsx http:fetch", 4]])),
    destination: "not a log: client components calling the app's own /api routes through a path variable (request helpers); same origin, session cookie",
    payload: { body: ["raw", "the user's own form input to their own API (validated server-side)"] },
    sentinelTests: [],
  },
  "local-files-and-processes": {
    logSink: false,
    sites: { "scripts/atlas-alerts.mjs api:writeFileSync": 1, "scripts/atlas-alerts.mjs import:node:fs.writeFileSync": 1, "src/lib/operations/object-stores.ts api:writeFile": 1,
      "src/lib/operations/object-stores.ts import:node:fs/promises.writeFile": 1, "scripts/build-workers.mjs import:node:child_process": 1,
      "scripts/security-check.mjs import:node:child_process": 1, "scripts/audit-gate.mjs import:node:child_process": 1 },
    destination: "not a log: atlas-alerts writes alert JSON definitions to an operator directory; object-stores' directory store writes backup objects to a local directory (tests and the operator's drill copy); build-workers runs esbuild, audit-gate runs `npm audit --json` / `npm view braces` (registry metadata only, no repository data sent beyond the lockfile npm audit always submits), security-check runs git ls-files",
    payload: { content: ["omitted", "alert definitions carry the operator-supplied notification address; directory objects are the same encrypted/signed objects as the bucket"] },
    sentinelTests: [],
  },
  "security-headers": {
    logSink: false,
    sites: { "next.config.ts string:csp": 1 },
    destination: "not a log: the one place the Content-Security-Policy header is defined; its run-time value is pinned exactly (securityHeaders)",
    payload: { value: ["literal", "the pinned directive list"] },
    sentinelTests: [],
  },
  "process-wide-client-cache": {
    logSink: false,
    sites: { "src/lib/db/mongodb.ts global:globalThis": 3 },
    destination: "not a log: the MongoDB client promise cached on globalThis across hot reloads",
    payload: { value: ["omitted", "a client promise; nothing is written anywhere"] },
    sentinelTests: [],
  },
  "operator-scripts": {
    logSink: true,
    sites: {
      "scripts/atlas-alerts.mjs console.log": 3, "scripts/build-workers.mjs console.log": 1, "scripts/index-manifest.mjs console.info": 2, "scripts/index-manifest.mjs console.log": 1,
      "scripts/ledger-bootstrap.mjs console.log": 4, "scripts/ledger-privilege-check.mjs console.log": 3, "scripts/ledger-probe.mjs console.log": 4,
      "scripts/security-check.mjs console.error": 1, "scripts/security-check.mjs console.info": 1, "scripts/snapshot-session-probe.mjs console.log": 4,
      "scripts/audit-gate.mjs console.error": 1, "scripts/audit-gate.mjs console.info": 1,
    },
    destination: `${OPERATOR_TERMINAL}; security-check, index-manifest and audit-gate also run in GitHub Actions logs`,
    payload: {
      output: ["literal", "fixed status lines, counts, alert/collection names, digests, MongoDB codeName/error name, advisory ids and package names/versions (audit-gate) - never a URI, password, document or user id"],
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
  { sink: "Dependency egress (not a log)", what: "Auth.js calls Google's OAuth/OIDC endpoints; the MongoDB driver calls AWS STS/IMDS in the MONGODB-AWS aws-runtime mode", exposure: "authorization code and client credentials to Google, which returns the profile stored in authUsers/authAccounts; AWS credential requests carry no user data. Both happen inside reviewed dependencies (reviewedDependencies), so they are not repository emission sites" },
  { sink: "MongoDB driver logging", what: "enabled only by MONGODB_LOG_* environment variables in the deployment", exposure: "would print commands including document values; no repository code enables it (checked in CI); the platform environment is outside the repository" },
] as const;

/**
 * SHA-256 (LF-normalized) of every operator-run file: all of scripts/ (including PowerShell) and every workers/<name>/cli.ts. These
 * print to an operator terminal; any edit - a new console argument, a changed value behind an unchanged one, a Write-Host - fails
 * CI until this pin is updated in a reviewed change (re-check the file against the matrix, operatorPowerShell and the forbidden-
 * identifier rule first).
 */
export const operatorFiles: Readonly<Record<string, string>> = {
  "scripts/atlas-alerts.mjs": "eb0a9111661c5e8e9037cfd73cca4e4cabb2c8a43bcd2bd76d755c5746df9a51",
  "scripts/audit-gate.d.mts": "3b549ddaa98070b1f70061e1e0af504a8316a19421eb61e9d93699a81909337f",
  "scripts/audit-gate.mjs": "18ca28491b4c26abe53ae710d95cb012039e734585c4759fe65385a2e0d38fd9",
  "scripts/build-workers.mjs": "00c7613db51ed08d5525ea986a106fde0bb5634e46d1830b9212a8ab050184e6",
  "scripts/deploy-backup-worker.ps1": "4b43402978c348cecacfd6b10802d4280b65046999f9189e75e04e29b5fb5aca",
  "scripts/index-manifest.mjs": "f75ae14c5889103abe0f930dbf410584635db65665cc8a8324e85a1b7153272f",
  "scripts/ledger-bootstrap.mjs": "021d0d65cb47c5106c4255442369f5a3ef178cacb0ecceae7bed1e13ed180c15",
  "scripts/ledger-privilege-check.mjs": "7433a79569ec7c77add9f390b17ec3bbed66e33ddc63128dfb1d2238c5063d12",
  "scripts/ledger-probe.mjs": "046d3a175b95160afa92d5b734edb6ded94d3c9135d5cba15755df6706deec6e",
  "scripts/recovery-drill.ps1": "957b77ccdf68e3aab35aa68d38482c544951fa1378bed31916350ee3bb8e8918",
  "scripts/s8-alert-tests.ps1": "71b00b1481d77a1b8cd3cbc47a98e76066e0400beea43e344311252f5504d36d",
  "scripts/security-check.d.mts": "7760654d47512c5d0fd4182d3ff2bbe003f317eb265aa5c4f5e335cebfadb200",
  "scripts/security-check.mjs": "94177e8be29c23b87d92bc1986a5e9399aeaa1dea485289f36fb78de8581ecf1",
  "scripts/snapshot-session-probe.mjs": "aba4160b539a812177bb975ca99d230b0e4922f47a3514962b13aa48ed0631ba",
  "scripts/vercel-ledger-env.ps1": "9deb94a2be44320bd911176afc005e22f22824d8d6e2f3ed5bc3a16a451a2676",
  "scripts/verify-backup-stack.ps1": "ab3a993ee4ce658e92dc3a1136105650bc4989e6662730bf833ae5ace5501d2f",
  "workers/ledger-rebuild/cli.ts": "cc0baaaa88eb751e7f72a71efbd34e05b2ffb5b904f0dae3cc980279739d120d",
  "workers/restore-drill/cli.ts": "c7935fbbab9b4a2d92f6424dfd740d3bddec0eab1c224417438267757d2e2078",
};

/**
 * Every direct dependency, reviewed for logging/telemetry/egress. An allowlist: ANY new package fails CI until it is added here
 * with its classification (a new analytics/telemetry SDK must also become a sink entry above).
 */
export const reviewedDependencies: Readonly<Record<string, string>> = {
  "@auth/mongodb-adapter": "auth persistence; logs only through Auth.js's logger (safeAuthLogger)",
  mongodb: "database driver; command logging only via MONGODB_LOG_* (not set in code, checked above). EGRESS: the database itself; in the MONGODB-AWS `aws-runtime` mode the driver also calls AWS STS/IMDS for credentials (no user data)",
  next: "framework; its own server error logging is the implicit sink F-18-20-08",
  "next-auth": "authentication; logger overridden (safeAuthLogger), debug false. EGRESS: the Google OAuth/OIDC exchange (authorization code + client credentials to Google's token endpoint, ID-token verification); it returns the user's Google profile (classified in authUsers/authAccounts)",
  react: "UI runtime; no telemetry",
  "react-dom": "UI runtime; no telemetry",
  "server-only": "build-time guard; no runtime code",
  zod: "validation; no I/O",
  "@tailwindcss/postcss": "dev/build only",
  "@types/node": "dev types only",
  "@types/react": "dev types only",
  "@types/react-dom": "dev types only",
  eslint: "dev only",
  "eslint-config-next": "dev only",
  tailwindcss: "dev/build only",
  typescript: "dev only",
  vite: "dev/test only",
  vitest: "dev/test only",
};

/**
 * The exact response headers next.config.ts serves, as returned by its `headers()` at run time (so template-literal or env-driven
 * values, extra entries and route-specific overrides all change it). 'self'-only script/connect origins keep third-party beacons out.
 */
export const securityHeaders = (csp: string) => [{ source: "/:path*", headers: [
  { key: "Content-Security-Policy", value: csp },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] }];

/** The exact Content-Security-Policy directives (next.config.ts). */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
] as const;

/**
 * How request query strings are read (queryParameterSites). Query strings reach platform request logs (F-18-20-01): `query` on
 * /api/search (via searchParams.entries) carries the user's search text; the others carry pagination cursors/limits, record and
 * household ids, report periods and formats. A new `searchParams.get` name, member use or URLSearchParams changes this pin; the
 * names behind `entries()` are pinned by searchQueryKeys. Keys only a page component or a client URL builder uses are a stated limit.
 */
export const queryParameters: Readonly<Record<string, number>> = {
  "src/app/api/ai/conversations/route.ts query:get:limit": 1,
  "src/app/api/debt-strategies/route.ts query:get:cursor": 2,
  "src/app/api/debt-strategies/route.ts query:get:limit": 2,
  "src/app/api/financial-data/[section]/route.ts query:get:cursor": 1,
  "src/app/api/financial-data/[section]/route.ts query:get:limit": 1,
  "src/app/api/financial-data/snapshots/route.ts query:get:cursor": 1,
  "src/app/api/financial-data/snapshots/route.ts query:get:limit": 1,
  "src/app/api/financial-engine/snapshots/route.ts query:get:cursor": 1,
  "src/app/api/financial-engine/snapshots/route.ts query:get:limit": 1,
  "src/app/api/net-worth/snapshots/route.ts query:get:cursor": 2,
  "src/app/api/net-worth/snapshots/route.ts query:get:limit": 2,
  "src/app/api/purchase-simulations/route.ts query:get:cursor": 1,
  "src/app/api/purchase-simulations/route.ts query:get:limit": 1,
  "src/app/api/report-summaries/[summaryId]/route.ts query:get:reportId": 1,
  "src/app/api/report-summaries/route.ts query:get:reportId": 1,
  "src/app/api/reports/export/route.ts query:get:format": 1,
  "src/app/api/reports/export/route.ts query:get:householdId": 1,
  "src/app/api/reports/export/route.ts query:get:periodKind": 1,
  "src/app/api/reports/export/route.ts query:get:periodValue": 1,
  "src/app/api/reports/export/route.ts query:get:scopeKind": 1,
  "src/app/api/reports/export/route.ts query:get:snapshotId": 1,
  "src/app/api/reports/route.ts query:get:householdId": 1,
  "src/app/api/reports/route.ts query:get:periodKind": 1,
  "src/app/api/reports/route.ts query:get:periodValue": 1,
  "src/app/api/reports/route.ts query:get:scopeKind": 1,
  "src/app/api/search/route.ts query:entries": 1,
  "src/app/budgets/page.tsx query:use": 3,
  "src/app/households/page.tsx query:use": 3,
  "src/app/reports/page.tsx query:use": 3,
  "src/components/reports/report-center.tsx query:URLSearchParams": 2,
  "src/lib/adapters/financy/financy-open-banking-provider.ts query:URLSearchParams": 2,
  "src/lib/operations/deletion-ledger-runtime.ts query:get:authMechanism": 1,
  "src/lib/operations/deletion-ledger-runtime.ts query:URLSearchParams": 1,
  "src/lib/operations/deletion-ledger-runtime.ts query:use": 1,
};

/**
 * SHA-256 (LF-normalized) of next.config.ts. Its evaluated output is pinned too, but an environment-conditional key (e.g. a
 * production-only rewrite proxying cookies to an external origin) only appears outside tests: any edit needs a reviewed pin update.
 */
export const nextConfigDigest = "3af335bd334642ef1bb24f6796929d11722c39313a2502c3b2c4ba1d5adbcbe9";

/** The parameters /api/search accepts (searchQuerySchema; read via searchParams.entries()). `query` is the user's search text (F-18-20-01). */
export const searchQueryKeys = ["cursor", "householdId", "limit", "query", "scopeKind"] as const;
