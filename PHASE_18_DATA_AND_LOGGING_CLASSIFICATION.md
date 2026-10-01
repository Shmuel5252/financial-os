# Phase 18 rows 18-07 and 18-20: data classification, retention inventory and logging/telemetry sinks (repository portion)

Status: **repository portion built 2026-10-01; rows 18-07 and 18-20 stay PARTIAL.** This document describes what the code does
today. It adopts no retention period, access role or deletion mechanism; the recommendations live separately in
`PHASE_18_RETENTION_DRAFT.md` (**DRAFT / NOT ADOPTED**). No runtime code, TTL index, deletion job, logging behaviour, application data
or infrastructure was changed in this item.

## 1. Sources of truth and CI enforcement

| Artifact | What it holds | CI test |
| --- | --- | --- |
| `tests/security/data-classification.ts` | 55 collections, 1,034 field rows (class, personal-data level, transform, note), current retention with `file:line`, raw secrets at rest, TTL/hard-delete inventory, template retention, data stores outside MongoDB, out-of-scope list | `tests/unit/data-classification.test.ts` (7 tests) |
| `tests/security/logging-sink-matrix.ts` | 7 sinks covering every emission point, per-field treatment, implicit sinks, PowerShell operator scripts | `tests/unit/logging-sink-inventory.test.ts` (5 tests) |
| `tests/unit/logging-sentinels.test.ts`, `tests/integration/logging-sentinels.integration.test.ts`, `[log-…]` tests in the recovery suites | sentinel tests per sink | run in `npm test` |

CI fails when:
- **Collections.** A collection appears or disappears. Discovery is AST-based: literals, `as const` names, and the manual-section, auth and ledger maps.
- **Top-level fields.** A typed collection's top-level fields differ from the TypeScript document type. These are read with the type checker from every `.collection<T>(…)` call; manual sections also use `ManualRecordDocument`.
- **Manual-section fields.** A manual section's `fields.*` keys differ from its zod domain schema.
- **Pseudonymized identifiers.** A hashed or HMAC identifier is not marked `pseudonymous`, or any value is described as "anonymous".
- **Raw secrets.** A new raw secret field appears.
- **TTL and hard deletes.** A TTL index option or hard-delete call (`deleteOne`/`deleteMany`/`findOneAndDelete`/`drop*`/`bulkWrite`/`remove`) appears in `src/`, `workers/` or `scripts/` without classification.
- **Backup template retention.** The backup template's lifecycle, Object Lock or log-group retention changes.
- **Emission points.** Any emission point is unclassified, stale or miscounted. Emission points are `console.*`, `process.stdout`/`stderr`/`emitWarning`, telemetry `.emit()`, and `logger`/`debug`/`logging` config keys in `src/`, `workers/`, `scripts/` and `next.config`.
- **Sentinel tests.** A sink's sentinel test is not a live `it()`/`test()`.
- **Dependencies and driver logging.** A logging or telemetry SDK is added, or MongoDB driver command logging is enabled in code.
- **Auth.js logging.** Auth.js `debug` or the redacting logger changes.
- **Operator output.** An operator script prints env values, URIs, secrets or raw error messages.
- **Ledger-rebuild summary.** The ledger-rebuild CLI's printed summary gains a field.

## 2. Collection and field coverage

The classification was produced by three independent read-only source traces and then reconciled against the type checker. The
reconciliation is exact for every typed collection. The Auth.js adapter collections are checked as a superset of the app's typed views.

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
| indirect | 500 |
| pseudonymous | 30 |
| none | 494 |

Field rows by transform:

| Transform | Field rows |
| --- | --- |
| raw | 796 |
| derived | 105 |
| sha256 | 84 |
| hmac | 34 |
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

There are 27 emission-site keys and 50 occurrences, grouped into 7 sinks. Treatments in the table:
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
| Auth.js logger | `safe-logger.ts` (error/warn/debug), `config.ts` (`debug: false`, `logger`) | Vercel function logs | Emitted:<br>- category (enum by `instanceof`)<br>- random correlationId<br>- literal version<br><br>The error message, cause, stack and debug data are never read |
| Route error | `route-response.ts` | Vercel function logs | Emitted:<br>- literal message<br>- random correlationId<br>- literal errorName<br><br>The error is never read. The response body carries only a fixed message, or validation field paths and zod messages (no input values) |
| Restore-drill CLI | `workers/restore-drill/cli.ts` ×2 | Operator terminal | Package name, counts, heads, numeric barriers, timings; fixed error categories |
| Ledger-rebuild CLI | `workers/ledger-rebuild/cli.ts` ×3 | Operator terminal | Pinned 7-field summary (head, row count, digest, mirror names/heads, journal revisions); fixed error categories |
| Operator scripts | 10 `scripts/*.mjs` keys (24 calls) + 5 PowerShell scripts | Operator terminal; `security-check` and `index-manifest` also in Actions logs | Fixed status lines, counts, names, codeName only |

**Implicit sinks** (`implicitSinks`) are logged by the framework, runtime or platform rather than by repository code:

| Implicit sink | What it logs | Status |
| --- | --- | --- |
| Next.js server error logging | Pages and server actions only (route handlers catch errors) | See F-18-20-08 |
| Lambda runtime | The backup worker's fixed fail-closed messages, sent to CloudWatch (30 days) | — |
| Vercel request logs | URL query strings | See F-18-20-01 |
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

**Tests (11 sentinel tests):**
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

All pass.

**Mutation probes:** 28 temporary probes (L01–L20, D01–D08). None was committed; each file was restored and verified by SHA-256. Results are in §8.

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
| F-18-20-08 | Info (implicit logging) | Open | Next.js prints uncaught page and server-action errors verbatim. App-thrown messages are fixed, but a third-party message would be printed as is: for example, a MongoDB E11000 message includes the duplicate key **value**. No such path was observed: pages read only, and the two server actions are sign-in and sign-out. There is no framework-level redaction hook (`onRequestError`). |
| F-18-20-09 | Info (by design) | Recorded | `ledger-mirror/` and `ledger-journal/` never expire and are not app-encrypted (bucket SSE only). Their content is pseudonymous deletion evidence. |

## 6. Residual work (rows stay PARTIAL)

**18-07 (logging/crash):**
- **Platform evidence:**
  - Vercel log contents (incl. query strings), retention, access roles and drains;
  - Atlas log, profiler and audit settings;
  - CloudWatch access;
  - whether `MONGODB_LOG_*` is unset in every environment.
- **Crash/error reporting** for pages and server actions (F-18-20-08).
- **Owner decisions** on F-18-20-01 and F-18-20-08.

**18-20 (retention/access):**
- **Owner adoption** (or rejection) of the retention, access and deletion recommendations in `PHASE_18_RETENTION_DRAFT.md`.
- **Then, separately gated:** the implementation of whatever is adopted (TTL indexes, purge jobs, erasure execution, token stripping) with its own tests and migration plan.
- **Platform evidence:**
  - Atlas backup and retention settings;
  - Vercel and AWS log retention and access;
  - provider-side retention (Resend, Anthropic, Google, Financy).
- **Owner decisions** on F-18-20-02 to F-18-20-07.

## 7. Independent review

Pending (the next step after this build): adversarial review → fixes → re-review, recorded here.

## 8. Mutation evidence

29 temporary probes were run on 2026-10-01. Each one edited a single file, ran the named tests, then restored the exact bytes; every restore was SHA-256-verified, nothing was committed, and `git status` on `src/ workers/ scripts/ infra/ next.config.ts package.json` was empty afterwards.

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
| L16 | An operator script prints the URI | Detected by `log-operator-scripts` |
| L17 | `next.config` `logging.fetches.fullUrl` | Detected by the emission inventory |
| L18 | `pino` dependency added | Detected by the SDK check |
| L19 | `monitorCommands` in code | Detected by the driver-logging check |
| L20 | A sentinel test skipped | Detected by the emission inventory (live-test check) |
| D01 | New field `email` on the profile document type | Detected by the type-checker field check |
| D02 | New transaction field `counterpartyIban` | Detected by the manual-section zod check |
| D03 | New collection `profileExports` | Detected by both collection inventories |
| D04 | New TTL index on profiles | Detected by the TTL/hard-delete inventory |
| D05 | New `deleteMany` purge path | Detected by the TTL/hard-delete inventory |
| D06 | Package expiry changed to 365 days | Detected by the template-retention check |
| D07 | Email hash reclassified as non-personal | Detected by the pseudonymization rule |
| D08 | A hash field reclassified as a raw secret | Detected by the raw-secret list |

28 of 29 probes were detected. The one survivor, L09, was an ineffective probe (it could not leak anything); its effective replacement, L09b, was detected.
