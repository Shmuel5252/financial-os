# Phase 18 rows 18-07 and 18-20: data classification, retention inventory and logging/telemetry sinks (repository portion)

Status: **repository portion built 2026-10-01/02, reviewed, re-reviewed seven times and fixed (see §7); rows 18-07 and 18-20 stay PARTIAL.** This document describes what the code does
today. It adopts no retention period, access role or deletion mechanism; the recommendations live separately in
`PHASE_18_RETENTION_DRAFT.md` (**DRAFT / NOT ADOPTED**). No runtime code, TTL index, deletion job, logging behaviour, application data
or infrastructure was changed in this item.

## 1. Sources of truth and CI enforcement

| Artifact | What it holds | CI test |
| --- | --- | --- |
| `tests/security/data-classification.ts` | 55 collections, 1,189 field rows (class, personal-data level, transform, note), current retention with `file:line`, raw secrets at rest, retention-mechanism inventory, template retention, data stores outside MongoDB, the explained non-literal collection calls, pinned Auth.js adapter versions, 50 pinned subtree shapes, the explained open-value sites, out-of-scope list | `tests/unit/data-classification.test.ts` (13 tests) |
| `tests/security/logging-sink-matrix.ts` | 15 entries (8 log/telemetry sinks + 7 classified non-log egress/I/O/header entries) covering all 64 emission-site keys (94 occurrences), per-field treatment, 16 pinned operator-run files, the reviewed-dependency allowlist (18 packages), the exact run-time security headers and CSP, the next.config.ts digest, the query parameters the app reads, implicit sinks, PowerShell operator scripts | `tests/unit/logging-sink-inventory.test.ts` (11 tests) |
| `tests/unit/logging-sentinels.test.ts` (11), `tests/integration/logging-sentinels.integration.test.ts` (1), `[log-…]` tests in the recovery suites (2) | sentinel tests per sink, plus a self-test of the capture and matcher | run in `npm test` |
| `tests/security/required-tests-reporter.ts` + `vitest.config.mts` (`expect.requireAssertions`) + the CI marker step | 51 required security test ids (every `[iso-…]`/`[log-…]` id in any test title + every matrix-cited id) and every test of the 5 inventory modules (exact counts) | CI (`REQUIRE_SECURITY_TESTS=1`): the run fails unless each one was registered, ran and passed; every test must execute an assertion; a separate step fails if the reporter did not run |

CI fails when:
- **Collections.** A collection appears or disappears. Discovery is AST-based (literals and the manual-section/auth/ledger maps) over `src/` and `workers/`. Additionally:
  - every name the type checker resolves in a `.collection(name)` / `.createCollection(name)` call (typed or not, including `as const` and `const` names) must be classified;
  - every such call whose name is not a single literal must be explained per file (15 today).
- **Fields, top level.** A typed collection's top-level fields differ from its TypeScript document type(s).
- **Fields, nested.** Two rules:
  - once a row goes below a field, every child of that field in the type must be classified, recursively;
  - every subtree that one row classifies as a whole has its exact shape pinned (50 pins), so any new nested field anywhere fails until it is re-reviewed.
- **Fields written but not declared.** A field reaches storage on a typed `Collection<T>` but does not exist in `T`. MongoDB's typings would accept all of these.
  - `insert*`/`replace*`: the written value's TYPE is compared with `T` (literals, spreads of domain objects, variables and mapped arrays alike).
  - Update operators (`$set`, `$push`/`$addToSet` incl. `$each`, …): each value's type is compared with `T` below its dotted key.
  - An open value must be explained (`dynamicUpdateSites`; one today, `updateEmail` in notifications). That covers an operator value typed `Record`/`unknown`/`any`, and any spread of such a value anywhere in a writing function — in place, through an intermediate variable, or in a nested closure.
  - When the open value traces back to a parameter, every same-file call's literal argument is checked against `T`: its keys, and the shape of each value written under them. The trace works for a spread or a direct `$set: param`, follows aliases (`const a = x`, `const { k, ...a } = x`), and covers method, function or arrow-function owners.
  - A primitive or leaf field (string, number, Date, …) accepts no object below it.
  - An open value that cannot be traced to a named parameter is its own explained kind (`dynamic:untraced`), so a refactor that breaks the trace changes the inventory.
  - A vanished entry fails with a re-verify instruction.
  - Beyond writing functions: every object spread of an open value and every `Object.assign` from one, anywhere in `src/` and `workers/`, must be explained (`openValueSites`; 11 today). That covers a spread in another closure or in another file's helper.
- **Manual-section fields.** A manual section's `fields.*` keys differ from its zod domain schema.
- **Auth.js versions.** The installed `@auth/mongodb-adapter`/`@auth/core` versions change: their adapter defines the auth collections.
- **Pseudonymized identifiers.** Any of these fails:
  - a hashed or HMAC identifier is not a `pseudonymous-identifier`;
  - a hash over e-mail, user, owner or name input is marked non-personal;
  - any value is described as "anonymous".
- **Raw secrets.** A new raw secret field appears.
- **Retention mechanisms.** Any of these appears without classification:
  - a TTL index option;
  - a hard-delete or replace call;
  - a field-removal or rewrite key (`$unset`, `$pull`, `$pullAll`, `$pop`, `$slice`, `$rename`, `$replaceWith`, `$replaceRoot`) or a capped collection;
  - an aggregation-pipeline update, or an update whose update document is not a literal (`dynamic-update`);
  - a collection-writing stage (`$out`, `$merge`) or a `rename`/`renameCollection`;
  - a `db.command` that drops or alters collections, or any non-literal `db.command`.

  Computed keys are resolved through same-file constants. An unresolvable computed key inside a MongoDB call is itself a site.
- **Backup template retention.** The backup template's lifecycle, Object Lock or log-group retention changes.
- **Emission points and egress.** Any of these is unclassified, stale or miscounted:
  - `console.*`, and any other use of `console`;
  - any use of `process` outside `env`/`argv`/`cwd`/`execPath`/`exit`/`exitCode`, including `globalThis.process`;
  - the strings `"console"`/`"process"`/`"stdout"`/`"stderr"` anywhere;
  - `globalThis`/`global`/`self`, and computed `window[…]`;
  - import / export-from / require / `import()` (string or template) of `console`, `process`, `child_process`, network or worker modules, and of `util.debuglog` and the fs write/open/copy/rename functions; any computed import;
  - sink APIs (`Console`, `debuglog`, fs write functions, `sendBeacon`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `Function`);
  - every fetch-like call (including `(x ?? fetch)(…)`) whose URL is not a same-origin path literal (a protocol-relative `//host` is external);
  - any string or template literal in `src/`/`workers/` that starts with an external URL (JSX attributes and expressions, constants, templates), and `next/script`;
  - a Content-Security-Policy header name anywhere outside next.config.ts;
  - AWS SDK command names and `@aws-sdk/*` modules;
  - telemetry `.emit()`;
  - `logger`/`debug`/`logging` config keys in `src/`, `workers/`, `scripts/` and `next.config`.
- **Operator-run files.** Any file in `scripts/` (including PowerShell) or any `workers/*/cli.ts` changes: their SHA-256 is pinned, so a changed value behind an unchanged console call also fails. Separately, an operator script prints env values, URIs, secrets or raw error messages.
- **Sentinel, security and inventory tests.** Checked at run time:
  - in CI the run fails unless all 51 required ids, and every test of the 5 inventory modules (exact counts), were registered, ran and passed. That rules out:
    - a skip: `it.skip`, `describe.skipIf`, a `beforeEach` or `ctx` skip;
    - an inversion: `it.fails`, which vitest reports as passed;
    - a missing registration: an empty `each`, an uncalled registrar or a removed file;
  - every test must execute at least one assertion (`expect.requireAssertions`), so a conditional or early-returning test fails;
  - the reporter writes a marker that a separate CI step requires, so a run where it did not execute (e.g. a `--reporter` flag) fails;
  - an inventory test pins the wiring itself: the vitest reporter and `requireAssertions`, the CI env and marker step, no `--reporter` override, and `REQUIRE_SECURITY_TESTS=1` whenever `CI` is set.

  A static check also requires each id to be a real, assertion-calling `it`/`test`: not self-skipping, not conditionally placed, not under a skipping describe or alias, not swallowing its assertions in a non-rethrowing `catch`. It gives the same signal in partial local runs.
- **Dependencies.** Any package outside the reviewed allowlist is added: every direct dependency is classified for logging, telemetry and egress (e.g. Vercel Analytics, Speed Insights or `@next/third-parties` would fail). The egress inside dependencies is recorded: Auth.js's Google OAuth/OIDC exchange, and the driver's AWS STS/IMDS calls in the MONGODB-AWS mode. MongoDB driver command logging enabled in code also fails.
- **Security headers / CSP / next.config.** Any of these fails:
  - the headers that next.config.ts's `headers()` returns at run time differ from the pinned list;
  - the evaluated config has any key beyond `headers`/`poweredByHeader`/`reactStrictMode`;
  - next.config.ts changes at all: it is pinned by SHA-256, because an environment-conditional key, e.g. a production-only rewrite, does not appear when the config is evaluated under test;
  - any other `next.config.*` exists.

  That catches:
  - a widened directive, a template/env-driven origin, or an extra route-specific header entry;
  - `rewrites()`/`redirects()`, which can proxy cookies or carry query strings off-site;
  - `assetPrefix`, `images` and `experimental`.

  A CSP cannot be set unnoticed elsewhere:
  - a CSP header name outside next.config.ts is an emission site;
  - middleware/proxy/instrumentation files must not exist unclassified (route-authorization inventory);
  - platform configs (any `vercel.*`, `now.*`, `netlify.*`, `firebase.*`, `wrangler.*`, …, `_headers`, `_redirects`, in the root, `public/` or `src/`) must not exist unclassified.
- **Auth.js logging.** Auth.js `debug` or the redacting logger changes.

**Limits (stated, not hidden):**
- **Syntactic enforcement.** These checks are syntactic and type-based regression guards against *accidental* logging, egress or unclassified storage. Code that deliberately evades them beyond the flagged primitives (eval, `Function`, computed imports, global objects, sink strings) remains a code-review and CodeQL concern.
- **Writes the checks cannot see.**
  - Writes to untyped (`Document`) collections, and values typed `any` or `unknown`, are not compared with a type.
  - Whole update documents built at run time are flagged as `dynamic-update` retention sites (none today).
  - Open operator values are explained in `dynamicUpdateSites` (one today, with its callers checked).
  - Blanking a field through `$set: null` is an ordinary update, not a removal site.
- **Non-CSP response headers.** Headers set by individual route handlers (e.g. `Cache-Control`, `Vary`) are not pinned. The CSP is.
- **Query parameters.** Pinned per file (`queryParameters`):
  - the names the server reads through `searchParams.get`;
  - every other `searchParams` use;
  - every `URLSearchParams` constructed (server or client).

  The `/api/search` names behind `entries()` are pinned through its schema (`searchQueryKeys`). Which properties a page reads from its `searchParams` prop, and which keys client components put into URLs, are not pinned; F-18-20-01 records the exposure class.
- **Platform and provider side.** Logging and retention there is outside the repository (§2, out of scope).

## 2. Collection and field coverage

The classification was produced by three independent read-only source traces and then reconciled against the type checker. The
reconciliation is exact for every typed collection, at the top level and wherever a row goes deeper (nested coverage); every other subtree's shape is pinned. The Auth.js adapter collections are checked as a superset of the app's typed views, with the adapter versions pinned.
The independent review corrected 31 rows (see §7). The nested check added 107 audit-trail rows. The re-review added the open-banking `source.*` rows that `ManualRecordDocument` permits to the 8 manual sections that lacked them (48 rows = 8 × 6); `accounts` and `transactions` already had them.

Scope covered:
- **Collections:** 55. They split into 44 app, 4 Auth.js, 1 operational (`rateLimits`), 2 deletion ledger (separate database), 3 offline-migration and 1 restore-target collection.
- **Stores outside MongoDB:** 5 data stores (`dataStores`):
  - the S3 backup prefixes `packages/`, `ledger-mirror/` and `ledger-journal/`;
  - the restore-drill target database;
  - the operator's local bucket copy.

By role:

| Role | Collections |
| --- | --- |
| canonical-financial | 17 |
| derived-financial | 14 |
| identity-and-access | 10 |
| operational-metadata | 6 |
| provider-observation | 2 |
| user-preference | 2 |
| deletion-evidence | 2 |
| offline-migration | 2 |

By category:

| Category | Collections |
| --- | --- |
| financial | 30 |
| operational | 10 |
| personal | 9 |
| mixed | 6 |

Field rows by personal-data level:

| Level | Field rows |
| --- | --- |
| direct | 10 |
| indirect | 508 |
| pseudonymous | 47 |
| none | 624 |

Field rows by transform:

| Transform | Field rows |
| --- | --- |
| raw | 931 |
| derived | 105 |
| sha256 | 88 |
| hmac | 50 |
| truncated | 15 |

Every financial value, amount, label, note, merchant text, AI text and identifier has a row.

### Redaction vs pseudonymization vs omission (as stored)

**Pseudonymized, still personal data (never anonymous):**
- **Keyed HMAC:**
  - Open-banking aliases, keyed with `AUTH_SECRET`.
  - Ledger subjects and provider-subject markers, keyed with the ledger key.
  - Reconciliation request keys.
- **Unkeyed sha256 of an identifier:**
  - `householdInvitations.inviteeEmailHash` and `activeInviteKey`: sha256 of the e-mail address.
  - `rateLimits._id`: sha256 of the user id.
  - `households.idempotencyPayloadHash`: sha256 of the household name.

  Anyone holding the input can link these values.
- **Unkeyed sha256 over low-entropy financial values:** the payload, observation, input and state fingerprints and `notifications.conditionFingerprint`. A guess can be confirmed against them, so they are classed as personal data at the `indirect` level, never as anonymous.

**Truncated or masked (partial identifiers, still personal):**
- `account.identity.maskedNumber` (last 4) plus raw bank and branch codes.
- `savings.fields.accountIdentifierLast4`.
- `householdInvitations.inviteeHint` (first letter and full domain).
- `householdMemberships.displayNameSnapshot`.
- Provider names and merchant text with 5+ digit runs masked.

**Secret verifiers (correctly hashed, raw value not stored):** `householdInvitations.tokenHash` and `authVerificationTokens.token`.

**Raw secrets at rest (Auth.js defaults, see F-18-20-02/03):**
- `authAccounts.access_token`, `id_token`, `refresh_token` and `session_state`. The last two are stored only if Google returns them.
- `authSessions.sessionToken`.

OAuth tokens are **not** in backups: the backup keeps only `provider` and `providerAccountId` of auth links.

**Omission:** AI provider context is minimized before it leaves the app. This is the existing Phase 8 control and was not changed.

### Current retention mechanisms (behaviour today, not policy)

**TTL index:** exactly one exists, `rateLimits.expiresAt` (`rate-limiter.ts:41`).

**Hard deletes:**

| What | Where | Trigger |
| --- | --- | --- |
| Own AI conversation | `aiConversations` | User delete |
| Per-user search index rebuild | `authorizedSearchDocuments` | Rebuild |
| Lost claim-race compensation | `bankProviderBindings` | Lost claim race |
| Offline dev-baseline migration targets and its lock | Migration targets and lock | Offline migration (no route) |
| Restore-target database | Restore target | `dropDatabase` at the end of a drill |
| Sessions and verification tokens | `authSessions`, `authVerificationTokens` | Inside Auth.js: sign-out, an expired session presented, a token used |

**Soft deletes and status flips keep the content:**
- `deletedAt`: manual records, net-worth items, AI summaries.
- `hiddenAt`: reports.
- Status flips: households, memberships, invitations, shares, bank connections.

**No purge at all:** every append-only snapshot, scenario, report, notification, progress, bank revision and run collection.

**Erasure is not executable:** it is a plan (`erasure-plan.ts` `execute:false`). The ledger-first protocol has no non-test caller.

**Retention outside MongoDB defined in the repository** (`infra/aws/financial-os-backup.template.json`):

| Store | Retention |
| --- | --- |
| `packages/` | Expire after 36 days, Object Lock GOVERNANCE 35 days, noncurrent versions 1 day (about 37 days effective) |
| `ledger-mirror/`, `ledger-journal/` | No expiry, by design |
| Backup-worker CloudWatch log group | 30 days |

### Outside the repository-governed scope (stated explicitly)

`outOfScope` lists the following. Their evidence is platform- or provider-side and separately gated.
- **Vercel:** request, runtime and build logs (paths **with query strings**, IPs).
- **MongoDB Atlas:** oplog, backups, profiler and audit logs, driver logging switched on by environment variables.
- **AWS:** CloudTrail, S3 access logs, KMS/SSM history, CloudWatch log contents.
- **Providers:** Google, Resend, Anthropic and Financy data.
- **GitHub:** Actions logs.
- **Browsers:** the session cookie and URL history.
- **Operator workstations.**

## 3. Logging and telemetry sink coverage

There are 64 emission-site keys and 94 occurrences, in 15 matrix entries: 8 log/telemetry sinks and 7 classified non-log entries. The non-log entries are:
- the backup worker's SSM/S3 calls;
- the Anthropic/Resend/Financy adapters' HTTP calls and endpoint constants (their minimization is tested in Phases 8, 15 and 9);
- the AWS STS call for the deletion-ledger role (found by the URL inventory: `(input.fetch ?? fetch)(…)`);
- fixed origins (the staging binding origin and the localhost load-rehearsal guard);
- the security-headers definition;
- browser calls to the app's own `/api` routes;
- operator file writes and subprocesses;
- the process-wide MongoDB client cache. Treatments in the table:
- **literal:** fixed text.
- **enum:** a closed allowlist; anything else is replaced.
- **count:** a bounded integer, else null.
- **random-id:** a fresh UUID derived from nothing.
- **omitted:** never emitted.
- **raw:** emitted as is.

No sink emits a pseudonymized identifier, because a hash of an identifier would still be personal data. The sinks omit identifiers instead.

| Sink | Sites | Destination | Emitted / omitted |
| --- | --- | --- | --- |
| AI provider telemetry | `ai-telemetry.ts` (info/warn), `ai-service.ts` ×2, `report-summary-service.ts` ×2 | Vercel function logs | Emitted:<br>- literal provider<br>- status (enum)<br>- duration, retries, tokens (counts)<br>- errorCategory (enum)<br>- redactionVersion<br><br>Omitted:<br>- requestId, model, minimizationVersion<br>- everything else |
| Notification telemetry | `notification-telemetry.ts` (info/warn), Resend adapter ×4 | Vercel function logs | Same projection. Recipient, subject, body, message id, API key and provider bodies are never logged |
| Backup metrics | `workers/backup/index.ts` (`PutMetricDataCommand`, `@aws-sdk/client-cloudwatch`) | CloudWatch metrics `FinancialOS/Backup` | Emitted:<br>- literal metric names<br>- counts and byte sizes<br>- the `Environment` dimension (enum)<br><br>Nothing else |
| Auth.js logger | `safe-logger.ts` (error/warn/debug), `config.ts` (`debug: false`, `logger`) | Vercel function logs | Emitted:<br>- category (enum by `instanceof`)<br>- random correlationId<br>- literal version<br><br>The error message, cause, stack and debug data are never read |
| Route error | `route-response.ts` | Vercel function logs | Emitted:<br>- literal message<br>- random correlationId<br>- literal errorName<br><br>The error is never read. The response body carries only a fixed message, or validation field paths and zod messages (no input values) |
| Restore-drill CLI | `workers/restore-drill/cli.ts` ×2 | Operator terminal | Package name, counts, heads, numeric barriers, timings (exact nested shape tested; never the target URI). Errors: app fail-closed categories. A raw driver message, e.g. E11000 on a non-fresh target, would print verbatim to the operator (F-18-20-08) |
| Ledger-rebuild CLI | `workers/ledger-rebuild/cli.ts` ×3 | Operator terminal | Pinned 7-field summary (head, row count, digest, mirror names/heads, journal revisions). Errors: as above, raw driver messages possible (F-18-20-08) |
| Operator scripts | 10 `scripts/*.mjs` keys (24 calls) + 5 PowerShell scripts | Operator terminal; `security-check` and `index-manifest` also in Actions logs | Fixed status lines, counts, names, codeName only |

**Implicit sinks** (`implicitSinks`) are logged by the framework, runtime or platform rather than by repository code:

| Implicit sink | What it logs | Status |
| --- | --- | --- |
| Next.js server error logging | Pages and server actions only (route handlers catch errors) | See F-18-20-08 |
| Lambda runtime | The backup worker's fail-closed messages, plus **raw driver/SDK messages** from connect, dbStats, the metric call and S3 writes, sent to CloudWatch (30 days) | See F-18-20-08 |
| Vercel request logs | URL query strings | See F-18-20-01 |
| Dependency egress | Auth.js ↔ Google OAuth/OIDC (code, client credentials; returns the profile); MongoDB driver ↔ AWS STS/IMDS in the MONGODB-AWS mode (no user data) | Recorded in `reviewedDependencies` |
| MongoDB driver logging | Only if `MONGODB_LOG_*` is set on the platform | No code enables it; CI-checked |

## 4. Sentinel and mutation results

**Synthetic sentinels:** generated per run and never committed as literals:
- API keys and tokens of the Anthropic, Resend and Google types;
- a JWT and a session token;
- an e-mail address;
- user, resource and household ids;
- amounts in minor units and as formatted text;
- merchant and Hebrew financial text;
- a provider message id;
- a URL whose query string carries the token, e-mail and amount.

**Where the sentinels are hidden:**
- direct top-level fields;
- nested objects and arrays;
- an `Error` with sentinel `message`, `cause`, `stack` and extra properties, including a `MongoServerError` with `keyValue`;
- `URL` and `Headers` objects (authorization, cookie, API key);
- a `Map`;
- `toString` and `toJSON` hooks.

**What is checked:**
- **Outputs:** every `console` level and both `process` streams are captured. The check uses `inspect` (hidden properties, unlimited depth) plus JSON, against raw, URL-encoded and JSON-escaped forms.
- **Response bodies:** checked for the route-error and validation paths.

**Tests (13 sentinel tests plus a capture self-test):**
- `log-provider-projection`
- `log-ai-sink`
- `log-notification-sink`
- `log-resend-path`: real adapter, error, success and status paths, and thrown errors.
- `log-auth-logger`: real `@auth/core` error classes wrapping hostile causes.
- `log-route-error`
- `log-validation-echo`: real search, invitation and transaction schemas.
- `log-report-summary-path`: real service.
- `log-ai-service-path`: real service, repository and default console sink, on MongoDB.
- `log-restore-drill-output`: fixed result shape.
- `log-ledger-rebuild-output`: no receipt, subject, marker, user id or key.
- `log-backup-metrics`: fixed metric names, counts and sizes, and only the Environment dimension.
- `log-validation-key-echo`: unrecognized keys are echoed by name to the requester (F-18-20-10), never their values; nothing is logged.
- `log-capture-self-test`: the capture sees `console.dir`/`table`/`trace` and both streams; the matcher catches base64, hex, case-changed and truncated leaks.

All pass.

**Mutation probes:** 126 temporary probes over nine rounds:
- L01–L20 with L09b, and D01–D08 (the original build);
- R01–R17 (from the first review);
- N01–N21 (from the first re-review);
- S01–S15 (from the second re-review);
- T01–T15 (from the third re-review);
- V01–V09 with V06b (from the fourth re-review);
- W01–W07 (from the fifth re-review);
- X01–X05 (from the sixth re-review);
- Y01–Y07 (from the seventh re-review). None was committed; each file was restored and verified by SHA-256. Results are in §8.

## 5. Findings (no actual application logging leak found)

No sentinel reached any application log or telemetry output, and no review step found one. The findings below are about
**platform-level exposure, data at rest and retention**. They are recorded for Owner decision and **not remediated**: the scope excludes
runtime changes.

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-18-20-01 | Medium (privacy / platform logs) | Open — Owner decision; platform evidence gated | The search UI sends the user's search text (financial text, up to 100 characters) as a **GET query string**: `src/components/reports/report-center.tsx:67`, `src/app/api/search/route.ts:11`. Platform request logs and browser history record query strings. The other query strings carry raw record/household ids, report periods and cursors. Not reproducible in-repo beyond the code path; whether and how long Vercel retains the query is platform-side evidence. Proposed: send search text in a POST body, and confirm the platform log contents and retention. |
| F-18-20-02 | Medium (secrets at rest / minimization) | Open — Owner decision | Auth.js stores raw Google `access_token` and `id_token` in `authAccounts` (`@auth/core` `defaultAccount`, linked once, never refreshed or removed). The `id_token` is a JWT with e-mail, name and picture. `refresh_token` and `session_state` are stored if returned. The app never uses them. They are excluded from backups. Proposed: strip the tokens at link time (an adapter wrapper) and purge existing ones. |
| F-18-20-03 | Medium (retention) | Open — Owner decision | `authSessions` stores the raw bearer `sessionToken` (Auth.js default). It has **no TTL index**: an expired session is deleted only if it is presented again, or on sign-out, so abandoned sessions persist indefinitely. Proposed: a TTL index on `expires`. |
| F-18-20-04 | Medium (retention / erasure) | Open — linked to 18-12 and F-18-14-01 | There is no executable erasure and no purge for almost every collection. Soft deletes keep the content. Derived copies outlive their sources: snapshot labels and notes, reports with other members' names, search index, AI summaries and conversations. |
| F-18-20-05 | Low (pseudonymization quality) | Open | Unkeyed sha256 over low-entropy identifiers and values (e-mail, user id, household name, financial-condition fingerprint) can be linked or brute-forced. They must be treated as personal data, as classified. |
| F-18-20-06 | Low (key management) | Open | Open-banking aliases are HMAC-keyed with `AUTH_SECRET`, shared with authentication, so a rotation orphans every alias (see 18-13). `bankAccountReconciliations.*.comparison.institution` keeps the raw provider institution label next to its HMAC alias. |
| F-18-20-07 | Low (offline/dev data) | Open | `bankDevelopmentArchive.payload` keeps full unencrypted BSON copies of deleted records indefinitely in the database the offline migration ran against. `bankDevelopmentMigrations.protectedRecords` lists ids and digests of every record of all owners. |
| F-18-20-08 | Low (implicit logging) | Open | Raw third-party error messages reach framework and runtime logs without a redaction boundary:
- **Next.js** prints uncaught page and server-action errors verbatim. App-thrown messages are fixed, but a MongoDB E11000 message includes the duplicate key **value**. No such path was observed: pages read only, and the two server actions are sign-in and sign-out.
- **The backup Lambda** passes raw driver/SDK errors to CloudWatch: from connect (`backup-worker.ts:54-55`), dbStats (`:63`), the metric call (`:64`) and S3 writes (`workers/backup/index.ts` rethrows). The review saw host names, no keys or documents.

No `onRequestError` hook and no error-message projection exist. |
| F-18-20-10 | Low (response echo, not a log) | Open — Owner decision | Strict zod schemas report unrecognized object **key names** in the 400 response (`Unrecognized keys: "…"`). This goes back to the requester only and is never logged; values are never echoed. It is pinned by `[log-validation-key-echo]`. Proposed: map `unrecognized_keys` to a fixed message (a runtime change, outside this item). |
| F-18-20-09 | Info (by design) | Recorded | `ledger-mirror/` and `ledger-journal/` never expire and are not app-encrypted (bucket SSE only). Their content is pseudonymous deletion evidence. |

## 6. Residual work (rows stay PARTIAL)

**18-07 (logging/crash):**
- **Platform evidence:**
  - Vercel log contents (incl. query strings), retention, access roles and drains;
  - Atlas log, profiler and audit settings;
  - CloudWatch access;
  - whether `MONGODB_LOG_*` is unset in every environment.
- **Crash/error reporting** for pages and server actions (F-18-20-08).
- **Owner decisions** on F-18-20-01, F-18-20-08 and F-18-20-10.

**18-20 (retention/access):**
- **Owner adoption** (or rejection) of the retention, access and deletion recommendations in `PHASE_18_RETENTION_DRAFT.md`.
- **Then, separately gated:** the implementation of whatever is adopted (TTL indexes, purge jobs, erasure execution, token stripping) with its own tests and migration plan.
- **Platform evidence:**
  - Atlas backup and retention settings;
  - Vercel and AWS log retention and access;
  - provider-side retention (Resend, Anthropic, Google, Financy).
- **Owner decisions** on F-18-20-02 to F-18-20-07.

## 7. Independent review

**Round 1 (2026-10-01).** An adversarial reviewer worked read-only on commit `a83d5f3`, with its own mutations in a scratch copy.

It found **no actual leak in current code** and no scope violation. But 7 of its mutations survived every 18-07/18-20 test, including one real leak injected into scratch code: `stderr.write` of the search index, which carries financial text. All findings were fixed in tests and documents only, with no runtime change:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | The scanner missed aliased and imported sinks: `const { stderr } = process`, `globalThis["console"]`, `node:process`/`node:console` imports, `debuglog`, `writeSync`, `new Console`, `sendBeacon` | Every `process` member outside an inert allowlist, every non-member use of `console`/`process`, sink element keys, sink imports/requires and sink APIs are now sites (R01–R06, R14, R16, R17 detected) |
| 2 | Important | Worker CLI print lines were not pinned (M1 printed a URI, M2 the whole error) | The exact console arguments of the worker CLIs and scripts are pinned (R07, R08 detected) |
| 3 | Important | Classification was enforced at the top level only | Type-checker document trees with the nested-coverage rule, which added 107 audit-trail rows (R09 detected) |
| 4 | Important | Discovery was syntactic: a const-named collection was missed, and `workers/` was not scanned | Every type-resolved collection must be classified, the 14 non-literal call sites are explained per file, and discovery covers `workers/` (R10 detected) |
| 5 | Important | The CloudWatch `PutMetricData` sink was missing | AWS command names and `@aws-sdk` modules are sites. Added the `backup-metrics` sink with `[log-backup-metrics]`, and the SSM/S3 calls as classified non-log I/O (R15 detected) |
| 6 | Minor | Retention scanner gaps: computed TTL keys, `$unset`, `replaceOne`, `findOneAndReplace`, `db.command` | All added. 3 `$unset` and 2 `replaceOne` sites classified (R11, R12 detected) |
| 7 | Minor | The capture missed `console.dir`/`dirxml` | Every console method is spied; `[log-capture-self-test]` |
| 8 | Minor | The matcher missed base64, case-changed and partial leaks | Base64/base64url at all three byte alignments, hex, case-insensitive, 12-character head and tail, per-run unique e-mail domain; covered by the self-test |
| 9 | Minor | Dead tests counted as live (`describe.skip`, `if (false)`, empty bodies) | AST-based liveness check (R13 detected) |
| 10 | Minor | Validation responses echo key names | Recorded as F-18-20-10 and pinned by `[log-validation-key-echo]` (runtime fix out of scope) |
| 11 | Minor | Misclassifications and copied notes | 31 rows corrected. New rules: hashed ids must be pseudonymous identifiers; hashes over personal input are personal |
| 12 | Minor | Count and description errors in this document, and the Lambda claim | Corrected; the Lambda raw messages are now in F-18-20-08 |
| 13 | Minor | The DRAFT did not name `recoveryQuarantine` or `bankDevelopmentMigrationLocks` | Named, together with every other collection |

Two suspected items were recorded:
- **`vercel-ledger-env.ps1`** rethrows the Vercel CLI output on failure. Noted in `operatorPowerShell`; not tested.
- **Auth.js adapter field drift.** Covered by the version pin.

**Round 2: re-review (2026-10-01) of commit `79ef468`**, read-only, with its own mutations in a scratch copy.

Its main results:
- **First-review findings:** M1–M7 detected and the scope clean. Of the 13 first-review findings, 5 were fixed and 8 partially fixed.
- **Leaks:** no actual leak in current code.
- **New bypasses:** 18 of 20 new bypass probes still passed CI.

All were fixed in tests and documents only, again with no runtime change:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | `globalThis.process.stderr.write(…)` bypassed the scanner (`process` as a property name) | `process` is a site in any position; `globalThis`/`global`/`self` are sites (N01) |
| 2 | Important | Re-export `export { stderr as out } from "node:process"` | `export … from` is treated like an import (N02) |
| 3 | Important | Other sink APIs were not caught: `writeFileSync(2, …)`, template-literal `import()`, `Reflect.get(globalThis, "console")`, `new Function(…)`, `child_process` | fs write functions, computed or template imports, sink strings anywhere, `eval`/`Function`, and the `child_process`/network/worker modules are all sites (N03–N07) |
| 4 | Important | Outbound HTTP was not inventoried | Every fetch-like call outside same-origin path literals is a site. The provider adapters, client API calls, file writes, subprocesses and the client cache are classified (N08) |
| 5 | Important | The pinned console text was blind to a changed value | Replaced by SHA-256 pins of every operator-run file (N09) |
| 6 | Minor | PowerShell scripts were listed by name only | Included in the file pins (N10) |
| 7 | Important | Live-test false negatives: `describe.skipIf(…)(…)`, `ctx.skip()`, assertion-free bodies, `cond && it(…)` | Assertion means an `expect…` call; self-skips, conditional placement and chained skip callees are dead (N11–N13, N21) |
| 8 | Important | Blind subtrees covered by one row (e.g. a new `accountNumber` in TI evidence) | 50 subtree shape pins. Added `source.*` rows (with HMAC aliases) to the 8 other manual sections (N14) |
| 9 | Important | Writes outside the document type (`$set: { recipientEmail }`) | Undeclared literal write paths on typed collections fail (N15); the remaining limit is stated in §1 |
| 10 | Important | Collections opened untyped through a const name, or via `createCollection` | Every type-resolved name in `collection`/`createCollection` must be classified; one more non-literal site explained (N16, N17) |
| 11 | Minor | Retention-scanner variants: const-key TTL, `db.command(cmd)`, pipeline `$replaceWith`, `$pull`/`$rename` | Same-file constant resolution, `command:dynamic`, `pipeline-update` and the removal keys (N18–N20) |
| 12 | Minor | Matcher weaknesses: base64 alignment, head truncation, constant e-mail domain | Fixed and covered by the self-test |
| 13 | Minor | `Console` flagged in type positions | Type positions are ignored |
| 14–15 | Minor | Stale counts (§3, hardening package) and overstated §1 claims | Recounted; §1 rewritten with an explicit limits paragraph |

**Round 3: second re-review (2026-10-01) of commit `06de2d8`**, read-only, with 36 probes in a scratch copy.

Its main results:
- **Round-2 fixes:** confirmed for the exact bypasses.
- **Leaks:** no actual leak in current code.
- **Severity:** no Critical finding.
- **Verdict:** not ready as written, because two §1 guarantees did not hold (a new telemetry SDK, and silenced sentinel tests).

Fixed in tests and documents only:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | New telemetry SDKs (Vercel Analytics/Speed Insights, GTM via `<Script>` and a widened CSP) passed CI | Reviewed-dependency allowlist; exact CSP pin; literal external URLs in JSX and `next/script` are sites (S01–S03) |
| 2 | Important | A sentinel test could be silenced by an early `return` (env guard), a destructured `skip()`, an aliased `describe.skipIf`, or `describe.each([])` | All four are dead in the live-test check (S04–S07) |
| 3 | Important | Fields written through spreads or variables escaped (`accountNumber` in `SearchIndexItem` spread into `insertMany`; a variable insert document) | The undeclared-write check compares the written value's type, not only literal keys (S08, S09) |
| 4 | Minor | The restore-drill output checked top-level keys only | Exact nested keys of `fence`, `recoveryPoint`, `timings`, `barriers` and the package-name format (S10) |
| 5 | Minor | `$out`/`$merge`, `rename(…, { dropTarget })` and variable pipeline updates were not inventoried | Added as retention sites (`$out`, `$merge`, `rename`, `dynamic-update`) (S11–S13) |
| 3a | Minor | fs/promises `open(…).write` and a protocol-relative `fetch("//…")` | Both flagged (S14, S15) |
| 6 | Minor | §3 table missing `backup-metrics`; §2 `source.*` wording; §8 overall claim | Corrected |
| 7 | Minor | Timeout margin of the retention test | Explicit 60 s timeouts on every classification test |

**Round 4: third re-review (2026-10-02) of commit `ce77c7a`**, read-only, with 29 probes in a scratch copy.

Its main results:
- **Round-3 fixes:** fixed for the exact forms.
- **Leaks:** no actual leak in current code.
- **Verdict:** not ready, because three §1 guarantees could still be defeated by plausible, non-obfuscated changes with CI green.

Fixed in tests, the test config and CI only, with no runtime change:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | CSP pin bypassable: a template-literal directive, an extra `headers()` entry, or a `proxy.ts` header (confirmed in `next dev`) | The headers `headers()` returns at run time are pinned exactly; a CSP header name elsewhere is a site; entry points stay inventoried (T01–T03) |
| 2 | Important | Sentinels silenced: `beforeEach` skip, conditional assertion, helper early return, `each` over an empty variable, uncalled registrar, swallowing `try/catch` | Run-time enforcement: a reporter fails CI unless all 50 required ids ran and passed. `expect.requireAssertions` for every test. Static `try/catch` rule (T06–T10). The route-harness helpers now assert through `expect` |
| 3 | Important | Update-operator values not type-checked, and the existing `updateEmail` Record path unclassified | Operator values are type-checked against `T`. Open values are explained (`dynamicUpdateSites`) with their callers' keys checked (T11–T13) |
| 4 | Minor | `$pullAll`, `$push` + `$slice`, capped collections | Added. Blanking via `$set: null` stated as a limit (T14, T15) |
| 5 | Minor | External URLs outside plain JSX string attributes | Any external-URL string or template literal in `src/`/`workers/` is a site. This also surfaced the AWS STS call behind `(input.fetch ?? fetch)(…)`, now classified (T04, T05) |
| 6 | Low | The CLIs' "fixed error categories" wording; no target-URI assertion | §3 reworded (raw driver messages possible, F-18-20-08); `not.toContain(targetUri)` added |
| 7 | Minor | §1, §3 and §8 overstatements | Rewritten as above |
| — | Stability | `iso-household-*` multi-step tests could exceed 5 s under full-suite load (seen during a probe run) | 30 s timeouts. With CI enforcement, a flake would otherwise fail the run |

**Round 5: fourth re-review (2026-10-02) of commit `47dc232`**, read-only.

Its main results:
- **CI and confirmations:** CI was green with all 50 ids enforced. It confirmed that the reporter fails the exit code, that all counts matched, and that no runtime code changed.
- **Leaks:** no actual leak in current code.
- **Verdict:** not ready, because three bypasses had CI green.

Fixed in tests, the test config and CI only:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | The inventory tests themselves (no ids) could be skipped with CI green | The reporter requires every test of the 5 inventory modules (exact counts) and every `[iso-…]`/`[log-…]` id in any test title (V01, V02) |
| 2 | Important | A CLI `--reporter` flag, or an edit to the env/config, disabled the run-time enforcement | Marker file plus a separate CI verify step; an inventory test pins the vitest and CI wiring and requires `REQUIRE_SECURITY_TESTS=1` under `CI` (V03–V05, V09) |
| 3 | Important | Hiding the `Record` spread behind an intermediate variable lost the dynamic-update caller check | Any open spread in a writing function (variables, nested closures) is a dynamic site; caller keys are checked for method, function and arrow owners; a vanished entry fails with a re-verify message (V06, V06b, V07) |
| 4 | Minor | Header claim broader than enforced (`vercel.json`, route-handler headers) | Platform configs must not exist unclassified (V08); §1 narrowed to CSP; non-CSP route headers stated as a limit |
| 5 | Minor | Google OAuth and driver STS/IMDS egress not recorded | Recorded in `reviewedDependencies` and the implicit table |
| 6 | Low | Hardening-package counts, the S02 kind name, `[iso-session-invalid]` not required | Corrected; now required through the title scan |

**Round 6: fifth re-review (2026-10-02) of commit `6b29950`**, read-only.

Its main results:
- **Round-5 fixes:** they held under its own variants (inventory skip, module rename, uncounted test, class-field spread, reporter/env wiring).
- **Leaks:** no actual leak in current code.
- **Verdict:** not ready, because two bypasses had CI green.

Fixed in tests only:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | `it.fails` passes the run-time check (an expected failure reports as passed), together with a real leak | Any test with `options.fails` is rejected (W01) |
| 2 | Important | next.config `rewrites()`/`redirects()` unpinned. An env-origin rewrite forwarded the session cookie off-site (confirmed in `next dev` by the reviewer) | The evaluated config's keys are pinned exactly (W02, W03) |
| 3 | Minor–Important | Open spread outside the writing closure, in another file's helper, or via `Object.assign` | Global open-value inventory (`openValueSites`) (W04–W06) |
| 4 | Low | Platform config list was fixed names | Name pattern over root/`public`/`src` (W07) |
| 5 | Minor | Stale "7 tests" count | Corrected |

**Round 7: sixth re-review (2026-10-02) of commit `438f7c1`**, read-only, verification-focused.

Its main results:
- **Round-6 fixes:** all held against its own variants (`it.fails`/`test.fails`/describe and tag options, function-exported config, class-method and helper-file spreads, platform names).
- **Leaks:** no actual leak in current code.
- **Verdict:** not ready, because of one blocker.

Fixed in tests only:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | An env-conditional next.config key (a production-only rewrite) is absent when the config is evaluated under test | next.config.ts is SHA-256-pinned; no other `next.config.*` may exist; `ROOT_CONFIG` includes `.mts`/`.cjs` (X01, X02) |
| 2 | Minor | The `updateEmail` caller check verified keys only; a direct `$set: param` had no caller check | Values under each key are type-checked against `T`; a direct `$set: param` registers the same caller check (X03, X04) |
| 3 | Low | Query-parameter names were not pinned | `queryParameters` pins the server-side reads per file (X05); the remaining page/client side is stated as a limit |
| — | Low | §8 said each probe edited one file (W01 edited two); §1 wording | Corrected |

**Round 8: seventh re-review (2026-10-02) of commit `76dbd8e`**, read-only, verification-only.

Its main results:
- **Round-7 fixes:** all held for their exact forms (next.config digest and single-config check, caller value shapes, direct `$set: param`, query pin).
- **Regressions:** none, no flakes; two enforced full runs passed.
- **Leaks:** no actual leak in current code.
- **Verdict:** not ready, because of one blocker.

Fixed in tests only:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Important | Aliasing the open parameter (`const fields = set`, a rest destructure) silently dropped the caller check | Open values are traced through aliases to their parameter. Anything untraceable becomes a distinct `dynamic:untraced` site (Y01–Y03) |
| 2 | Minor | Any object was accepted under a primitive-typed field | Primitive/leaf nodes reject children (Y04, Y05); `unknown` values stated as a limit |
| 3 | Low | Names read via `entries()` / `URLSearchParams(url.search)` were not pinned | `searchQueryKeys` pins the search schema; every `URLSearchParams` construction is a pinned site (Y06, Y07); wording corrected |

## 8. Mutation evidence

Nine rounds of temporary probes were run on 2026-10-01/02: 126 probes in total. Each probe edited a single file or created one (W01, run by hand, edited two), ran the named tests, then restored the exact bytes; every restore was SHA-256-verified (a created file verified as removed), nothing was committed, and `git status` on `src/ workers/ scripts/ infra/ next.config.ts package.json` was empty after every round. Each later round re-ran all earlier probes against the strengthened tests. The run-time probes (T06–T10) ran the full suite with `REQUIRE_SECURITY_TESTS=1`.

| Probe | Mutation | Result |
| --- | --- | --- |
| L01 | Telemetry projection also emits `requestId` | Detected by `log-provider-projection`, `log-ai-sink`, `log-notification-sink` |
| L02 | Category allowlist removed (any string passes) | Detected by the same three tests |
| L03 | Count bounds removed | Detected by `log-provider-projection` |
| L04 | AI sink also logs `model` | Detected by `log-ai-sink`, `log-report-summary-path`, `log-ai-service-path` |
| L05 | Notification sink also logs `requestId` | Detected by `log-notification-sink`, `log-resend-path` |
| L06 | Auth logger also logs the error message | Detected by `log-auth-logger` |
| L07 | Auth `debug()` prints its arguments | Detected by `log-auth-logger` and the emission inventory |
| L08 | Route error log includes the error | Detected by `log-route-error` |
| L09 | Validation message appends `issue.input` | **Survived**: zod 4 does not attach `input` to issues unless asked, so the probe leaked nothing. Replaced by L09b |
| L09b | Validation message appends the submitted input | Detected by `log-validation-echo` |
| L10 | Resend rethrows the raw provider error | Detected by `log-resend-path` (thrown-error check) |
| L11 | Auth.js `debug: true` | Detected by `log-auth-config` |
| L12 | Auth.js `logger` removed | Detected by `log-auth-config` and the emission inventory |
| L13 | New `console.log` in a service | Detected by the emission inventory |
| L14 | New telemetry `.emit()` site | Detected by the emission inventory |
| L15 | Ledger-rebuild summary also prints `plan.rows` | Detected by `log-operator-scripts` (pinned summary) |
| L16 | An operator script prints the URI | Detected by `log-operator-scripts` and the pinned outputs |
| L17 | `next.config` `logging.fetches.fullUrl` | Detected by the emission inventory |
| L18 | `pino` dependency added | Detected by the SDK check |
| L19 | `monitorCommands` in code | Detected by the driver-logging check |
| L20 | A sentinel test skipped | Detected by the emission inventory (live-test check) |
| D01 | New field `email` on the profile document type | Detected by the type-checker field check |
| D02 | New transaction field `counterpartyIban` | Detected by the manual-section zod check |
| D03 | New collection `profileExports` | Detected by both collection inventories |
| D04 | New TTL index on profiles | Detected by the retention-mechanism inventory |
| D05 | New `deleteMany` purge path | Detected by the retention-mechanism inventory |
| D06 | Package expiry changed to 365 days | Detected by the template-retention check |
| D07 | Email hash reclassified as non-personal | Detected by the pseudonymization rule |
| D08 | A hash field reclassified as a raw secret | Detected by the raw-secret list |
| R01 | `const { stderr } = process; stderr.write(items)` in the search rebuild (the reviewer's real-leak mutation) | Detected by the emission inventory |
| R02 | `globalThis["console"].log(items)` | Detected by the emission inventory |
| R03 | `import { stdout } from "node:process"` | Detected by the emission inventory |
| R04 | `debuglog` from `node:util` | Detected by the emission inventory |
| R05 | `writeSync(2, …)` from `node:fs` | Detected by the emission inventory |
| R06 | `new Console(…)` from `node:console` | Detected by the emission inventory |
| R07 | Restore-drill CLI prints the target URI (reviewer M1) | Detected by the pinned outputs |
| R08 | Ledger-rebuild CLI prints the whole error (reviewer M2) | Detected by the pinned outputs |
| R09 | Nested `notifications.email.recipientEmail` (reviewer M4) | Detected by nested coverage |
| R10 | Collection opened through a const name (reviewer M5) | Detected by the type-resolved collection check |
| R11 | Computed `["expireAfterSeconds"]` TTL (reviewer M6) | Detected by the retention-mechanism inventory |
| R12 | `updateMany` with `$unset` (reviewer M7) | Detected by the retention-mechanism inventory |
| R13 | A sentinel test wrapped in `if (…)` | Detected by the live-test check |
| R14 | `console.dir(items)` | Detected by the emission inventory |
| R15 | A new metric dimension | Detected by `log-backup-metrics` |
| R16 | `const p = process; p.stdout.write(…)` | Detected by the emission inventory |
| R17 | `const { log } = console; log(items)` | Detected by the emission inventory |
| N01 | `globalThis.process.stderr.write(items)` | Detected by the emission inventory |
| N02 | `export { stderr as out } from "node:process"` | Detected by the emission inventory |
| N03 | `writeFileSync(2, …)` from `node:fs` | Detected by the emission inventory |
| N04 | ``(await import(`node:process`)).stderr.write(…)`` | Detected by the emission inventory |
| N05 | `Reflect.get(globalThis, "console").log(items)` | Detected by the emission inventory |
| N06 | `new Function("return this")()["con" + "sole"].log(items)` | Detected by the emission inventory |
| N07 | `execFileSync(…, { stdio: "inherit" })` | Detected by the emission inventory |
| N08 | `fetch("https://collector…", { body: items })` | Detected by the emission inventory |
| N09 | Restore-drill CLI: `Object.assign(result, { targetUri })` before an unchanged print | Detected by the operator-file pins |
| N10 | `Write-Host "target: $env:RESTORE_TARGET_URI"` in `recovery-drill.ps1` | Detected by the operator-file pins |
| N11 | Sentinel suite wrapped in `describe.skipIf(true)(…)` | Detected by the live-test check |
| N12 | `ctx.skip()` inside `[log-backup-metrics]` | Detected by the live-test check |
| N13 | `[log-backup-metrics]` body without an assertion | Detected by the live-test check |
| N14 | `accountNumber` added to TI `StoredEvidence` | Detected by the subtree shape pins |
| N15 | `$set: { recipientEmail }` on `Collection<NotificationDocument>` | Detected by the undeclared-write check |
| N16 | Untyped collection opened through a const name | Detected by the resolved-collection check |
| N17 | `createCollection<…>("probeSecrets2")` | Detected by the resolved-collection check |
| N18 | TTL through a const computed key | Detected by the retention-mechanism inventory |
| N19 | `db.command(cmd)` with a non-literal drop | Detected by the retention-mechanism inventory |
| N20 | Pipeline update with `$replaceWith` | Detected by the retention-mechanism inventory |
| N21 | `Date.now() > 0 && it("[log-backup-metrics]…")` | Detected by the live-test check |
| S01 | `@vercel/analytics` dependency added | Detected by the dependency allowlist |
| S02 | Third-party `<script src="https://www.googletagmanager.com/…">` in the root layout | Detected by the emission inventory (`url:external`, formerly `jsx:external-url`) |
| S03 | `script-src` widened to a third-party origin | Detected by the CSP pin |
| S04 | `if (!process.env.X) return;` at the top of `[log-backup-metrics]` | Detected by the live-test check |
| S05 | `({ skip }) => { skip(); … }` | Detected by the live-test check |
| S06 | `const probeSuite = describe.skipIf(true); probeSuite(…)` | Detected by the live-test check |
| S07 | `describe.each([])(…)` around the sentinel suite | Detected by the live-test check |
| S08 | `accountNumber` added to `SearchIndexItem` (spread into the search index) | Detected by the undeclared-write check |
| S09 | `const doc = { ...document, recipientEmail }; insertOne(doc)` | Detected by the undeclared-write check |
| S10 | Restore drill puts the target URI under `fence` | Detected by `log-restore-drill-output` |
| S11 | `aggregate([…, { $out: "searchExport" }])` | Detected by the retention-mechanism inventory |
| S12 | `rename("profilesOld", { dropTarget: true })` | Detected by the retention-mechanism inventory |
| S13 | `updateMany({}, update)` with a variable pipeline | Detected by the retention-mechanism inventory |
| S14 | `(await open("probe.log", "w")).write(value)` from `node:fs/promises` | Detected by the emission inventory |
| S15 | `fetch("//collector.example/…")` | Detected by the emission inventory |
| T01 | Template-literal `connect-src` with an env origin in the CSP array | Detected by the run-time headers pin and the emission inventory |
| T02 | Extra `headers()` entry overriding CSP for `/reports/:path*` | Detected by the run-time headers pin and the emission inventory |
| T03 | New `src/proxy.ts` that sets a CSP header | Detected by the request-entry-point inventory and the emission inventory |
| T04 | `<img src={"https://collector…"}>` in the root layout | Detected by the emission inventory (`url:external`) |
| T05 | Script `src={`${CONST}/tag.js`}` through a constant | Detected by the emission inventory (`url:external`) |
| T06 | Sentinel assertions wrapped in a swallowing `try/catch` | Detected by the static live-test check |
| T07 | Sentinel assertion inside `if (process.env.X)` | Detected at run time (`requireAssertions`: the test executed no assertion; confirmed in isolation) |
| T08 | `beforeEach(({ skip }) => …skip())` in the sentinel suite | Detected at run time (required ids skipped) |
| T09 | `describe.each(noCases)` with an empty variable table | Detected at run time (required ids not registered) |
| T10 | Sentinel test inside an uncalled registrar function | Detected at run time (required id not registered) |
| T11 | A new `updateEmail` caller writing `email.recipientEmail` | Detected by the caller-key check of the dynamic update |
| T12 | `$set: extra` with `extra: Record<string, unknown>` | Detected as an unexplained dynamic update |
| T13 | `$push: { auditTrail: entry }` with an extra field in `entry` | Detected by the update-value type check |
| T14 | `$pullAll` | Detected by the retention-mechanism inventory |
| T15 | `$push` with `$each`/`$slice` (capped history) | Detected by the retention-mechanism inventory |
| V01 | `it.skip` on the run-time headers pin | Detected at run time (inventory module count) |
| V02 | `it.skip` on the undeclared-write check | Detected at run time (inventory module count) |
| V03 | `npm test -- --reporter=junit` in the CI test step | Detected by the enforcement-wiring test |
| V04 | `REQUIRE_SECURITY_TESTS` removed from the CI step | Detected by the enforcement-wiring test |
| V05 | Reporter removed from vitest.config.mts | Detected by the enforcement-wiring test |
| V06 | `updateEmail` refactored through `const fields = { ...set, … }` plus a caller writing `email.recipientRawBody` | Detected by the undeclared-write check (open spread + caller keys) |
| V06b | The same through an IIFE closure | Detected by the undeclared-write check |
| V07 | An arrow-function helper with a `Record` parameter, and a caller with an undeclared key | Detected by the undeclared-write check (arrow owner) |
| V08 | `vercel.json` setting a CSP header | Detected by the platform-config check |
| V09 | `--reporter=default` with enforcement on: vitest exits 0, but no marker is written | Detected by the CI marker step (exit 1, run by hand) |
| W01 | A real leak (`console.log(items)` in the search index rebuild) plus `it.fails` on the emission inventory | Detected at run time (`expected-to-fail` rejected; run by hand, both files restored and SHA-verified) |
| W02 | next.config `rewrites()` to an env-defined origin (proxies the session cookie off-site) | Detected by the evaluated-config pin |
| W03 | next.config `redirects()` | Detected by the evaluated-config pin |
| W04 | An open spread in the method, with the write in a closure and a caller with an undeclared key | Detected by the open-value inventory |
| W05 | A `withUpdatedAt(set)` helper spreading a `Record` in another file | Detected by the open-value inventory |
| W06 | `Object.assign(fields, set)` into a typed object | Detected by the open-value inventory |
| W07 | A `vercel.ts` setting a CSP header | Detected by the platform-config check |
| X01 | Production-only rewrite (`...(NODE_ENV === "production" && origin ? { rewrites } : {})`) in next.config.ts | Detected by the next.config.ts digest pin |
| X02 | A second config file `next.config.mts` | Detected by the single-config check (and the evaluated-config pin) |
| X03 | A new `updateEmail` caller writing `email: { ...notification.email, providerResponse }` | Detected by the caller value-shape check |
| X04 | A direct `$set: set` helper with a `Record` parameter, and a caller with an undeclared key | Detected by the direct-parameter caller check |
| X05 | A new `searchParams.get("note")` in the search route | Detected by the query-parameter pin |
| Y01 | `const fields = set; $set: { ...fields, … }` plus a caller writing `email.recipientRawBody` | Detected (the alias is traced; caller key checked) |
| Y02 | The same through `const { updatedAt: _ignored, ...fields } = set` | Detected (rest-destructure traced; caller key checked) |
| Y03 | An untraceable open value (`Object.fromEntries(Object.entries(set))`) spread into `$set` | Detected (`dynamic:untraced` is a new, unexplained site) |
| Y04 | A caller writing an object under the string field `email.providerMessageId` | Detected by the primitive-leaf rule |
| Y05 | A typed `$set` writing an object under `email.errorCategory` | Detected by the primitive-leaf rule |
| Y06 | A new `note` key in `searchQuerySchema` (read via `entries()`) | Detected by `searchQueryKeys` |
| Y07 | `new URLSearchParams(url.search).get("note")` in the reports route | Detected by the query-parameter pin |

125 of 126 probes were detected. The one survivor, L09, was an ineffective probe (it could not leak anything); its effective replacement, L09b, was detected. Every exact mutation and bypass reported by the eight reviews is detected. The guarantees that the reviews showed static checks could not hold (test liveness, security headers) are now checked at run time. The remaining limits are stated in §1.
