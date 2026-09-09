# Phase 18 — environment binding and least-privilege rehearsal

## Owner-approved checkpoint security review — 2026-09-09

Owner authorized one checkpoint of all approved uncommitted operational foundation/binding rehearsal work after final review, then stop after push. This supersedes earlier no-commit instructions for this checkpoint only; no live cutover/configuration change or Phase 19.

Final `/api/ops/bindings` review: existing explicit operator ID allowlist is required in addition to server-derived Auth.js authentication; ordinary users receive only 403/forbidden, anonymous users only 401/authentication_required, disabled allowlist only 403, authentication failure only bounded 503. No binding metadata or database probe for these cases. The route accepts no selector/query/body/header for environment inspection. Authorized output is exactly the fixed policy tag and bounded match/mismatch/unknown or presence assertions. No URI/host/user/password, arbitrary environment value, auth/provider secret/token, financial record or user identifier is serialized. Mongo errors become unknown; no-store/Vary Cookie retained. No product code change needed for this review.

Six new route-level regression cases cover anonymous/ordinary/disabled/auth-failure, operator exact response plus ignored inspection parameters, and sanitized database failure. Existing configuration/allowlist/timeout/redaction tests retained. The initial anonymous fixture crossed Vitest resetModules class identities and returned sanitized unavailable instead of authentication_required; fixed the test to load the same error class instance, not the production guard. Prior interrupted verification sessions were unavailable after resumption, so final checks were rerun rather than assumed successful.

Checkpoint verification on 2026-09-09: 80 files / 405 tests passed, 1 opt-in Financy reconnection test skipped; the six previously documented unrelated external/destructive exclusions remain unchanged. Real local MongoDB integration and disposable authenticated-role rehearsal executed. Type-check, zero-warning lint and production build passed. Registry audit: 0 vulnerabilities. Bounded configured-credential scan: 364 source/test/client-build/document/example candidates, 0 credential matches (known credential-free loopback URI excluded). .env.local ignored/untracked; diff whitespace check passed. Commit message: `chore(phase-18): checkpoint protected operations and role rehearsal`. Exact SHA and fresh post-push synchronization are reported in the checkpoint handoff; no hosted verification is inferred from the push.

After the pushed revision builds successfully in Vercel, that exact deployment should be the private binding-verification target. Operator allowlist/classification are not configured by this checkpoint. No real hosted binding/login acceptance is claimed. Use a separately approved private configuration step; do not infer runtime principal/cluster identity from namespace assertions.

2026-09-08. Bounded third slice, uncommitted pending review. Existing approved uncommitted second-slice work preserved. Phase 18 NOT accepted; no Phase 19. No Atlas/Vercel/Google/provider mutation, secret replacement, network change, paid service, backup/restore or financial behavior change.

## Evidence reconciliation

Owner accepted the real read-only infrastructure review: Atlas project financial-os-staging; Cluster0financial-os-staging, Free, AWS eu-central-1; financial_os_staging exists. One visible database user has atlasAdmin @ admin / All Resources; **not proven to be the runtime credential**. 0.0.0.0/0 active, backups inactive, security/operations contacts not designated. Vercel staging Production tracks main and functions use iad1. Owner-verified deployed Google/Auth.js + MongoDB operation remains valid historical evidence. Second-slice statements that Atlas inspection is wholly absent are superseded by this dated record, not deleted from history. Full environment/credential isolation and recovery targets remain unverified.

## Environment-binding mechanism

New `/api/ops/bindings` uses existing Auth.js actor and the same explicit default-denied OPERATIONS_OPERATOR_USER_IDS allowlist as readiness. No query/body/header chooses an environment key, database or actor. No finance access, new collection, log sink or provider request. Five-second response bound; no-store/Vary Cookie. Unknown/failed authentication gives only existing bounded failure status, never binding evidence. Ordinary users denied.

Version `staging-binding-v1` compares against fixed, public-reviewed contract: namespace financial_os_staging and origin https://financial-os-staging-nine.vercel.app. It returns only:

| Field | Meaning / limitation |
| --- | --- |
| classification | match only if FINANCIAL_OS_ENVIRONMENT explicitly equals staging; other values mismatch; missing unknown. VERCEL_ENV=production does not imply staging |
| configuredDatabase | runtime parsed MONGODB_DB_NAME matches the fixed staging namespace, differs, or is absent/invalid |
| connectedNamespace | selected DB handle matches and authUsers collection exists through metadata-only listCollections; no documents queried. Missing collection/failure remains unknown, not a false negative financial diagnosis |
| authOrigin | configured AUTH_URL exact fixed-origin match/mismatch/unknown |
| requiredConfiguration | required auth/database keys structurally present/incomplete/unknown; does not prove validity of credentials |
| clusterIdentity / credentialIdentity | always unknown; deliberate boundaries, not inferred from DB name or one visible Atlas user |

No URI, username, password, secret, token, raw namespace value, error, hostname, ID or financial payload emitted. Only literal policy tag and enum values. Classification/name mismatch prevents DB inspection. A ping alone cannot prove a database exists; hence the metadata check. Identically named databases on different clusters cannot be distinguished by this contract. Declared environment classification is an assertion to compare with Vercel project mapping, not cryptographic isolation proof.

No operational allowlist, staging classification or remote value configured here. Endpoint not deployed or tested with a real Google operator session. New `.env.example` classification is local, not a private credential or staging switch. Existing config/financial flows unchanged. Tests are not a substitute for the hosted operator gate.

## Actual least-privilege rehearsal

The test owns a newly spawned MongoDB 8.3 process, random OS-selected loopback port, private random temporary data directory and --auth. It never takes a MongoDB target URI from .env.local; no command can target Atlas/development. Child environment excludes application secrets. Bootstrap root and readWrite credentials are generated in memory, never printed or saved as fixtures. Child logs are consumed only for readiness and never forwarded. Child process stopped; only its validated temporary directory removed. Existing MongoDB services and ports 3000/3001 untouched.

Positive tests use a real readWrite principal restricted to a disposable database named financial_os_staging (the name does not make it the live staging database):

- Exact BSON int64 beyond JS safe integer range, find/findOne/count, insertOne/insertMany, update/upsert/findOneAndUpdate, deleteOne/deleteMany and ping.
- Unique/partial duplicate rejection and TTL index creation/options. This is index permission/definition evidence, not a timing test of TTL monitor expiry.
- Installed Auth.js adapter user/account/session/verification-token CRUD, account lookup/unlink, session update/sign-out invalidation and one-time token consumption. No actual Google call.
- All repository index initializers, every manual section, reconciliation and limiter; repository factories and manual initializers repeated to verify idempotent initialization. Offline development utility indexes only, never its retirement mutation.
- Real profile service ownership and stale-write conflict checks. Full regression adds the existing multi-domain user/household isolation tests.

Negative tests require actual MongoDB Unauthorized code 13, not syntax/unsupported-operation failures: foreign DB read/write/drop; usersInfo; createUser; createRole; grant root to self. Foreign sentinel survives, and authenticated roles remain exactly database-scoped readWrite. All targets are inside the disposable child process, including the "unrelated" database. No staging destructive test.

**Conclusion:** readWrite on financial_os_staging is sufficient for the exercised current application operations on real local MongoDB 8.3. No atlasAdmin need identified. Atlas runs 8.0.32 and has service-specific restrictions; this rehearsal does NOT prove a live Atlas principal/deployment. The separately approved live cutover must validate that boundary before old credentials are retired. No blanket promise that future administrative/migration paths need no separate operator role.

PHASE_18_INDEX_INVENTORY.md identifies all source index definitions, manual expansions and offline/test-only distinction. A custom role could remove DDL privileges after separate initialization and release barriers; no such refactor/grant change occurred. readWrite still allows broad modification inside its database and cannot enforce end-user/immutable evidence policies by itself.

## Exact next live-cutover checklist — execution requires separate approval

### Preconditions

1. Owner approve exact target project/cluster/database, new staging application user, role and Vercel Production binding. No Preview/local/provider/Google/Auth secret changes. Confirm working revision and rollback deployment.
2. Privately establish old deployment credential source and who else uses it. Write-only Vercel values cannot be reconstructed by assumption. Keep old credential recoverable through the owner's secret manager; never paste it or write it into logs/repository. If rollback credential cannot be recovered, stop before cutover.
3. Operator-authorized binding endpoint must be deployed/configured in a separately approved step, or equivalent owner evidence recorded; require configuredDatabase/authOrigin/classification matches and populated namespace metadata. Resolve cluster/principal identity independently through private credential records or an separately reviewed narrowly scoped runtime attestation. A matching namespace alone is insufficient.
4. Record baseline real login/session/read-write health, cold/warm latency, deployment, current data/index integrity and rollback trigger conditions. Use approved synthetic owner accounts; no paid provider test. Agree observation window and incident operator before change.

### Create and canary

5. Create dedicated staging application user with readWrite only on financial_os_staging and restrict cluster access. Do not alter/delete visible atlasAdmin user. No extra user-admin/backup permissions. Privately store new credential under a distinct environment-scoped reference.
6. Preflight that principal against the intended staging namespace, then exercise approved synthetic records/index initializers. Do not run foreign-DB drop/user administration tests on staging; those belong to this disposable rehearsal only.
7. Update ONLY MONGODB_URI for financial-os-staging's Production environment to the new principal. Keep namespace, AUTH_SECRET, AUTH_URL, OAuth/provider values unchanged. Confirm no inherited/Preview override is accidentally changed. Do not put MONGODB_TEST_* into runtime.
8. Deploy approved same application revision, record new deployment ID/revision/time. Previous deployments retain their old configuration; editing a value alone is not cutover. Do not simultaneously change region/network/tier.

### Acceptance

9. Real Google sign-in: callback succeeds; same canonical user identity, no duplicate user. Verify database-backed session persists on subsequent requests. Sign out; session no longer authenticates. Do not log the token/cookie.
10. Use two approved synthetic staging users: create/read/update controlled financial fixtures via normal validated UI/API; verify each cannot see/edit the other's data. Preserve audit/version behavior and exact money. No manual deletion of immutable history to clean up fixtures.
11. Verify warm reused Mongo connection and new/cold function connection, operational binding/readiness, expected indexes, no authorization/configuration errors, and successful core paths. Watch only bounded categories/status/latency, no raw OAuth query strings or finance payloads.
12. Observe for the agreed window, including new connections and older in-flight requests. If a required check fails or unexplained error/latency regression appears, do not compensate by granting atlasAdmin; investigate or rollback.

### Rollback / retirement

13. Keep old user valid throughout acceptance. On failure, deploy known-good revision with the previous staging Mongo credential; verify domain mapping and real session/core operation. No financial restore or key change needed for a credential-only rollback. If prior deployment promotion is unavailable, redeploy with the privately preserved old value. Do not assume code rollback changes current dashboard variables automatically.
14. After acceptance, verify no older deployment/function, CI job, developer or other application requires the old application credential. Existing pools may remain authenticated temporarily; an immediate successful warm request does not prove cutover. Restrict/retire old deployment access under a separate approved control if necessary.
15. Obtain explicit approval to retire ONLY the proven old application credential. A shared/operator administrator must not be deleted just because it is visible. Record safe audit evidence, then revalidate fresh connections. Never retire rollback before proof.

## Backup secret boundary

PHASE_18_BACKUP_BOUNDARY.md classifies all 52 collections as must preserve/rebuild/exclude/filter, marks credential/session material and deletion/household/provider/job/auth restore barriers. Raw authAccounts may carry access/refresh/ID tokens; authSessions and verification tokens are excluded. authUsers stable identity must survive; token-free linkage needs real fresh-login recovery verification. Managed snapshot of current mixed storage is NOT secret-free merely because encrypted. Ordinary free-form text and nested development archive BSON require allowlisted export/content review. No backup jobs, auth storage changes or retention decisions implemented.

## Verification / limitations

Final local verification:

| Gate | Result |
| --- | --- |
| New targeted tests | 3 files / 12 tests passed; final rerun includes real binding metadata check under the restricted principal |
| Full selected regression | 79 files / 399 tests passed, 1 opt-in Financy reconnection test skipped; real loopback MongoDB integration and independent auth-enabled disposable instance included |
| Type-check | Passed, including final focused rerun |
| Zero-warning lint | Passed after correcting reserved test variable name |
| Production build | Passed; dynamic protected bindings/readiness routes included, no application server restart/deployment |
| Registry dependency audit | 0 vulnerabilities; no dependency changes |
| Source inventory | All 90 source createIndex call sites named/classified; all 52 source collections classified in backup boundary; tests guard coverage |
| Exact-value scan | 362 source/test/client-build/document candidates; one match was independently confirmed to be a credential-free, query-free loopback URI already present in HEAD:PROGRESS.md. No actual credential match found; no value printed or historical content changed |
| Git hygiene | diff --check passed, .env.local ignored/untracked; existing prior work preserved; no staging, commit or push |
| Hosted/backup gates | Not run: real deployed binding/operator/Google/Atlas credential cutover, external provider calls, backup/restore. No acceptance inferred |

Initial type fixture issues (test child environment, import.meta typing and owner filter generics) corrected; lint caught a reserved module variable and it was renamed. No security check disabled. Full regression excludes the same six external/destructive suites as the previous slice: phase-eight-anthropic, phase-sixteen-anthropic, phase-fifteen-resend, phase-nine-financy, phase-nine-identity-evidence integration suites and phase-nine-development-cutover operations. Their real-provider flags were disabled; prohibited external activity was not substituted by mocks. New role tests exercise real local authentication, not a real Google callback. The Windows binary is discovered at a fixed local path; if unavailable in another runner this suite explicitly skips and must not count as verified there. This run did execute and pass it.

New files: src/lib/operations/environment-binding.ts; src/app/api/ops/bindings/route.ts; tests/unit/phase-eighteen-bindings.test.ts; tests/unit/phase-eighteen-binding-inventory.test.ts; tests/integration/phase-eighteen-role.integration.test.ts; PHASE_18_BINDING_REHEARSAL.md; PHASE_18_INDEX_INVENTORY.md; PHASE_18_BACKUP_BOUNDARY.md. Updated .env.example, PROGRESS.md, DECISIONS.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, PHASE_18_ENTRY_REVIEW.md. Earlier second-slice files remain present/uncommitted, not replaced.

Bindings still requiring owner action: actual remote operator session/configuration/deployment, private cluster/principal/OAuth credential equality, Preview/local/future-production separation. Atlas/Google/provider access untouched. No live cutover readiness claimed solely from unit injection or local Mongo evidence. No Phase 18 acceptance or commit/push before review.
