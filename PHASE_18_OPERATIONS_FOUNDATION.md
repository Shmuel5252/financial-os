# Phase 18 — second slice: staging inspection and operational foundation

## Status / evidence — 2026-09-08

Phase 18 is **NOT accepted**. First slice owner-approved and pushed as `5cf41e452defb1bf175f12d82a098a779553b415`, `chore(phase-18): reconcile evidence and harden auth logging`; fresh fetch verified main/origin/main equal, ahead/behind 0/0, clean tree and ignored/untracked `.env.local` at that checkpoint. This second slice is uncommitted pending review. No Phase 19, provisioning, provider action, secret change, deletion, restore or paid service.

Evidence labels: R repository/executed local tests; O owner-reported deployment; X independently inspected external UI; P pending external evidence. UI navigation is read-only, not configuration mutation. Secret values were not revealed. Prior historical records remain unchanged; this dated supplement supersedes their current-state limitations.

## Actual staging inspection

| Item | Evidence / result | Remaining limitation |
| --- | --- | --- |
| Vercel project / plan | X: `financial-os-staging`, team `shmuel5252s-projects`, Hobby | Staging intent does not establish data isolation |
| Current domain | X: `https://financial-os-staging-nine.vercel.app` assigned to Production environment | Vercel's Production label is staging, not Financial OS launch |
| Revision | X: ready/current/latest deployment `dpl_Co8VfzeSrCmLC5WabTg9TGa2GtKz`, main source `5cf41e452defb1bf175f12d82a098a779553b415`, Sep 8 10:23:24 GMT+3; build 28 seconds | Second-slice code is NOT deployed |
| Git / promotion | X: Shmuel5252/financial-os; Production tracks main; automatic domain assignment checked | Required GitHub checks, human approval gate and rollback drill not verified |
| Preview | X: all unassigned branches tracked; no attached domain | Sharing with Production must not be inferred from identical variable names |
| Environment scopes | X: six secret rows in both Production and Preview: AUTH_SECRET, AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MONGODB_URI, MONGODB_DB_NAME; system variables enabled | Values not revealed/compared; inherited shared keys not exhaustively verified; runtime test/provider key absence and actual namespace/credential separation remain P |
| Functions | X: Fluid Compute enabled, selected region iad1, Standard 1 vCPU / 2 GB, one-region Hobby limit; Function Failover disabled | Advanced duration control inspected but numeric value not exposed by accessibility state; effective maximum duration/per-route overrides remain unverified, not inferred from plan defaults |
| Access protection | X: Vercel Authentication Require Log In enabled / Standard Protection; protected sourcemaps enabled; password/trusted-IP controls disabled; OPTIONS bypass disabled | Do not call the primary Production domain private. Standard Protection does not by itself establish all-domain access restriction; real anonymous-domain matrix remains P |
| Trusted source | X: this project's source rule visible, development tokens may access preview | No tokens viewed, issued or used. No new bypass configured |
| Observability | X: Runtime Logs / Observability links present; Speed Insights / Web Analytics not enabled on deployment | No alert delivery, retention, drain, SLO coverage or live log sanitization proven |
| Platform data preference | X: settled General setting "Improve models with this project's data" checked | Owner should review platform code/chat data preference. This is NOT evidence financial payloads were sent or a finding about Anthropic. No setting changed |
| Rollback | R: Git checkpoints; X: deployment history/current revision exists | Platform supports Instant Rollback; actual rollback eligibility/operation not exercised; cannot restore database state by rolling back code |
| Atlas | P: cloud.mongodb.com redirects to login; no authenticated project view | Actual cluster/database namespace, tier, region, role grants, network policy and backup snapshots unknown. Historical owner Atlas connectivity is O, not an independent role/backup inspection |
| Google | X: Google Cloud Financial OS project contains web client `Financial OS - Vercel`; authorized origin `https://financial-os-staging-nine.vercel.app` and redirect `https://financial-os-staging-nine.vercel.app/api/auth/callback/google` observed read-only. O: successful login after 812b280 | No secret revealed/changed; matching Vercel's unrevealed credential to this client and proving separate local/future-production clients remains P. No new login test |
| Providers | R: server-only adapters and optional configuration; Phase 9 staged acceptance retained | Separate staging/provider workspace credentials not proven; no new Financy/Anthropic/Resend calls |

Official platform references checked 2026-09-08: [Vercel deployment protection](https://vercel.com/docs/deployment-protection), [Instant Rollback](https://vercel.com/docs/instant-rollback). These document capabilities, not evidence of our settings or a completed recovery drill. Hobby rollback is limited to the immediately preceding eligible production deployment; confirm the actual target before any future operation.

## Protected readiness (R implementation)

`GET /api/health` remains unchanged public liveness. New `GET /api/ops/readiness` uses existing Auth.js `requireActor`, then exact environment-local immutable user ID allowlist `OPERATIONS_OPERATOR_USER_IDS`. Blank/malformed entries, wildcard, email/domain and excessive lists deny everyone. No household role, request body/query/header identity or provider ID grants operator access. Configure privately only after approval; no local/remote environment value was changed. Parsing is isolated from ordinary application configuration so a bad optional operator list cannot disable financial product routes.

No new admin UI, finance-read capability, authorization bypass, collection or operational mutation is introduced. Existing Auth.js may renew a session through its normal lifecycle; this is not a new privileged workflow. Operators retain ordinary user permissions outside readiness.

Responses are exactly `{status: ready|authentication_required|forbidden|unavailable}` with 200/401/403/503 respectively, no-store and Vary Cookie. No IDs, configuration keys, hostnames, topology, counts, amounts, error text/causes, payloads or credentials. Disabled configuration returns generic 403 without authentication/database work. No raw readiness logging. Auth failures still use the previously verified safe Auth.js logger.

After authorization, only a Mongo `ping` runs against the existing application database/pool, with 3-second command timeout. A 5-second response deadline covers auth plus probe. It does not cancel the underlying authentication/discovery operation or change the existing 30-second production selection budget; late rejection remains observed. Concurrent probes coalesce per process, never authorization. No persistent health cache, distributed rate limit or claim of edge DoS protection. Existing pool limits remain unchanged. Monitor at no more than once per minute initially; high-rate unauthenticated auth traffic remains a separate hardening gate.

Readiness is deliberately not credential validity, financial correctness, schema/index health, restore integrity or provider readiness. If Mongo-backed authentication is unavailable, it returns generic unavailable without exposing dependency internals. A future external monitor needs an approved legitimate operator authentication mechanism; no bearer bypass or credentials have been created. The allowlisted live deployed success/denial journey remains pending operator configuration; injected actors in tests do not prove Google login.

## Monitoring and SLO contract — defined, measurement not implemented

Version `core-request-sli-v1`; provisional target 99.5% over rolling 30 days. No measured compliance or uptime claimed. Instrumentation must first build a versioned route/method catalogue from current authenticated financial pages/API handlers; do not infer eligibility from arbitrary URL text or log query strings.

- Eligible: real-user authenticated requests to core manual profile/financial management, dashboard/engine, budgets, goals, simulations, intelligence, household-authorized views, forecasts, debt/net-worth, reports/search/progress and in-app notification views. Include their valid, intended application mutations. Auth initiation/callback is a distinct eligible authentication operation because login failure prevents core use. Count each HTTP operation once, not both middleware and handler; authentication-journey success is additionally a separate SLI, not inferred from callback 302.
- Success: eligible request completes its promised operation with expected 2xx/3xx, or correctly rejects invalid input, stale-version conflict, absent record, missing/expired session or unauthorized ownership using documented expected 4xx. For consistent denominator, these legitimate handled outcomes remain eligible/successful; attacker/invalid protocol traffic is excluded using bounded classifications, never user financial values. A redirect to an auth error screen or response carrying an unexpected failure is BAD even when HTTP status is 200/302.
- Bad: unexpected 5xx, application/DB timeout, platform termination, invalid redirect loop, session failure for an otherwise valid session, configuration failure, unexpected authorization rejection, or capacity-induced 429 that prevents legitimate core use. Intentional abuse-policy rejection of out-of-policy traffic is excluded; overload rejection of valid traffic is not. Uncertain classification is reported separately and cannot be silently counted as success.
- Auth: explicit user cancellation/denied consent and correctly expired/tampered checks are expected outcomes; operational PKCE/configuration/adapter/Google outage blocking an intended login is BAD. Do not log callbacks, codes, cookies, user identifiers or raw errors. Missing end-to-end intent makes the journey indeterminate, not proven good.
- Optional external AI explanation, email dispatch and explicit bank link/sync/refresh have separate provider-operation SLIs. They do not enter the core denominator merely because a provider exists; if their failure breaks an eligible core request, that request is BAD. Graceful optional-unavailable while core data renders does not mean provider success. Paid actions must never be used as monitoring probes. Provider failure/timeout/unknown receipt and user refusal are separate categories.
- Exclude static assets, prefetch, bots/attack traffic, synthetic/test/load users, health/readiness/admin operations, build/CI and out-of-scope provider operations. Synthetic exclusions require a trusted test identity/workload registry or separate deployment, NOT a client-supplied header that could hide failures. Preserve a bounded excluded/unknown count by reason so exclusions are auditable.
- Formula: good eligible outcomes / total classified eligible outcomes; budget = 0.005 * denominator. No traffic means no SLI. Unknown outcomes and coverage gaps must be displayed; no target claim until coverage is demonstrated. Retries are separate real requests and must not erase earlier failures. Core latency distribution is separate from success, with thresholds still to be approved after baseline load measurement.
- Staging is sparse/synthetic-heavy and cannot demonstrate a production 30-day population SLO. Server logs cannot alone detect lost connections or client rendering failures; platform failures before handler entry need ingress data, with privacy-safe deduplication. Instrumentation and alert/burn windows, recipients, on-call ownership and delivery test remain pending; this slice adds no broad telemetry.

| Signal | Contract | Existing / missing |
| --- | --- | --- |
| Liveness | GET health success/body/latency, no finance/provider checks | R endpoint; external schedule and alert delivery P |
| Readiness | allowlisted GET, bounded category/latency, freshness of observation | R endpoint; deployed operator/monitor session and actual failure drill P |
| Authentication | safe fixed auth categories, operation outcome; never URL queries/token causes | R safe logger; X Vercel log surface; counting/retention/redaction/access evidence P |
| Mongo | readiness failures + sanitized core dependency failures; Atlas capacity/connection/backup indicators | R probe; Atlas metrics/alerts/tier P |
| Providers | existing categorized actual-operation outcomes, no polling that refreshes/charges | R adapters; external dashboards/alerts/coverage P |
| SLO | versioned eligible/good/bad/excluded/unknown counters, aggregate latency, no finance values | Contract only, no implemented counters or claimed compliance |

## Backup capability versus approved objectives — inspection incomplete

Atlas login is the exact inspection gate. No actual tier, existing policy, snapshot time, storage encryption/access, retention enforcement or restore capability was observed. Therefore none of RPO <=24h, RTO <=4h, 30-day history or isolated restore is verified. Do not select or purchase a tier based on an assumed M0.

Conditional options from official documentation, not our deployment facts:

| If actual tier is | Capability / gap | Option requiring approval |
| --- | --- | --- |
| Free/M0 | No Atlas managed backups | Scheduled consistent BSON backup to approved encrypted isolated storage; scheduler/retention/access/alerts and restore still needed, or approved tier change |
| Flex | Automatic daily snapshots, last 8 daily snapshots; no custom snapshot retention | Native history does NOT meet 30 days. Approved controlled export/archive arrangement or suitable dedicated backup policy; no silent 8-day waiver |
| M10+ dedicated | Cloud backup capability; actual enablement/schedule/history unknown | Inspect first, then explicitly approve needed policy/storage cost and restore target |

Sources: [Atlas backup/restore](https://www.mongodb.com/docs/atlas/backup-restore-cluster/) and [Flex backup limits](https://www.mongodb.com/docs/atlas/backup/cloud-backup/flex-cluster-backup/). A daily schedule alone does not prove <=24h recovery points through failures, and tier capability never proves <=4h restore. Measure last successful recovery point and full isolated validated recovery time. Preserve all 52 inventory classes appropriately, exact BSON int64/indexes/identity keys, current deletion/revocation decisions and no command replay. Do not back up through a serverless HTTP response or plain JSON dump. No backup/restore was run.

## Erasure and restore safety — design options, NOT implementation

Use PHASE_18_DATA_INVENTORY.md's complete 52-collection graph, plus safe discovery of remote legacy collections before exclusion. All ordinary user financial payloads, embedded personal audit, historical snapshots, bank revisions/development archives, AI copies and search copies are personal data. Append-only during normal operation does not establish a perpetual-retention exception.

Recommended option A, subject to owner approval: full personal-payload erase with a separately justified minimized security/deletion ledger. Retain no amounts, merchants, notes, old snapshots, emails, raw bank/provider identifiers or before/after financial payloads there. Record environment, opaque deletion operation ID, versioned keyed subject discriminator, status, accepted/completed times and policy version only; even hashes remain linkable personal data. Purpose is suppression/recovery safety, not financial-history retention. Ledger duration and legal basis remain unresolved. At minimum it must cover every still-restorable copy and in-flight/retry/import window; fixed 30 days from request is insufficient if expiry or completion occurs later. Verify copy expiry before shortening the ledger. Key separation is a design dependency, no current key creation/rotation.

Option B: narrowly enumerated legal/security hold on selected fields/records, with approved purpose, lawful basis, duration, restricted independent access and expiry. Ordinary data still erased; held evidence must not be used in normal app/search/AI/provider context. Consequence: increased legal/operator obligations and disclosure, not permission for all immutable collections to remain. No legal retention duration invented. Recommend A unless an actual justified hold is established.

Proposed future state machine: authenticated fresh-confirmation erase request -> durable suppression intent -> revoke sessions/shares/invitations and stop new mutations/import/jobs -> bounded idempotent erase batches over versioned collection/reference graph -> verify zero active subject payload/copies -> minimal completion receipt. Never report completed if partial cleanup or provider revocation is unresolved. Failure must leave suppression active and retry safe. Ledger write must precede destructive work; no user financial detail in progress logs.

Restore release barrier: restore into an isolated namespace with no application users, provider actions, notifications or valid sessions; load the CURRENT independently durable deletion/revocation ledger (not its old restored copy); fail closed if unavailable/older than required; apply suppression and shared-content redaction; invalidate sessions/tokens/leases/queued sends; validate BSON/ownership/references/indexes/provenance; rebuild search only from surviving authorized inputs; approve controlled release. Historical backups age out on the approved 30-day policy, not edited in place or copied indefinitely. An exported/archived backup is also a copy subject to expiry. Backup restoration never authorizes a paid refresh, disconnect or email replay.

Shared household consequences: individually owned financial records remain owned, not transferred by erasure. Remove erased member's shares/membership/name and invitation remnants; invalidate membership epochs. For household-owner erasure recommend dissolution/revocation of the household while preserving each other member's independent finance, rather than implicit owner transfer. For other owners' reports/snapshots containing shared erased data, recommend explicit privacy-redacted replacement representation with an audit marker, not silent recomputation or continued display of personal amounts. This sacrifices exact old shared-report reproduction after valid erasure; independent other-user facts survive. Alternative owner-approved restricted holds require option B. Both choices need explicit approval before changing immutable evidence semantics.

Provider consequences: delete personal bindings/revisions/reconciliation/archives under approved scope; remotely revoking consent is a separate authorized workflow whose failure cannot be disguised as success. Tombstones must prevent old callbacks, jobs, receipts or restored external mappings from reimporting erased finance. A later fresh account/reconsent is a new explicit identity epoch and must not recover erased history. No automatic provider disconnect in this slice. Auth account IDs and provider subjects must not be logged or used as public ledger IDs.

## Next operator actions / recommended next slice

1. Sign into Atlas privately and allow read-only inspection of the existing project; inspect tier/region, namespace separation, role grants, network and actual snapshots. Do not paste URI/passwords. Then choose any backup gap remedy, cost and isolated restore target explicitly.
2. Privately verify Vercel uses the observed staging OAuth client and verify local/Preview/staging credential and DB separation. Same Vercel key names prove neither equality nor difference; do not add MONGODB_TEST_* to application runtime.
3. Review Vercel primary-domain exposure and platform training preference; approve any change separately. Confirm rollout/rollback operator and target before drills; no automatic rollback action here.
4. After code review/deployment approval, privately configure environment-local operator IDs and verify a real allowlisted session, second-user denial and no-data output on staging. Select legitimate monitor authentication, recipient and free/approved monitoring option; no user-only login bypass.
5. Approve erasure option A/B, ledger purpose/duration and shared owner/report policy before any deletion code. Approve a separate identity-key migration design before rotation.

Recommended next slice: close external read-only gaps, approve and verify deployed readiness/monitoring, then select backup/restore mechanism and failure-drill plan. Actual restore, erasure, load and key migration each retain their explicit gates. Phase 18 remains unaccepted.

## Verification

| Check | Executed result |
| --- | --- |
| Targeted new readiness tests | 9 unit + 2 real isolated loopback MongoDB tests passed; subsequent final focused rerun with inventory guard: 3 files / 13 tests passed |
| Full selected regression | 76 files / 387 tests passed, 1 file / 1 opt-in Financy reconnection test skipped; same six unrelated external/destructive exclusions as first slice |
| Type-check | Passed, including final test-only BSON import cleanup |
| Zero-warning lint | Passed |
| Production build | Passed, new dynamic Node readiness route present; no restart/deployment/port-3000 action |
| Dependency audit | Authorized registry audit: 0 vulnerabilities; no dependency/lockfile changes |
| Secret hygiene | Bounded exact configured-private-value scan: 340 source/test/client-build candidates, 0 matches; values never printed; `.env.local` ignored/untracked |
| External inspection | Vercel and Google read-only metadata as above; no new real auth flow/provider call/Atlas database query |
| Git | Second slice uncommitted for review; diff whitespace check passed; only scoped files changed, no second-slice push |

Actor injection in automated tests is explicitly not a real Google login. Real ping leaves both users' exact BSON fixtures unchanged; real closed-client failure is minimized. No deployed readiness success/denial, external alert, backup, restore, load or SLO compliance claimed. Excluded provider/destructive files: phase-eight-anthropic, phase-sixteen-anthropic, phase-fifteen-resend, phase-nine-financy, phase-nine-identity-evidence integration suites, and phase-nine-development-cutover operations. They would require unrelated external activity or destructive test operations and are not authorized/needed for this slice. All real-provider flags were off. Tests only create/drop their isolated random loopback test databases; no application/staging/user database is deleted.

Changed files: `.env.example`, `src/lib/operations/readiness.ts`, `src/app/api/ops/readiness/route.ts`, the two `phase-eighteen-readiness` unit/integration test files, this report, `PHASE_18_ENTRY_REVIEW.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, `PROGRESS.md`. No other product implementation changed.
