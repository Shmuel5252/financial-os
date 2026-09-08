# Phase 18 — entry evidence and first-slice acceptance matrix

## Status and authority — 2026-09-08

**Phase 18 NOT accepted. First slice only; no Phase 19, commit or push authorized.** Reviewed base: `812b280e679bdf7bdc5b9a8f031262cd3a2c202f`. The base working tree was clean and local `origin/main` matched; this slice does not claim a fresh remote/deployment inspection. No infrastructure/provider mutation, paid refresh, key change, user-data deletion, or financial-domain change is authorized.

Evidence classes: **R** = repository code/tests or dated recorded verification; **O** = owner/operator-reported deployed verification; **X** = external verification still absent. A successful local build is not a hosted production acceptance test. Vercel's environment label `Production` can serve the dedicated staging project; it does not make Financial OS launched.

### Current evidence superseding older current-state claims

- **R:** Accepted Phase 9 commit `78e0e434383e9e9bb9d09c1b062dd5740dcf5862`; PHASE_9_ACCEPTANCE_REPORT.md preserves its precise Financy staged boundary, development-baseline exception, lifecycle and idempotency evidence. Phases 10–17 remain accepted. General multi-user hosted bank onboarding was not verified.
- **R:** Management cleanup `4a88eac35b9979cca4bd55e85666a0d1bdad24a9` and MANAGEMENT_UX_QA.md. Auth lifecycle fix `812b280` defers Mongo connection until an awaited adapter operation, permits retry through the cache, and uses a bounded production 30-second discovery budget. The prior checkpoint passed 367 tests with one explicit skip and six excluded external/destructive files; type-check, zero-warning lint and build passed. Those counts are historical, not this slice's results.
- **O:** Owner confirmed on 2026-09-08 that Vercel staging is Git-connected to origin/main, deployed Atlas persistence and Google/Auth.js login work, a real full Google login passed after `812b280`, and deployed management UX QA passed. The former pending login gate is satisfied by this operator evidence. This does not prove the unique cause of the earlier PKCE incident or all cold-start/failure cases.
- **X:** Deployment URL/ID/settings, DB namespace separation, Atlas roles/network/backup tier, separate Google/provider credentials, incident routing, restore and rollback evidence have not been independently inspected in this slice. Absence of local `.vercel/project.json` means no CLI linkage here, not absence of the owner-confirmed remote project.

### Approved directions, not new unresolved questions

Dedicated staging, distinct local/staging/future-production databases and environment secrets, no unapproved production-user data; RPO <=24 hours, RTO <=4 hours, 30-day backup history, and real isolated restore verification. Provisional SLO: 99.5% successful eligible core requests over rolling 30 days. Initial staging load: 10 concurrent active synthetic users for 30 minutes. Admin: explicit allowlist with metadata/health/control only, never private-finance browsing. Authentication and versioned Financy identity keys must eventually be separable; no rotation/migration now. Full-erasure versus immutable-audit retention is deliberately unresolved.

## Exact Phase 18 acceptance matrix

Statuses describe the whole row, not phase acceptance. **satisfied** is bounded to its stated evidence; **partially satisfied** needs remaining work; the other statuses name the next gate. Multiple remaining gates are listed explicitly.

| ID | Roadmap prerequisite / requirement | Status | Evidence now | Required acceptance evidence / next gate |
| --- | --- | --- | --- | --- |
| 18-01 | Accepted feature candidate | satisfied | R: Phases 0–17 including staged Phase 9; accepted maintenance commits | Preserve their qualifications; no general Financy launch claim |
| 18-02 | Chosen platform and working hosted auth/persistence | satisfied | O: Vercel + Atlas + real Google login after 812b280 | Record deployment metadata in next slice; no speculative auth repair |
| 18-03 | Local/staging/future-production isolation | pending external verification | Approved policy; config accepts separate runtime values | Verify namespace/roles/credential scopes/data provenance and preview isolation |
| 18-04 | Vercel TLS/origin/runtime/least-privilege configuration | pending external verification | O: working deployment; R: explicit AUTH_URL, secure-cookie contract | Inspect HTTPS/callback host, region, limits, permissions, preview protection and deployment gates |
| 18-05 | Rate limiting and abuse resistance | partially satisfied | R: Mongo atomic per-actor counters, TTL, 30/minute/scope mutations, Copilot 10/hour | Auth-edge and expensive GET coverage; distributed/concurrent/deployed failure tests; capacity/budget policy |
| 18-06 | CSP and security headers | partially satisfied | R: frame denial, nosniff, permissions/referrer/CSP baseline | Nonce/strict-script CSP rollout and real browser validation; HTTPS-specific HSTS review; no current app HSTS |
| 18-07 | Safe error/API/bank/AI/calculation logging | partially satisfied | R: typed errors, provider categories, minimized metadata; this slice's Auth.js logger fix | Unified bounded events/metrics/correlation, third-party/platform URL/exception review; no raw causes/financial values |
| 18-08 | Health, monitoring and basic admin | pending repository work | R: public static liveness only | Protected/bounded readiness, explicit allowlist, safe aggregate health, real alert delivery and failure detection |
| 18-09 | SLO/error-budget/performance metrics | partially satisfied | Approved provisional 99.5%/30 days; existing report/search fixture targets | Define eligible requests, bad events, exclusions, latency buckets, alert/burn actions and operator; real measurement, not inferred monthly compliance |
| 18-10 | Canonical-data backups / 30-day retention | pending external verification | Approved RPO/RTO/history; inventory in PHASE_18_DATA_INVENTORY.md | Actual backup configuration, encrypted/access-limited storage, successful schedule and failure alert; approved alternative if tier insufficient |
| 18-11 | Restore/integrity/deletion-safe recovery | pending external verification | Approved isolated restore requirement; exact BSON/integrity tests exist | Real isolated restore with time/recovery point measured; money, references, audit, ownership/index checks; no live overwrite or deleted-user revival |
| 18-12 | Privacy controls / full-account erasure | owner-policy gate | Export, scoped deletion and revocation exist; collection-level inventory complete | Decide financial evidence treatment, shared history and deletion suppression; then implement/verify complete erase workflow, not soft-delete substitution |
| 18-13 | Secret rotation and encryption | partially satisfied | R: server-only boundaries, short-lived Financy tokens; approved key-separation direction | Identity-preserving versioned key transition plan; isolated rehearsal; external least-scope secrets/storage/TLS; no rotation now |
| 18-14 | Least privilege / penetration and isolation review | partially satisfied | R: owner-first access/current household checks; admin direction approved | Threat model, direct-ID/revocation review, DB/IAM/CI roles and authorized negative staging tests; no default admin private-data access |
| 18-15 | Incident response/runbooks and failure drills | pending repository work | Provider/lifecycle retry safeguards and unit failure cases | Runbooks, operator/backup contact, external drill window; DB/auth/provider outage and recovery without duplicate truth |
| 18-16 | Dependency/SAST/secret/build security checks | partially satisfied | R: pinned lockfile, npm audit, CI tests/types/lint/build | Dedicated SAST/secret scanning, required CI checks and real test-infrastructure gating; runtime/platform review; no container image in repo |
| 18-17 | Load/resilience testing | pending external verification | Approved 10 synthetic users/30 minutes; prior 10k-transaction report/search fixture evidence | Isolated dataset, approved cost/window, workload mix and correctness/latency checks; never use real-provider paid actions for load |
| 18-18 | Accessibility/mobile/RTL-LTR | partially satisfied | R/O: earlier UI and owner QA evidence | Full critical-surface keyboard/focus/contrast/screen-reader/mobile matrix with automated and manual evidence; no visual redesign |
| 18-19 | Feature flags / rollback paths | pending repository work | Config absence fails unavailable; preferences exist, not kill switches | Server-enforced audited controls, safe defaults, deploy rollback and DB compatibility rehearsal; no implicit sync/send/replay |
| 18-20 | Operational metadata separated from finance / retention | partially satisfied | R: narrow provider telemetry; separate counters/receipts; some metadata embeds personal identifiers | Explicit field/retention/role policy and tested sinks; do not label receipts, archives or hashes anonymous |
| 18-21 | No unresolved critical/high security issues | partially satisfied | Historical audits and isolation tests; proven Auth.js raw-error path corrected in this slice | Current complete threat/SAST/dependency/secret/deployed review and remediation evidence; this slice is not a penetration-test clearance |
| 18-22 | Signed checklist / verified SLOs, privacy, backup, restore, rollback | pending external verification | This matrix only; Phase 18 remains unaccepted | All rows closed with actual evidence and operator sign-off; no Phase 19 before acceptance |

## Current controls and gaps (code inspection)

- `src/lib/security/rate-limiter.ts`: shared Mongo fixed-window counters keyed by actor hash + scope; TTL cleanup, not in-process limits. Auth routes are delegated directly to Auth.js without this limiter. Search/report/export GETs and most authenticated page reads have no dedicated abuse budget. Limits occur after authentication and cannot protect Mongo from unauthenticated authentication load. Every scope is a separate allowance, not a global user budget. Report AI summaries use the generic mutation limit rather than the Copilot hourly allowance. Do not change policy in this slice.
- `request-guards.ts`: exact configured origin for mutations, JSON-only bodies, actual-byte 16 KiB bound. `route-response.ts`: no-store, safe public errors, unknown-error name + correlation only; the error name is not a runtime allowlist. It does not print message/cause/body. Typed public messages are application-owned; audit new error constructors carefully.
- `next.config.ts`: CSP includes unsafe-inline script/style; no nonce, no app HSTS. Next headers are not evidence that proxies add no weaker/contradictory headers. No header changes here.
- Auth: database sessions when configured, fail-unavailable when required settings absent, secure host-specific cookie names on HTTPS, no debug logging. Stock Auth.js nevertheless serialized error messages/stacks/causes. See logging finding below. Actor identity is server-derived; household owner is NOT a system administrator.
- Health: `/api/health` returns static `ok`, no-store; `pingDatabase` exists but is not called there. Therefore an HTTP 200 is liveness, not database/auth/provider readiness. No monitor, alert sink, health admin, SLO measurement or readiness endpoint is claimed.
- AI/Resend sinks write metadata to console. AI service and report-summary errors derive categories partly from error names/providerCategory; AI model string originates in the provider response. These are typed rather than general runtime telemetry allowlists. No real secret exposure is established there; stricter field allowlists/cost metrics are next-slice work. Financy emits safe categorized failures and durable owner-scoped sync/lifecycle receipts, not raw provider logs. Inspect Vercel request URL/query capture separately: OAuth codes in access logs are outside this logger's control.
- Optional Anthropic/Resend/Financy settings have server-only unavailable boundaries. Core manual data does not depend on those providers. Email defaults off and requires consent; provider failure cannot authorize a financial mutation. Missing Google configuration denies real authentication, never creates a fake actor. Configuration status does not test credential validity or prove a graceful UI on every absent-provider route.
- CI has read-only contents permission, npm ci/audit/tests/typecheck/lint/build, but no real integration credentials/service setup, dedicated SAST, secret scanning or proven required-branch/deployment gate. Tests may skip real Mongo/provider suites if their opt-ins/access are absent. MONGODB_TEST_* belongs in isolated test runners, not Vercel application runtime. No container image exists to scan; this does not exempt dependency/runtime review.
- Owner reports automatic main deployment. No rollback, branch-protection or auto-promotion controls were inspected. Code rollback cannot undo data migrations; a restored DB must not replay paid bank commands or pending email. No feature-flag/admin subsystem exists. Runtime DB code creates indexes; migration/runtime role separation requires an explicit plan, not a blind privilege revocation.
- `AUTH_SECRET` currently keys both OAuth and Financy subject/account/transaction HMAC aliases and stable identity digests. Rotation without a continuity-preserving plan can break lookup/deduplication. No key is changed. A backup must have a separately controlled compatible identity-key recovery strategy; never store secret values in this document or operational events.

## Sensitive logging finding and narrow fix

**L-01 confirmed repository exposure path, not evidence of a historical real leak.** Installed `@auth/core/lib/utils/logger.js` prints error.message, nested cause.err.stack and other cause data even with debug false. Installed init/session/callback paths send adapter/upstream errors to it. A synthetic sentinel in an InvalidCheck cause/callback code and AdapterError reproduced logging (new regression RED: 1 failed/4 passed). `safe-logger.ts` overrides error/warn/debug through supported Auth.js configuration. Only fixed class-derived categories, random correlation ID and `auth-log-v1` are emitted; unknown names, messages, tokens, URLs, causes, arguments and stacks are omitted. Debug is a no-op. Checks, sessions, errors, cookies, provider handling and financial behavior are unchanged. Diagnostic tradeoff: investigate safe category + deployment/time context rather than raw exception payloads. Do not re-enable raw logging for the next incident.

No live logs, cookies, Atlas documents or provider payloads were read for this review. No claim of complete Vercel/Next.js infrastructure log redaction. Separate platform logging, retention and access verification remains required.

## Remaining decisions and next slice

1. Approve a collection-level erasure policy only after reviewing PHASE_18_DATA_INVENTORY.md: embedded financial audit amounts, immutable personal snapshots, shared-member references, provider observation history and development archives all have concrete consequences. No legal retention period is invented.
2. Name incident operator/backup, alert destination, monitoring retention and budget ceiling. Define eligible SLO requests, measurement exclusions, latency targets, and exhaustion response under the approved 99.5% target. No additional load amount is assumed beyond 10 users/30 minutes.
3. Supply non-secret staging project/domain/deployment identity and read-only settings evidence: Atlas tier/namespace/roles/network/backup; Google callback/client separation; provider staging credential separation or documented limitation. Do not paste secrets. Approve isolated fixture/restore namespace and drill costs/window before execution. Existing real Financy data is not implicitly approved for staging copies.
4. Production legal launch approval, future production resources/domain, general Financy multi-user access and Resend production sender readiness remain later external/launch gates. This does not defer Phase 18's actual staging backup/restore/privacy/security obligations or redefine Phase 9 acceptance.

Recommended next slice: non-mutating staging configuration verification followed, under explicit approval, by bounded protected readiness and safe operational metadata/allowlisted access tests. No provision, live restore, erase, key migration or bank operation until separately authorized. Retain local port 3001 and leave port 3000 untouched.

## First-slice verification

**Completed locally 2026-09-08; first slice ready for owner review, Phase 18 still NOT accepted.**

| Gate | Actual result |
| --- | --- |
| New logging failure reproduction | Before logger change: 1 failure / 4 passes; synthetic sentinel reached installed Auth.js default logs. No real secret used |
| Focused new checks + existing lifecycle regression | 3 files / 15 tests passed (9 new checks plus 6 existing lifecycle/PKCE tests) |
| Complete selected unit/integration regression | 74 files / 376 tests passed; 1 file / 1 test explicitly skipped (opt-in Financy reconnection). Real isolated local MongoDB tests included; no external provider call |
| Type-check | `npm run typecheck` passed. Initial new fixture used an Error constructor overload unsupported by installed adapter error typings; corrected to the typed message/cause form without weakening the sentinel assertion |
| Zero-warning lint | `npm run lint` passed |
| Production build | `npm run build` passed; no server restart, deployment or port-3000 action |
| Dependency audit | Initial sandbox registry access failed; authorized registry retry of `npm run security:audit` passed with 0 vulnerabilities. No dependency changes |
| Configured-private-value scan | 328 source candidates and 33 production client JS files scanned; 0 matches. Values were never printed. This is a bounded exact-value check, not comprehensive SAST or an audit of live platform logs |
| Git/secret hygiene | `git diff --check` passed; `.env.local` ignored/untracked; only listed documentation/auth-logger/tests changed; no staged work, commit or push |
| External/browser/restore/load gates | Not run: no new real Google login, provider test, Atlas/Vercel inspection, browser acceptance, load run, backup or restore. Owner's prior deployed login/UX evidence stays O, not relabelled as this slice's test |

Regression command (all RUN_REAL_ANTHROPIC_TESTS / RUN_REAL_RESEND_TESTS / RUN_REAL_OPEN_FINANCE_TESTS / RUN_REAL_OPEN_FINANCE_RECONNECTION_TESTS explicitly `0` in the test process):

```powershell
node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/unit tests/integration --maxWorkers=1 --exclude '**/phase-eight-anthropic.integration.test.ts' --exclude '**/phase-sixteen-anthropic.integration.test.ts' --exclude '**/phase-fifteen-resend.integration.test.ts' --exclude '**/phase-nine-financy.integration.test.ts' --exclude '**/phase-nine-identity-evidence.integration.test.ts' --exclude '**/phase-nine-development-cutover.operations.test.ts' --reporter=dot
npm run typecheck
npm run lint
npm run build
npm run security:audit
git diff --check
```

The excluded files require unrelated external provider activity or destructive development operations; neither is authorized or necessary for this documentation/logging slice. The configured test URI was checked without displaying it and is loopback; integration suites create/clean randomly suffixed test databases, not user/provider records or staging application data. No MONGODB_TEST_* variable was added to Vercel. Tests use synthetic secrets and the installed Auth.js logger/PKCE implementation, not a substitute for deployed authentication acceptance. Future deployment of this log-only change remains an operator verification step after review.
