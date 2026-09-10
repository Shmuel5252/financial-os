# Phase 18 repository hardening package — 2026-09-09

Subsequent evidence, 2026-09-10: owner accepted deployed Gates A/B on 3c370a2. PHASE_18_PRE_CUTOVER.md supersedes the historical pending-gate status below, preserves unresolved incidents, and defines the separately approved future cutover. This report's original repository-only evidence remains historical; full Phase 18 is not accepted.

Base: `a0d99cddfcd40813d69d30f9d39740aecb81d8ba`. Working-tree changes only; no commit/push, provider/account action, secret change, real backup/restore, data migration, staging load or Phase 19. This supplement preserves historical evidence. Implementation here is NOT Phase 18 acceptance or production readiness.

## Mandatory deployed gates remain pending

**Gate A:** exact a0d99cd Vercel Ready mapping; real Google login, persisted session, sign-out, re-login; bounded verification that public session JSON has only expiry and own ID/name/email/image, never bearer/internal/extra fields. Prior synthetic proof and repository fix are not deployed acceptance.

**Gate B:** privately identify own staging Auth.js ID; configure operator ID allowlist plus FINANCIAL_OS_ENVIRONMENT=staging; redeploy; authorized bounded bindings result plus anonymous and ordinary-user denial. Historical owner `forbidden` response is denial evidence only. Neither gate passed in this package. They block live cutovers, not repository-only work.

## Implementation and evidence matrix

R = repository tests/source verified; L = real isolated local MongoDB evidence; O = historical owner report; D = independently verified deployment in THIS package (none); E = external configuration/verification pending; P = owner policy pending. Test totals are recorded after final execution below. An R/L row does not certify its hosted equivalent.

| Requirement | Implemented / reviewed | Evidence and remaining gate |
| --- | --- | --- |
| Session privacy | Accepted projection retained; no auth semantics change | R synthetic handler; Gate A E, no new D |
| Liveness | `/api/health` independent of DB/providers, no-store bounded body | R actual handler under injected Mongo outage |
| Readiness | Existing allowlist + real session + bounded Mongo ping; 5s response/3s command; new deadline rejects late-auth probe work | R healthy/denied/error/deadline; L ping/read-only fixture preservation; E hosted outage/auth and correct principal/index manifest |
| Bindings/operator | Exact allowlist, fixed assertions, no finance or dynamic config inspector; same late-auth budget check | R denial/minimization; Gate B E. Operator identity never changes financial repository scope |
| Logging | Fixed route error category replaces mutable error.name; runtime allowlisted console telemetry replaces raw event object | R synthetic name/extra fields/error labels; E live log retention/access/export audit |
| Headers/CSP | Keep frame deny/nosniff/permissions/object restriction; no-referrer; script-src-attr none; retain inline hydration allowance | R configuration/build; E browser CSP/hydration/Auth. Strict nonce policy not deployed |
| Rate limits | Existing 30/min mutation scope, 10/hour Copilot; add 30/min actor/scope to both expensive exports | R wiring/429; L actor/scope/window/concurrency. E ingress/auth/read quotas/load tuning |
| CI/security | Existing gates retained, add ephemeral CI Mongo, private-artifact/signature guard, ESLint eval rules, index manifest check | R local commands; E GitHub workflow run/branch protection/full SAST |
| Backup tooling | Explicit 52-name planner, excluded/filtered/rebuild classes, BSON hash/int64 checks, auth linkage projection | R synthetic only; E consistent secret-free exporter/storage/scheduler/restore; P erasure and ledger |
| Restore | Non-executable plan and source index manifest; releaseAllowed false, providers/emails/jobs replay false | R all 52 covered; E real isolated restore and RPO/RTO/retention proof |
| Privacy/erasure | 52-collection non-executable disposition proposal | R completeness only; P actual erasure/holds/shared evidence/ledger retention |
| Secret rotation | Coupling inventoried, versioned migration proposal below | R source only; P/E key provisioning/migration; no changed identities |
| Operational controls | Server-only optional AI generation, paid bank refresh, email dispatch gates, defaults unchanged | R guard-before-I/O tests; E deployment-control authorization/audit evidence; no control API |
| Failure/resilience | Extend deadline/liveness, chunked body bound, telemetry redaction, load timeout, rate concurrency | R plus existing provider rejection/timeout and L stale-write/idempotency regression; E staged drills |
| Performance | Ten-user/30-minute injected scheduler and aggregate percentiles, timeout/abort; rejects all external origins | R synthetic scheduler; E approved fixture-aware HTTP adapter + actual measured run, Mongo/resources |
| Accessibility | Source review across 23 component files; global visible focus and reduced motion | R source/SSR regressions; E visual/mobile/keyboard/screen-reader acceptance. No WCAG conformance claimed |
| Indexes/role | 90 source definitions (88 runtime, 2 offline), existing 2 extra fixtures; source manifest with hashes | R index check; L existing readWrite rehearsal. E live readWrite cutover; narrower role remains proposal |
| Operations/runbooks | Eleven runbooks + staged drill checklist | R written, not exercised; E alert delivery/on-call/rollback/restore drills |
| Full Phase 18 | NOT ACCEPTED | Gates A/B, policy, external resilience/privacy/security checks unresolved |

## Logging and error audit

### Original roadmap criterion reconciliation

| ID | Current status | Evidence class / outstanding requirement |
| --- | --- | --- |
| 18-01 | satisfied at accepted staged boundaries | R/O prior Phases 0–17 incl. Phase 9 qualifications preserved |
| 18-02 | historically satisfied; current release acceptance pending | O hosted Atlas/Auth after earlier fix; Gate A E for a0d99cd |
| 18-03 | pending external configuration/verification | E local/Preview/staging/future-production credential/data separation |
| 18-04 | partially satisfied | R/O prior config; E actual TLS/HSTS/limits/principal and Gate B |
| 18-05 | partially satisfied | R/L limiter and new exports; E ingress/auth flood and measured thresholds |
| 18-06 | partially satisfied | R headers/CSP incremental tests; E browser/nonce/HSTS |
| 18-07 | partially satisfied | R fixed log projections; E platform/crash/log access/retention |
| 18-08 | partially satisfied | R/L readiness, explicit operator; Gate B E, alerts/monitor credentials E |
| 18-09 | partially satisfied | R SLI contract/load aggregates; E actual SLO coverage/measurements |
| 18-10 | pending external configuration and policy | R planner; E backup storage/consistent capture/history, P exclusions/retention |
| 18-11 | pending external verification and policy | R exact BSON/restore barriers; E actual isolated restore, P deletion replay |
| 18-12 | owner-policy gate | R all-collection non-destructive plan; P full/shared erasure/holds/ledger |
| 18-13 | partially satisfied | R source/keyring plan; P/E migration and actual rotation/restore proofs |
| 18-14 | partially satisfied | R/L actor/role isolation; E Atlas readWrite cutover and authorized hosted security testing |
| 18-15 | partially satisfied | R runbooks/failure tests; E on-call contacts and live approved drills |
| 18-16 | partially satisfied | R audit/CI guards/eval lint; E hosted CI/required checks/full SAST/penetration review |
| 18-17 | pending external verification | R non-network harness; E synthetic target/HTTP adapter/approved measured load |
| 18-18 | partially satisfied | R source/SSR/focus/motion; E full mobile/keyboard/screen-reader/browser |
| 18-19 | partially satisfied | R optional flags; E authorized audited deployment changes and rollback drill |
| 18-20 | partially satisfied | R minimized telemetry; P retention and E platform access/drains |
| 18-21 | pending complete security clearance | R proven issues fixed locally; Gate A E, no comprehensive high/critical clearance claim |
| 18-22 | blocked on remaining acceptance | No signed final acceptance; SLO/privacy/backup/restore/rollback and Gates A/B unresolved |

All source console sites are confined to Auth safe logger, common route error handler, AI and email sinks. Financy adapters do not log raw responses. API handlers route failures through the common boundary; Mongo retains raw causes server-side, not public serialization. Imports/manual data, reports/search, exports, operator handlers and provider paths were searched for direct logging. Validation errors remain intentional user-facing application errors; no change to financial validation semantics.

Proven synthetic weakness: Error.name is mutable; the common route logger emitted it. Changed to fixed UnexpectedError with random correlation ID only. Another boundary weakness: typed telemetry objects are not runtime allowlists and can contain extra fields; model/error labels can originate outside fixed policy. Console sinks now project fixed provider/status, bounded integer duration/retry/token counters, enumerated error categories and redaction version. Unknown categories become UNKNOWN_FAILURE. Raw model, request IDs and free-form version labels are omitted from console output; domain/structured records remain unchanged. This is intentional lower diagnostic detail rather than logging arbitrary strings. Auth logger remains its existing concrete error-class categorizer. No broad logger framework or external sink introduced.

No real secret/session read or exposure was tested. Platform access logs, exception rendering outside application handlers, runtime crashes, retention/drains and log-access permissions remain unverified; source search is not proof of platform privacy. The previously fixed session JSON issue still requires Gate A.

## Request and readiness bounds

JSON request bodies previously called request.text() before checking actual size. Missing/false Content-Length could force unbounded buffering. Now stream chunks up to 16,384 bytes; cancel excess and return existing INVALID_INPUT envelope without retaining/logging content. Normal JSON/Hebrew semantics unchanged. This bounds application buffering, not upstream platform buffering or slow-client time: edge body/time limits remain required.

Readiness proves a normal authenticated operator session and Mongo responsiveness, not all possible financial writes, current index validity, correct Atlas principal, provider consent or full financial correctness. New deadline checks prevent starting a probe after auth has already exhausted the 5s response budget. Underlying driver discovery can finish later (existing 30s deployed selection budget); it is not forcibly cancelled/closed. Single-flight probe coalescing remains per-process, not distributed DoS prevention. Do not promise readiness implies a healthy optional provider. A future release manifest/index readiness check must follow migration initialization design, not issue write probes during monitoring.

## Header/CSP path

Current script/style unsafe-inline remains explicit. `script-src-attr 'none'` blocks HTML event-handler attributes while React delegated handlers and Next inline hydration scripts remain allowed. `no-referrer` minimizes URL/query disclosure on navigation; Origin-based mutation checks remain unchanged. Frame-ancestors none/X-Frame-Options DENY, object-src none, nosniff, camera/mic/geolocation denial and poweredByHeader false retained. No insecure wildcard/eval added.

Nonce follow-up: generate a per-request nonce server-side, apply matching request/response CSP, ensure all Next scripts receive it, prove dynamic rendering/cache/PPR compatibility and navigation/hydration/Auth under a real production build before enforcement. Start with controlled local/report-only observation without collecting sensitive violation URLs. Do not add a nonce to a static cached header. Next documents the dynamic-rendering cost: [official CSP guide](https://nextjs.org/docs/app/guides/content-security-policy). HSTS is not forced onto local HTTP; deployed HTTPS redirect/HSTS duration/subdomain ownership/preload need operator verification and separate production decision. Do not assert local config proves Vercel headers.

## Route abuse inventory

| Surface | Current control | Remaining coverage |
| --- | --- | --- |
| Google/Auth.js initiation/session/callback/sign-out | Auth.js checks, cookies/PKCE; no new protocol throttle | Edge per-client/route abuse rules and verified false-positive handling; cannot infer proxy identity from untrusted forwarded headers |
| Authenticated financial reads/pages | Server actor/owner queries and bounded pagination where implemented | No blanket read limiter added; measure first, edge flood protection pending |
| Mutations | 30/min/actor/scope; origin check, JSON bound, schema, ownership, optimistic/idempotent writes | Slow dependency/edge saturation and cross-scope aggregate quota pending |
| Copilot | Existing 10/hour actor; AI generation can now be disabled | Shared AI budget across other AI features remains a reviewed future quota, no invented billing cap |
| Financy link/sync/refresh/disconnect/reconcile | Existing authenticated origin/rate/idempotency; new refresh kill switch only | No webhook/callback throttle invented; provider-specific protocol and ingress review pending |
| Manual ingestion | Existing authenticated validated mutations | No generic new upload/import route introduced |
| Exports | NEW shared limiter primitive, separate report-export / financial-data-export scopes, 30/min each | Static thresholds are initial abuse protection, not throughput certification; errors use bounded 429 envelope |
| Reports/search | Existing mutation limits, bounded query model; read generation still unthrottled except exports | Load observations should guide read-specific quotas without making normal navigation fail |
| Health/operator | Liveness cheap; operator deny-first, deadlines, coalescing | Edge protection and legitimate monitor authentication pending; no secret bypass |
| Destructive/account ops | Existing domain ownership/validation; no full-erasure endpoint | Do not add kill switch that prevents privacy revocation without an approved recovery path |

Fixed-window reset is independent of TTL deletion. Hashing limiter keys minimizes plaintext IDs, not anonymization. Limits are scope-local and can burst at window boundaries. New real-Mongo test covers two actors/scopes, reset without TTL cleanup and concurrent threshold enforcement. No schema/index migration.

## CI/security automation

CI retains tests/typecheck/zero-warning lint/build/npm audit and adds disposable Mongo 8.0 service on loopback; no application secrets. MONGODB_TEST_* are job-local only, never staging runtime guidance. Workflow not run on GitHub in this slice. Windows-only authenticated role rehearsal remains locally executed, not claimed by Linux CI. Recommended required checks after a successful workflow run: verify job (including security guard/index check/audit); protect main against direct unreviewed pushes/force pushes and require reviewed status checks. No GitHub settings changed.

security-check.mjs scans tracked plus nonignored new working files, rejects private env/key/backup/deployment artifacts by name BEFORE reading them, then known token/private-key signatures and public-secret bindings. Reports category/path, never contents. It is deliberately not complete entropy/history scanning or full SAST. ESLint adds eval/implied-eval/new Function prohibitions; existing Next/React security lint retained. Broader CodeQL/Gitleaks introduction can be reviewed later; no claimed full penetration test. Source index manifest check enforces 90/88/2; output contains static schema expressions/digests, no live indexes or data. Action pinning/update policy and CI supply-chain review remain external governance follow-up.

## Backup, restore and erasure tooling limits

recovery-plan.ts is offline and server-only. It has no database/client/filesystem/network operations. It orders all 52 allowlisted collections; unknown/duplicate names fail closed. Output always says executable=false/releaseAllowed=false with consistency, secret-free schema, current ledger, shared-policy, index, ownership-money-provenance, fresh-auth and operator barriers. No input flag can enable restore. authSessions/authVerificationTokens/migration locks excluded; search/limiter state rebuilt; six filtered collections explicitly marked. Auth linkage helper emits only validated stable IDs/provider/type; extra OAuth tokens and nested ID payloads cannot pass. It is NOT a complete field-level financial exporter and does not guarantee arbitrary user text contains no secrets.

BSON helper checks SHA-256 byte integrity and preserves Long in synthetic roundtrip tests. Hash alone is NOT authenticated provenance, snapshot consistency or erasure compliance. Future signed manifest must bind environment, backup generation, schema/index/engine versions, collection counts/filter transformations, durable deletion watermark and encryption envelope. No key in manifest. Atlas Free gives no consistent multi-collection point-in-time snapshot by this planner: a future logical export needs an approved write fence/consistent snapshot strategy or actual capable backup infrastructure, followed by isolated restore. RPO <=24h, RTO <=4h, 30-day history remain unverified.

erasure-plan.ts emits one non-executable proposal per collection; no ordinary personal financial payload receives indefinite audit retention. Detailed default candidates: authSessions/verification/locks revoke-delete; household membership/invitation/share records detach/revoke/remove subject fields while preserving other owners; ordinary sources and personal snapshots/corrections/reviews/AI/reports/notification history delete under approved policy; derived search/rate data delete/rebuild survivors. Provider consent revocation is separate from local deletion and must not replay after restore. Exported/downloaded copies are not remotely erasable by this app; future managed export storage must have expiry/access rules. Shared snapshots/reports need explicit privacy-redaction vs narrowly justified hold decision; never silently rewrite historical accounting.

Owner decisions required: (1) erase personal immutable evidence or narrowly enumerated lawful holds with fields/purpose/duration/access; (2) household-owner erasure dissolves sharing or explicit transfer, preserving other members' independent finance; (3) shared historical report redaction and explainability tradeoff; (4) minimal separately durable deletion/revocation ledger purpose/key/duration spanning every restorable copy plus replay window; (5) backup mechanism/consistent capture/storage/cost/expiry; (6) outstanding provider-revocation failure semantics. Anonymization is not assumed from hashing; temporary retention only for explicitly justified workflow/hold, not an invented legal period. No ledger storage/deletion implementation yet.

## Secret-key separation design

AUTH_SECRET currently drives Auth.js and two Financy HMAC entry points: bankAlias in account-identity.ts and alias in open-banking-service.ts. Domain-separated inputs include subject/connection/account/transaction and stable identity/reconciliation material. Changing AUTH_SECRET alone can change aliases and break ownership/reconnect deduplication. No key or derivation code changed.

Future staged design: dedicated server-only FINANCY_IDENTITY_KEY plus explicit key version/keyring, preserving legacy v1 derivation exactly. Introduce dual-read resolution of old/new aliases with immutable alias evidence and unique canonical mapping; never duplicate financial records. Start in observation-only legacy-write mode, validate complete alias coverage against unchanged canonical IDs, then separately approve versioned writes. Store key IDs, never keys, with evidence. Some historical raw identifiers were deliberately minimized; cannot rehash unavailable values from old hashes. Retain legacy key reads until continuity evidence/manual reconciliation resolves each case, never infer new hash from old digest. Rollback must keep both key versions and alias history readable; old code unaware of v2 cannot be a rollback target after v2 writes. Separate rotation of auth secret only after dependency migration and real reconnect/idempotency/restore verification. No blanket re-encryption/rekey operation authorized.

## Operational switches and rollback

Server-only deployment flags: OPERATIONS_DISABLE_AI, OPERATIONS_DISABLE_BANK_REFRESH, OPERATIONS_DISABLE_EMAIL. Unset/empty/false preserve existing behavior; true or malformed nonempty values disable that capability. No NEXT_PUBLIC exposure, request parameter, user role, preference or new admin API changes them. AI guarded before Copilot dependency work and at actual Anthropic generation (including report AI); bank refresh before paid lifecycle claim; email dispatch pauses before claiming jobs while in-app remains active and opt-out cleanup still runs. Existing accepted-email status reads remain advisory and allowed. These do not cancel an in-flight provider call or promise instantaneous fleet-wide control; env changes require authorized deployment. No live flag changed.

Control-change audit contract: operator records change ticket/reason/time, project/environment, old/new nonsecret boolean, deployment SHA, approval and rollback target in restricted deployment audit. Platform audit availability has not been verified; there is no new mutable DB control store or audit-retention policy. This is an environment-controlled brake, not a fully accepted live operations console. Broader sync/import/export/destructive/background switches remain design-only where cancellation/revocation consequences need policy.

Rollback must never reintroduce the known pre-a0d99cd session disclosure. See PHASE_18_RUNBOOKS.md. No rollback, deploy or Vercel change executed.

## Resilience, load and UI evidence

Existing regression includes provider unavailable/rejection/safe error contracts, financial optimistic writes, idempotent retries, ownership, notification lifecycle and duplicate prevention. New tests cover late auth budget, liveness with failed Mongo, chunked body rejection, telemetry projection, disabled optional operations before I/O, rate concurrency/window isolation, load timeout and abort. These synthetic provider tests do not replace real provider acceptance. No destructive drill.

Load harness is an injected scheduler, NOT a ready staging HTTP runner: exactly 10 synthetic users / 30 minutes, six representative operations (dashboard, financial read, reports, search, synthetic write, readiness), one request/user at a time with think time, 10-second timeout/abort and no overlapping retry after timeout. Validates isolated-local localhost:3001 only; rejects staging/production/port3000/credentials/query endpoints/unapproved fixture. There is intentionally no HTTP client, session reader or financial payload builder. Emits aggregate p50/p95/p99/error/timeout/cold-warm counts only. Cold phase labels are executor evidence, not true cold-start inference; Mongo timing/resources explicitly require instrumentation. Injected scheduler tests are not load-performance results. A future isolated fixture-aware executor must prove ten synthetic actors, dedicated operator for readiness, ownership/write cleanup and no real data before a separately approved staging run.

Source UI review covers navigation/details, profile/manual forms, dashboard/timeline, budgets/goals/forecast/simulation/debt/net-worth, household/reconciliation, notifications/progress, Copilot/reports/intelligence. Existing Hebrew root direction, label wrappers, semantic sections/lists, aria-live/error regions and bdi financial/date isolation retained. Clear global defect: multiple outline-none fields relied only on border color; add visible focus outline for native interactive elements. Add reduced-motion handling. No UX redesign or new goal semantics. Not a complete accessibility audit: browser mobile widths 320/375/768, keyboard tab/details/forms, focus retention, screen-reader errors, chart/table alternatives and 200% zoom still require acceptance. CSS/source assertions alone do not prove visual usability or CSP hydration.

## Final verification and handoff

### Owner-approved release review — 2026-09-09

Reviewed the current 41-file package, including all runtime diffs, operator assertions, non-executable planners and synthetic-only fixtures. No additional release-blocking issue or code fix was required. Auth/session, Mongo lifecycle, Google callback/cookies/PKCE code is unchanged from a0d99cd. Dashboard/forecast/manual management/goals and financial calculation/ownership contracts are unchanged; shared JSON intake enforces the existing byte limit during streaming. Financy changes affect only the explicitly disabled refresh path, not sync/link/disconnect/identity. AI and email controls default to enabled; optional failure does not gate core financial reads. Email pause leaves in-app evidence and pending delivery intact. Export limits are actor/scope-local and do not touch OAuth/provider protocol routes. Operator metadata remains deny-first and fixed, without finance/configuration values or parameterized inspection. Recovery/erasure have no execution I/O; load harness has no network adapter and rejects non-local targets. Test addresses, identifiers, amounts and private-marker strings are synthetic, not real user/secret data; no real sensitive content was added. CSP retains Next inline hydration allowance while rejecting HTML event-handler attributes; no known incompatibility found, but real browser/hydration/Auth acceptance is still pending, not proven by build.

Fresh release rerun: seven focused security/ops/auth files / 49 tests passed; full non-external regression 83 files / 437 tests passed with one opt-in skip and the same six external/destructive exclusions below. Real isolated local MongoDB coverage included. Type-check, zero-warning lint, production build, 357-file local security check, index manifest check and dependency audit (zero vulnerabilities) passed. Gates A/B remain pending; Phase 18 unaccepted and Phase 19 unopened. Owner authorized one checkpoint commit and push after these gates. Exact commit/synchronization is reported in the handoff; no hosted deployment Ready claim is made. Use the resulting exact Ready deployment for manual acceptance, without treating superseded checkpoint testing as proof for new code.

Final local verification on 2026-09-09: 83 test files passed, 437 tests passed; one opt-in reconnection file/test skipped. Six external/destructive files were explicitly excluded: phase-eight-anthropic.integration.test.ts, phase-sixteen-anthropic.integration.test.ts, phase-fifteen-resend.integration.test.ts, phase-nine-financy.integration.test.ts, phase-nine-identity-evidence.integration.test.ts and phase-nine-development-cutover.operations.test.ts. Real-provider flags were disabled. Real isolated local MongoDB integration, ownership/idempotency and the existing disposable readWrite-principal rehearsal were included. Final focused run: six files / 39 tests passed. No real provider or deployed-browser acceptance was substituted by these tests.

Fresh final type-check, zero-warning lint and production build passed. Private-artifact/security check: 357 files, zero findings; source index check: 90 definitions / 88 runtime / two offline, no DB action. Dependency audit: zero vulnerabilities (sandbox network attempt failed; read-only registry retry succeeded). git diff --check passed. Git emitted a permission warning for the inaccessible optional global ignore file; repository .gitignore still proves .env.local ignored, and git ls-files confirms it untracked. HEAD remains a0d99cddfcd40813d69d30f9d39740aecb81d8ba; 41 intentionally uncommitted changed/new files, no commit or push. Hosted CI, CSP/mobile browser acceptance, actual backup/restore/load and Gates A/B remain pending.

No automatic phase acceptance. Next dependency-safe actions: review local package; separately approve commit/deployment; finish Gate A then Gate B privately; only then live readWrite cutover review; approve erasure/backup policy and isolated test targets; verify monitoring/drills/load/accessibility; complete remaining Phase 18 acceptance before Phase 19.

### Exact changed files (41)

Configuration/CI: `.env.example`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `next.config.ts`, `package.json`.

Documentation: `ARCHITECTURE.md`, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, `PHASE_18_ENTRY_REVIEW.md`, `PROGRESS.md`, `PHASE_18_HARDENING_PACKAGE.md` (new), `PHASE_18_RUNBOOKS.md` (new).

Scripts (new): `scripts/index-manifest.mjs`, `scripts/security-check.mjs`, `scripts/security-check.d.mts`.

Runtime changes: `src/app/api/financial-data/export/route.ts`, `src/app/api/ops/bindings/route.ts`, `src/app/api/ops/readiness/route.ts`, `src/app/api/reports/export/route.ts`, `src/app/globals.css`, `src/lib/adapters/anthropic/anthropic-ai-provider.ts`, `src/lib/ai/ai-service.ts`, `src/lib/ai/ai-telemetry.ts`, `src/lib/http/request-guards.ts`, `src/lib/http/route-response.ts`, `src/lib/notifications/notification-service.ts`, `src/lib/notifications/notification-telemetry.ts`, `src/lib/open-banking/open-banking-service.ts`, `src/lib/operations/readiness.ts`.

New operations modules: `src/lib/operations/controls.ts`, `src/lib/operations/erasure-plan.ts`, `src/lib/operations/load-rehearsal.ts`, `src/lib/operations/recovery-plan.ts`, `src/lib/operations/safe-telemetry.ts`.

Tests: `tests/integration/phase-fifteen-notifications.integration.test.ts`, `tests/integration/profile-repository.integration.test.ts`, `tests/integration/rate-limiter.integration.test.ts`, `tests/unit/ai-provider.test.ts`, `tests/unit/notification-provider.test.ts`, `tests/unit/phase-eighteen-hardening.test.ts` (new), `tests/unit/phase-eighteen-operations.test.ts` (new).

### Tests added (25)

Six hardening tests (log projection, 52 collections, auth linkage, exact BSON/tamper, CSP, focus/motion); fourteen operations tests (chunked input, private artifacts, telemetry, flags, pre-I/O disable, nested identity rejection, erasure completeness, liveness/Mongo failure, late auth, export scope, load target rejection/concurrency/timeout/percentiles); one real Mongo rate isolation/reset/concurrency test; one real Mongo operator-vs-financial-scope test; one real Mongo email pause/in-app continuity test; two synthetic actual-adapter abort/error-boundary tests. Existing financial correctness/idempotency/stale-write/user isolation tests retained.

The broad route/telemetry/UI reviews remain source-based, not external penetration or screen-reader certification. Schedulers and manifest helpers are tests/plans, not a completed real recovery/load run. No new live external evidence is implied by a green suite.
