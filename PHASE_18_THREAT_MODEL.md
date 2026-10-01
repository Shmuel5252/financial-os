# Phase 18 — Threat model and authorization review (row 18-14, repository portion)

2026-10-01. Owner-approved repository-only scope. Grounded in implemented controls (file references) and explicitly documented gaps; no
new policy is invented here. Evidence classes: **R** repository (code + tests), **E** external/deployed (not covered here). Row 18-14
stays **PARTIAL**: authorized negative tests on staging, the Atlas/AWS DB/IAM role review and a penetration/deployed review remain gated.

## 1. Assets and actors

- **Assets:** each user's manual financial records, derived snapshots/forecasts/reports/AI summaries, household-shared projections,
  bank-provider binding and imported provider data, sessions, operator metadata, the deletion ledger and backups (Phase 18 A+B).
- **Actors:** anonymous internet clients; any Google-authenticated user (sign-in has no allowlist — every Google account becomes a
  valid actor, `src/lib/auth/config.ts`); household owner; active member; removed/departed member; invitee; the allowlisted operator;
  the configured provider subject's legitimate owner; CI and dependency supply chain.

## 2. Trust boundaries and implemented controls

| Boundary | Implemented control (R) | Evidence |
| --- | --- | --- |
| Internet → app (authentication) | Every application route calls `requireActor()` (`src/lib/auth/actor.ts:28-35`): Auth.js database session looked up on **every** request (`@auth/core` `getSessionAndUser`); no session → 401; auth unconfigured → 503. The actor id comes only from the session, never from input. | `[iso-unauthenticated]` sweeps all 85 route methods; `[iso-session-signout]`, `[iso-session-invalid]` (real Auth.js + MongoDB adapter, real `requireActor`) |
| Browser → mutation | `assertTrustedMutationOrigin` (Origin must equal `AUTH_URL`) before authentication; JSON-only, 16 KiB bound; per-actor/scope rate limit | `[iso-mutation-origin]` |
| Actor → own data (ownership) | Every repository filter carries the session actor's `userId`; referenced records (accounts, transactions, loans, goals, categories, engine snapshots, forecasts, runs, conversations, reports, summaries) are re-resolved through actor-scoped lookups; cursors are raw ids used only as bounds inside the actor's own filter | `tests/security/route-authorization-matrix.ts` (identifier → `file:line`); 16 tests in `tests/integration/authorization-isolation.integration.test.ts` |
| Actor → household | `requirePrincipal` → `principalForActor` per request: owner, or **active** member of an **active** household; owner-only actions via `householdActionAllowed`; shares only of the actor's own resources; projections only of current shares at the owner's current membership epoch; saved household reports re-authorized with a share fingerprint on every read | `tests/integration/household-authorization.integration.test.ts` (outsider, member role, unshare, removal, dissolve) |
| Invitation tokens | 32 random bytes, only the SHA-256 stored; bound to the invitee's e-mail; pending + unexpired; **an accepted token is spent** (W1, fixed in `6b16422`) and reactivation is atomic per invitation | `tests/integration/household-revocation.integration.test.ts` (7 tests) |
| Actor → bank provider | Single operator-configured provider subject; binding unique per subject and per user; `assertBinding {provider, subjectAlias, userId}` before any provider call on sync/refresh/disconnect/reconciliation | `[iso-open-banking]` (fake provider, no network) |
| Operator surfaces | `/api/ops/*`: signed-in **and** in `OPERATIONS_OPERATOR_USER_IDS` (read per request), non-operators 403 before any probe; metadata only | `[iso-operator]`, existing readiness/bindings unit tests |
| Server actions | Two modules: sign-in (no input) and sign-out (Auth.js deletes only the caller's session row) | `serverActionMatrix`; `[iso-session-signout]` |
| Data at rest / backups / ledger | Phase 18 A+B (separate documents): TLS-only URIs, least-privilege `ledger-app`, Governance-retained encrypted packages, break-glass only deletes | `PHASE_18_RECOVERY_IMPLEMENTATION.md`, runbook S1–S12 |
| Supply chain / CI | npm audit gate, CodeQL security-extended, full-history gitleaks with self-test, SHA-pinned actions (18-16) | `PHASE_18_HARDENING_PACKAGE.md` |

## 3. Threats considered (STRIDE-oriented) and status

| Threat | Status (R) |
| --- | --- |
| Spoofing: request without or with a stolen-then-revoked session | Refused: per-request DB session lookup; sign-out and row deletion take effect immediately (tested). A stolen **live** cookie is valid until it expires or is signed out (HttpOnly, SameSite=Lax, Secure on https; 30-day sliding) — gap G2 |
| Spoofing: identity from input | Not possible: no route reads an actor id from input (matrix) |
| Tampering/IDOR: another user's id in path, query, body, nested body or cursor | Refused for every classified identifier with **no state change and no disclosure** (fingerprint of every document; response marker checks) |
| Tampering: member performs owner actions / shares another's resource | Refused (404/409), tested |
| Elevation: removed/departed member regains access | **W1 found and fixed** (replay of the accepted token, incl. expired, older-cycle and in-flight race); removal is immediate for view, reports, exports, search, saved household reports, shares |
| Information disclosure: lists/exports/search/aggregates | Actor-scoped, tested with victim markers and ids; exception F-18-14-01 (same-user stale AI-summary search hits) |
| Information disclosure: error bodies | Typed public errors only; refusals tested not to echo victim data |
| Repudiation | Audit trails on household, budget, goal, net-worth, notification records (existing); no new claim here |
| Denial of service | Rate limits per actor/scope (existing, 18-05 partial); no edge flood protection — out of scope here |
| Cross-site request forgery | Origin check on every mutation (tested); Auth.js double-submit CSRF on its own POSTs |

## 4. Documented gaps (not fixed in this change)

- **G1** Google sign-in has no allowlist: any Google account becomes an actor. Isolation holds (tested), but combined with F-18-14-02 a stranger could claim the single provider subject first on a multi-user deployment.
- **G2** Sign-out revokes only the current session; there is no "sign out everywhere" and no operator revoke-all path; sessions slide for 30 days.
- **G3** Auth.js swallows a session-lookup database failure as "no session" (401) — fails closed, but is indistinguishable from signed-out in logs.
- **G4** Refusal status codes vary (400/404/409) by route; none discloses existence, but monitoring cannot rely on a single code.
- **G5** No deployed/staging negative tests, DB/IAM role review or penetration test (gated E work, §6).

## 5. Findings register (18-14)

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| W1 | High | **Fixed** `6b16422` (owner-approved) | Replaying an accepted invitation token restored a removed/departed member (also expired, older-cycle, in-flight race) |
| F-18-14-01 | Medium (authorization / data lifecycle) | Open — owner decision | Search keeps returning AI-summary hits after access to the parent report is lost |
| F-18-14-02 | Medium (multi-user design) | Open — owner decision | Open-banking claim binds the configured provider subject to the first authenticated claimant |
| F-18-14-03 | Low | Open — owner decision | Bank disconnect deletes at the provider before the version check; the resulting conflict surfaces as 503 |
| F-18-14-04 | Low (robustness) | Open — owner decision | 500 instead of 400 on two inputs; summary idempotency key reuse across reports spends an AI call and returns the old summary |

### W1 — accepted invitation token restored a revoked membership (fixed)
- **Evidence:** reproduction through the real routes — after removal (or leave) and with the invitation expired, re-POSTing the same token to `/api/households/invitations/accept` returned 200 and the membership became `active` again; fail-before/pass-after regression tests; independent review found an in-flight race (M1), fixed atomically and re-reviewed clean.
- **Fix:** `household-service.ts` (an accepted token may only finish an activation that never happened) and `household-repository.ts:643-645` (`activatedByInvitationId: { $ne: invitationId }`). No schema/data change. Rejoining requires a new owner invitation.
- **Residual (Info):** an accepted-but-never-activated invitation stays completable without expiry and cannot be cancelled by the owner (I1); an owner-created pending invitation for an active member remains usable after removal until it expires or is revoked (I3).

### F-18-14-01 — AI-summary search hits outlive access to their parent report
- **Evidence:** `src/lib/search/search-service.ts:75-78` — report hits are re-validated through `findSavedReport` (ownership + household re-authorization + share fingerprint), but `ai_summary` hits only through `getReportSummaryRepository().findForActor` (`{_id, deletedAt:null, userId}`, `report-summary-repository.ts:47-49`).
- **Impact/scope:** after the parent report is hidden, or after the user loses household access or the owner unshares, `GET /api/search` keeps returning the summary's title and the first 240 characters of its text (which can describe household-shared balances) until the user rebuilds the index. The user is the summary's owner and previously had access, but the **authorization decision has been revoked** — this is treated as an authorization/data-lifecycle defect, not dismissed. Not cross-user.
- **Proposed disposition:** validate `ai_summary` candidates through their parent report with the same `findSavedReport` path (and drop them when it throws), and/or remove index entries when a report is hidden or household access ends. Add a negative test (removed member / unshare → no summary hit).

### F-18-14-02 — first-come binding of the configured provider subject
- **Evidence:** `open-banking-service.ts:219-242`, `open-banking-repository.ts:315-338`; documented design in `OPEN_BANKING_RUNBOOK.md` (the configured subject is claimed by exactly one signed-in user); `[iso-open-banking]` proves a second claimant is refused once bound.
- **Impact/scope:** on a deployment with more than one user, if the owner has not yet claimed, any authenticated Google user can claim the configured bank subject and import its data (G1).
- **Proposed disposition:** bind the provider subject to an operator-configured user id (deployment setting) or require an operator confirmation before the first claim; keep the uniqueness guarantee.

### F-18-14-03 — disconnect ordering
- **Evidence:** `open-banking-service.ts:452-460` — the provider's `deleteConnection` runs before `markDisconnected` checks `expectedVersion`; a stale version still deletes at the provider and the conflict is wrapped as 503.
- **Impact/scope:** not an IDOR (connection is resolved `{_id, userId, provider}` and the binding gate precedes it); integrity/UX — the local record can disagree with the provider after a stale request.
- **Proposed disposition:** verify version and state before calling the provider; report a conflict as 409.

### F-18-14-04 — robustness items
- **Evidence:** `reports/export` unsupported `format` throws `RangeError` → 500 (`src/app/api/reports/export/route.ts:14`, after the rate-limit bucket is consumed); a non-hex AI conversation id in the path → `RangeError` → 500 (`ai-conversation-repository.ts:78-81`); `report-summary-repository.ts:39` returns an earlier summary for the same `{idempotencyKeyHash, userId}` without checking `reportId`, after `provider.generate` already ran (`report-summary-service.ts:51`).
- **Impact/scope:** no disclosure; wrong status codes and unhandled-error logs; one wasted AI call and a stale (possibly no-longer-authorized) summary returned on key reuse.
- **Proposed disposition:** map both inputs to 400 (`InputValidationError`); check the idempotency record (including `reportId`) before calling the provider.

### Info observations (no action proposed now)
- Onboarding/financial-data GET parse `section` before authentication (400 before 401 for an invalid section).
- Net-worth POST inserts the item before the profile check (`net-worth-service.ts:201-203`) — not an authorization issue.
- Household members see display names of former members in the audit trail (`household-service.ts:610-624`).
- Goal sharing checks the goal definition, not the goal record (`household-service.ts:544`); projections skip missing records.

## 6. Evidence (repository, 2026-10-01)

- **Coverage:** 85 route methods + 2 server-action modules, all classified in `tests/security/route-authorization-matrix.ts`; CI (`tests/unit/route-authorization-inventory.test.ts`) fails on any unclassified, stale or duplicate route/method or server-action module, and on any ownership boundary without an existing negative test. Authentication: 80 session, 2 session + operator allowlist, 2 Auth.js protocol, 1 public. Ownership: 59 actor, 5 actor + household, 10 household role, 6 provider-subject binding, 2 operator, 3 none. 95 authorization-relevant identifiers (22 path, 14 query, 26 body, 16 nested body, 17 lookup-derived), each with its enforcement `file:line`; 32 negative-test ids.
- **Negative tests** (real route handlers, services and repositories; isolated loopback MongoDB; synthetic data): `authorization-isolation` 16, `household-authorization` 5, `household-revocation` 7 (W1), `authorization-boundaries` 4 (incl. the anonymous sweep over every route method), `session-revocation` 2 (real Auth.js + MongoDB adapter + the app's `requireActor`). Refusals assert the exact status, **no disclosure** (victim markers and ids absent) and **no state change** (SHA-256 of every document in every collection, rate-limit counters excepted); allowed cross-user requests assert no disclosure and every victim-owned document unchanged.
- **Mutation evidence** (temporary, never committed; each file restored and verified by SHA-256; `git diff src/` empty afterwards): 26 probes removing ownership filters, household role/status checks, share re-authorization, the binding gate, the operator allowlist, the Origin check and both W1 rules — **all detected**. Two single-layer probes survived because a genuine second layer still enforced ownership (defence in depth, recorded): budget categories (service lookup → repository lookup → update filter, all three must go: P07) and search (index query → per-hit actor-scoped re-validation, both must go: P15b).
- **W1** fail-before/pass-after through the real routes; independent review + re-review of the fix (race M1 found and closed).

## 7. What closes 18-14 (remaining, gated)

1. **Authorized negative tests on staging** (owner-approved window, synthetic accounts): the route matrix's cross-user and household cases against the deployed app — never on real users' data.
2. **DB/IAM/CI role review:** Atlas database users and roles (app user still database-scoped `readWrite` per the index inventory), AWS roles of the backup stack, Vercel and GitHub access — read-only evidence.
3. **Penetration / deployed security review** by an authorized reviewer.
4. Owner decisions on F-18-14-01…04 and on G1/G2 (sign-in allowlist, revoke-all sessions).
