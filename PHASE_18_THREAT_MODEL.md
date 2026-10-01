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
| Invitation tokens | 32 random bytes, only the SHA-256 stored; bound to the invitee's e-mail; pending + unexpired; **an accepted token is spent** (W1, fixed in `6b16422`) and reactivation is atomic per invitation | `tests/integration/household-revocation.integration.test.ts` (6 tests) |
| Pages (server components) | `auth()` + `actorFromSession` (redirect without a session); identifiers from `params`/`searchParams` go through the same actor-scoped or principal-checked services (`?household` -> `requirePrincipal` **and** the actor's own household list; `?scope` allow-listed against the actor's current households) | `tests/integration/page-isolation.integration.test.ts`: every server-component page and layout rendered as two other users; `params`/`searchParams` are recording proxies: every directly read property, and every exposed key (each classified name plus a list of common identifier names) seen through spread/`Object.entries`/`for…in`/`in`, is answered with a real victim id of each of 18 seeded record kinds in turn; any read not classified in `pageMatrix` fails; redirects and refusals are checked for victim data too (2 tests); `pageMatrix` classifies every page, layout and Next.js special file |
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
| Information disclosure: lists/exports/search/aggregates and rendered pages | Actor-scoped, tested with victim markers and ids (routes and every page); exceptions F-18-14-01 and F-18-14-05 (same-user content kept after its authorization was revoked) |
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
| F-18-14-04 | Low (robustness) | Open — owner decision | 500 instead of 400 on two inputs |
| F-18-14-05 | Medium (authorization / data lifecycle) | Open — owner decision | Report-summary idempotency key reuse returns an earlier summary for another report, including one whose authorization was revoked (same class as F-18-14-01) |

### W1 — accepted invitation token restored a revoked membership (fixed)
- **Evidence:** reproduction through the real routes — after removal (or leave) and with the invitation expired, re-POSTing the same token to `/api/households/invitations/accept` returned 200 and the membership became `active` again; fail-before/pass-after regression tests; independent review found an in-flight race (M1), fixed atomically and re-reviewed clean.
- **Fix:** `household-service.ts` (an accepted token may only finish an activation that never happened) and `household-repository.ts:643-645` (`activatedByInvitationId: { $ne: invitationId }`). No schema/data change. Rejoining requires a new owner invitation.
- **Residual (Info):** an accepted-but-never-activated invitation stays completable without expiry and cannot be cancelled by the owner (I1) — safe only while membership rows are never deleted for a living user (no runtime path deletes them today; keep this invariant explicit in future erasure/cleanup work); an owner-created pending invitation for an active member remains usable after removal until it expires or is revoked (I3; largely limited by the one-active-invitation unique index and the active-member check at invite time). A theoretical multi-step in-flight replay across two invitation cycles was judged not practical by the reviewer (no attacker-controlled way to widen the window).

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
- **Evidence:** `reports/export` unsupported `format` throws `RangeError` → 500 (`src/app/api/reports/export/route.ts:14`, after the rate-limit bucket is consumed); a non-hex AI conversation id in the path → `RangeError` → 500 (`ai-conversation-repository.ts:78-81`).
- **Impact/scope:** no disclosure; wrong status codes and unhandled-error logs.
- **Proposed disposition:** map both inputs to 400 (`InputValidationError`).

### F-18-14-05 — report-summary idempotency reuse returns a summary of another (possibly revoked) report
- **Evidence:** `report-summary-repository.ts:39` returns the earlier summary for `{idempotencyKeyHash, userId}` without checking `reportId`; `report-summary-service.ts:51` has already called `provider.generate`. Split out of F-18-14-04 after independent review (2026-10-01): it is an authorization/data-lifecycle defect, not only robustness.
- **Impact/scope:** a user who reuses a key first used for a household report they have since lost access to, now against an authorized personal report, receives the revoked report's summary text (which can describe household-shared balances); also one wasted AI call. Same user, not cross-user — same class as F-18-14-01.
- **Proposed disposition:** look up the idempotency record (key + `reportId`) before the provider call and refuse a key bound to another report (409); return an existing summary only through its parent's current authorization.

### Info observations (no action proposed now)
- Onboarding/financial-data GET parse `section` before authentication (400 before 401 for an invalid section).
- Net-worth POST inserts the item before the profile check (`net-worth-service.ts:201-203`) — not an authorization issue.
- Household members see display names of former members in the audit trail (`household-service.ts:610-624`).
- Goal sharing checks the goal definition, not the goal record (`household-service.ts:544`); projections skip missing records.

## 6. Evidence (repository, 2026-10-01)

- **Coverage:** 85 route methods, 24 pages/layouts and 2 server-action modules, all classified in `tests/security/route-authorization-matrix.ts`. CI (`tests/unit/route-authorization-inventory.test.ts`) reads exports with the TypeScript compiler and fails on any unclassified, stale or duplicate route method, page/layout or server-action module, on any route export it cannot account for (`export *`, re-exports, destructuring, extra exports, any extension), and on any ownership boundary that lacks a live `it()`/`test()` negative test beyond authentication alone (verified by dropping temporary probe routes/pages in place: all detected). Routes — authentication: 80 session, 2 session + operator allowlist, 2 Auth.js protocol, 1 public; ownership: 59 actor, 5 actor + household, 10 household role, 6 provider-subject binding, 2 operator, 3 none. Pages — 19 actor, 1 household role, 1 actor + household, 3 none. 102 authorization-relevant identifiers (24 path, 18 query, 26 body, 16 nested body, 18 lookup-derived), each with its enforcement `file:line`; idempotency keys are user-scoped lookups throughout; 34 negative-test ids.
- **Negative tests** (real route handlers, services and repositories; isolated loopback MongoDB; synthetic data): `authorization-isolation` 16, `household-authorization` 5, `household-revocation` 6 (W1), `authorization-boundaries` 4 (the anonymous sweep iterates the CI-enforced matrix), `session-revocation` 2 (real Auth.js + MongoDB adapter + the app's `requireActor`), `page-isolation` 2 (every server-component page/layout rendered as two other users through recording proxies; the victim's documents must be unchanged afterwards) — 35 tests. Verified with temporary probe pages (each deleted afterwards): an account lookup by `[accountId]`/`?account` without an ownership filter, the same through a spread of `searchParams`, an AI-conversation detail page by `[conversationId]`, and a disclosure through a redirect URL are all caught; a page reading an unclassified `?foo` is caught by the classification check. Refusals assert an expected refusal status (a single status, or a small set where the code legitimately varies), **no disclosure** (victim markers and ids absent) and **no state change** (SHA-256 of every document in every collection, rate-limit counters excepted); allowed cross-user requests assert no disclosure and every victim-owned document (including the victim's own `_id`-keyed rows) unchanged, and fail if the victim owns nothing (no vacuous pass). Each test is independent of run order; the AI provider is mocked to fail if ever reached.
- **Mutation evidence** (temporary, never committed; each file restored and verified by SHA-256; `git diff src/` empty afterwards): 29 probes removing ownership filters (incl. the goal-definition lookup found by review), household role/status/owner checks, share re-authorization, the binding gate, the operator allowlist, the Origin check and both W1 rules — **every protection is detected once it is actually removed**. Single-layer probes that survived only because an independent second layer still enforced ownership (defence in depth, recorded): budget categories (three layers: P07), search (index query + per-hit re-validation: P15 survived, P15b detected), household view (principal + the actor's own household list: P27 detected by route tests, P27b detected by both page tests).
- **W1** fail-before/pass-after through the real routes; independent review + re-review of the fix (race M1 found and closed).
- **Limits recorded (Minor/Info, none applicable today):** the sweep inspects the props a page returns but does not execute nested async server components or `generateMetadata` (none exist today); within one render every unknown key receives the same victim id (pairs of related ids of different kinds are not combined); a key that fails format validation stops the render before later reads (still forced into classification, not exercised further); keys read only through enumeration are exercised only if they are classified or in the common-identifier list; metadata/special files (`opengraph-image`, `icon`, `sitemap`, …) must be classified but are not rendered (none exist today); disclosure is detected through victim text markers and the victim's user id, so for kinds without a text marker (forecasts, engine snapshots, transaction-intelligence runs, invitations, memberships) a future page rendering only their numeric/derived fields would not be flagged (rendering the document itself would be); negative-test ids are checked as live test titles but a matrix row is not checked against the route a test actually calls; suites gated on `MONGODB_TEST_URI` cannot skip silently in CI (the inventory fails if CI lacks it). Entry points outside `src/app` (middleware, proxy, instrumentation, a `pages/` router) fail the inventory until classified.
- **Independent adversarial review of the 18-14 package** (2026-10-01): 3 Important (untested goal-definition filter; pages unclassified; textual/authentication-only negative-test ids and a sweep narrower than the inventory) and 5 Minor (export-detection gaps, weak or vacuous checks, an order dependency, document inaccuracies, F-18-14-04 key reuse misclassified) — all fixed or recorded as above. Re-review: all confirmed fixed except the page sweep's fixed parameter list (N-1, Important) — fixed with recording proxies and the classification check — plus N-2 (special files, layouts, state check; fixed) and N-3 (CI skip guard; added). Final re-review: N-2/N-3 confirmed; three remaining page shapes (spread/enumeration, unseeded record kinds, disclosure through a redirect — R-1) fixed and each demonstrated caught; R-2/R-3 recorded as limits above.

## 7. What closes 18-14 (remaining, gated)

1. **Authorized negative tests on staging** (owner-approved window, synthetic accounts): the route matrix's cross-user and household cases against the deployed app — never on real users' data.
2. **DB/IAM/CI role review:** Atlas database users and roles (app user still database-scoped `readWrite` per the index inventory), AWS roles of the backup stack, Vercel and GitHub access — read-only evidence.
3. **Penetration / deployed security review** by an authorized reviewer.
4. Owner decisions on F-18-14-01…04 and on G1/G2 (sign-in allowlist, revoke-all sessions).
