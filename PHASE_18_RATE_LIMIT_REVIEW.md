# Phase 18 row 18-05: rate limiting and abuse control (repository portion)

Status: **PARTIAL**. This records what the code does today, with local evidence. Nothing in it changes a limit, adds a limiter or
adopts a threshold. Findings F-18-05-01..13 are open and are **not** remediated here; each needs its own Owner decision. Proposed
thresholds are in `PHASE_18_RATE_LIMIT_THRESHOLDS_DRAFT.md` (DRAFT / NOT ADOPTED). No runtime/app code, limiter, staging, AWS, Atlas,
Vercel or S10 change was made. All evidence is local and synthetic: loopback MongoDB only, with counting stubs in place of
Anthropic/Financy/Resend.

## 1. Sources of truth and CI enforcement

| Artifact | Role |
|---|---|
| `tests/security/rate-limit-matrix.ts` | The decision for every route method, page/layout file and server action: policy, scope, caller identity, worst-case cost, rationale, cited findings |
| `tests/security/rate-limit-sites.ts` | TypeScript-AST scan of `src/`. For each route handler it records which limiter is called and the order of origin → actor → limiter → body (arguments before the call; every helper call counted). It also reports limiter calls outside a handler body; structural weaknesses (a limiter call that is not awaited directly in the handler, is not keyed on the `await requireActor()` result, or comes after a return/throw path); every reference to the limiter module (aliases, namespace or dynamic imports, shadowing declarations); the module's export list; and every `"use server"` directive found with the AST |
| `tests/unit/rate-limit-inventory.test.ts` (7 tests, a required module) | Fails CI on a new, stale, missing or wrongly classified entry, or on a structural bypass. Checks: exact limiter and scope per handler; the call is awaited once, directly, on the `const actor = await requireActor()` binding, and preceded **only** by an allowlist (origin check, `requireActor`, `resolveSection`), so no work or early exit runs first; the handler's `catch` is exactly `return errorResponse(error)`; every reference to a limiter-module name is the direct callee of a call (no aliases, parentheses or values); no `import()`/`require()` uses a non-literal path; the limiter is imported only as the two named wrappers and only in limited route files; the module exports are pinned; the server-action universe (AST) matches 18-14; `none` carries a concrete rationale; a heavy or provider-backed `none` cites a finding; identities agree with the 18-14 authentication classes. **Structural only: presence is not proof of effect** (see `[rlx-route-sweep]`) |
| `tests/integration/rate-limiter.integration.test.ts` (`[rl-*]`, 9 tests × 2 servers) | The real `MongoRateLimiter` against the standalone server and the single-node replica set |
| `tests/integration/rate-limit-routes.integration.test.ts` (`[rlx-*]`, 9 tests) | Real route handlers on loopback Mongo: the 429 response, accounting, anonymous callers, store failure, policy values (`[rlx-policies]`), the provider-cost and far-month reproductions, and **`[rlx-route-sweep]`**. The sweep calls every limited matrix entry (59) with a recording limiter that refuses, and asserts: 429, exactly one call, the matrix scope, the actor's own user id, and no write. For templated `[section]` routes it also asserts that an invalid section gets a non-429 response without any limiter call. **Out of reach:** a limiter built without the limiter module (for example a direct `findOneAndUpdate` on `rateLimits`) is not inventoried. Code review is the backstop for that, and for code that deliberately detects the test environment |
| `tests/integration/phase-nine-open-banking.integration.test.ts` `[rlx-refresh-no-cooldown]` | Paid-refresh reproduction with the fixture provider |
| `tests/security/required-tests-reporter.ts` | `[rl-…]`/`[rlx-…]` ids are now required test ids (they must run and pass in CI, never be skipped): 70 required ids in total, up from 51. `rate-limit-inventory.test.ts` is a required module with exactly 7 tests |

## 2. Coverage and policy counts

The matrix has 113 entries, exactly the universe CI derives from the source:

- **85 API route methods:** 83 handlers found by the scan, plus Auth.js `GET` and `POST`. Auth.js re-exports `handlers`, so the scan cannot see those two and they are taken from the 18-14 matrix.
- **26 page/layout/error/not-found files.**
- **2 server-action modules.**

| Surface | mutation (30/60 s) | ai (10/h) | authjs | none | total |
|---|---|---|---|---|---|
| Route methods | 58 | 1 | 2 | 24 | 85 |
| Pages and layouts | – | – | – | 26 | 26 |
| Server actions | – | – | 2 | – | 2 |

**Limited methods by cost:**
- mutation: 30 light, 5 moderate, 15 heavy, 8 provider.
- ai: the single `POST api/ai/conversations` (provider).

**Unthrottled route methods by cost:** 1 static, 9 light, 8 moderate, 6 heavy.

**Unthrottled pages by cost:** 5 static, 8 light, 8 moderate, 5 heavy.

**Scopes:** 53 scope expressions. 51 are static. The other 2 are templated: `financial-data-${section}` covers 10 sections and `onboarding-${section}` covers 7. That gives **68 independent mutation budgets per user plus `ai-copilot`**.
- Two routes share a scope: `POST`/`PUT api/budgets/categories`.
- Each templated scope is shared by POST, PUT and DELETE of its section.

**Ordering, as pinned by CI:**
- 56 limited mutations run origin → actor → limiter → body.
- 3 limited GETs run actor → limiter. These are `financial-data/export` (`financial-data-export`), `reports/export` (`report-export`) and `open-banking/reconciliation` (`bank-account-review-read`).
- No handler calls more than one limiter.
- No limiter call exists outside a route handler.

## 3. Explicit `none` decisions

Every unthrottled surface is a recorded decision with a rationale in the matrix. Summary:

| Surface | Cost | Rationale (abridged) | Finding |
|---|---|---|---|
| GET api/health | static | Constant JSON; no session, database or network I/O | – |
| GET api/ops/readiness, GET api/ops/bindings | moderate | Operator allowlist is checked before the probe; 5 s deadline; returns only a category or enums | – |
| GET api/profile | light | One profile read | – |
| GET api/notifications | light | ≤100 notifications; no evaluation or Resend call | – |
| GET api/financial-data/[section] | light | One page of ≤50; section validated before auth | – |
| GET api/onboarding/[section] | light | ≤101 records; section validated before auth | – |
| GET api/forecasts | light | Two stored lists (10 and 20); no computation | – |
| GET api/purchase-simulations, debt-strategies, net-worth/snapshots | light | Pages of ≤20 | – |
| GET api/ai/conversations | light | ≤20 conversations × ≤24 messages; no provider call | – |
| GET api/financial-data/snapshots, financial-engine/snapshots | moderate | Pages of ≤20, but documents grow with record count | – |
| GET api/transaction-intelligence/runs | moderate | Latest run + ≤1,000 reviews | – |
| GET api/open-banking | moderate | Stored center (unbounded connection list, ≤2,000 revisions); never calls Financy | – |
| GET api/progress-journeys | moderate | ≤5,001 events, ~28 createIndex | F-05 |
| GET api/net-worth/items | moderate | ~9,000 documents, ~48 createIndex | F-05 |
| **GET api/reports** | heavy | Full current report (≤10,000 source records + goal/net-worth centers) + ≤50 saved reports. Each household report loads the household center sequentially: **≤51 `loadHouseholdCenter` per GET** | F-05 |
| **GET api/search** | heavy | ≤100 candidates validated in parallel, each building repositories. A notification hit reloads the notification center; a household-report hit loads the household center. Worst case ≈50 household centers or 100 notification centers per GET | F-05 |
| GET api/households, households/[householdId] | heavy | `loadHouseholdCenter`: ~150 queries over ≤50 households. For the selected household: ≤~1,500 sequential share lookups plus an invitation-expiry write | F-05 |
| GET api/reports/[reportId], report-summaries | heavy | A household report re-checks membership through the household center | F-05 |
| GET/POST api/auth/[...nextauth] | provider (authjs) | Auth.js protocol; no application code runs first. Forged cookie → session lookup; callback → Google token request | F-08, F-13 |
| ACTION src/app/sign-in/page.tsx | provider (authjs) | Anonymous input-free `signIn("google")` → uncached OIDC discovery fetch to Google on every POST | F-08 |
| ACTION src/lib/auth/actions.ts | light (authjs) | signOut deletes only the caller's session | – |
| PAGE layout, page, not-found, error, sign-in | static | No I/O on render (sign-in parses configuration only) | – |
| PAGE copilot, forecasts, notifications, financial-data/[section], financial-data/profile, onboarding/profile, onboarding/[section], open-banking/reconciliation | light | Session + profile + small bounded reads; reconciliation loads on click through the limited GET | – |
| PAGE financial-data, debt-strategies, goals, onboarding/review, open-banking, transaction-intelligence | moderate | Bounded centers (goals: N+1 of ≤50 lists; review: 7 lists, also for users then redirected) | – |
| PAGE net-worth, progress | moderate | As the matching GET routes | F-05 |
| **PAGE dashboard** | heavy | Freshness check loads 9 whole sections + goals: **up to ~100,000 documents validated per render** | F-05 |
| PAGE purchase-simulation | heavy | Same freshness check (~90,000 documents) + unindexed horizon query | F-05 |
| PAGE budgets | heavy | 5 whole-section loads, corrections over ≤10,000 ids, recurrence expansion driven by `?month` | F-05, F-12 |
| PAGE households, reports | heavy | Household center; reports also builds the full current report and saved reports | F-05 |

**Facts behind these decisions:**
- No GET route and no page render calls a provider. No component triggers a provider call by itself: there is no `useEffect` in `src/components`, and every provider action is a POST behind a button.
- The only GET-render write is invitation expiry in `loadHouseholdCenter`, which is idempotent per invitation.

## 4. Concurrency, atomicity and distributed instances (local evidence)

The real `MongoRateLimiter` was run against both MongoDB 8.3 servers locally; CI uses 8.0. Two `MongoClient`s, each with its own limiter instance, stand in for two serverless instances.

| Test | Result on both servers |
|---|---|
| `[rl-sequential]` | Exactly 30 grants, then `RateLimitedError`. Another actor and another scope each have their own budget |
| `[rl-concurrent-first-creation]` | 100 simultaneous first requests from one actor across both instances: **exactly 30 granted, 70 limited, 0 other errors** (no E11000). One counter document with count 100 |
| `[rl-concurrent-boundary]` | 28 pre-consumed, then 20 simultaneous: **exactly 2 granted** |
| `[rl-distributed]` | Concurrent bursts of 25 from each instance: **30 granted in total**. Instances never get separate budgets |
| `[rl-rollover]` | 40 at end−1 ms plus 40 at end: 60 granted, in two counters (`windowStart`, `end`). This is the fixed-window 2× burst (F-03) |

**Why this holds:** the limiter does one `findOneAndUpdate` with `$inc` and `upsert` on a deterministic `_id` (`scope:sha256(userId):windowStart`), and the server applies it atomically. When two upserts race to create the counter, the server retries the duplicate-key insert, so the caller never sees it. Every request increments, including refused ones (`count` reached 100 in the first-creation test), so the counter records attempts, not grants.

## 5. Failure modes

| Condition | Behaviour | Evidence |
|---|---|---|
| Server unreachable | `consume` rejects with `MongoServerSelectionError`, never a grant. In the app: with database sessions, `requireActor()` → `auth()` reads `authSessions` through the MongoDB adapter **before** the limiter, so an outage most likely fails at authentication first. If authentication succeeds, then on a **cold** instance `getDatabase()` fails and raises `DependencyUnavailableError` (503). On a **warm** instance (cached client) the limiter's `createIndex`/`findOneAndUpdate` wait for server selection (30 s in production) and then fail as an unexpected error, giving 500. Either way the request is refused before any work: **fail-closed** | `[rl-failure-modes]` (driver level); the cold/warm split is from code (`mongodb.ts`), not exercised end to end |
| Operation timeout or unexpected driver error | Propagates. The route returns 500 `INTERNAL_ERROR` with a generic body, logs only the literal `Unhandled route error`, and nothing is written. **Limitation:** the "timeout" case is a stub that throws a timeout-named error. The real client sets no `timeoutMS`/`socketTimeoutMS` (`mongodb.ts:16-24`), so a connected but hung server blocks the request until the platform function timeout: still no grant, but an availability cost. `[rlx-store-failure]` replaces the wrapper, so the real `getDatabase` → `ensureIndexes` → `consume` path is not run under failure | `[rl-failure-modes]`, `[rlx-store-failure]` |
| `findOneAndUpdate` returns `null` | Treated as limited (429), never as granted | `[rl-failure-modes]` |

**Availability impact:**
- A MongoDB outage makes every limited route fail. Those routes need MongoDB for their own work anyway, so this adds no new dependency.
- Server selection waits up to 30 s in production (`mongodb.ts`) before failing.
- No fail-open path exists. No behaviour was changed. A hung (not refused) database makes limited requests wait for the platform timeout. That is an availability observation, recorded under F-18-05-07's per-request database dependency, not a separate finding.

## 6. Keys and isolation

| Caller | Identified by | Notes |
|---|---|---|
| Anonymous | Nothing | Every session route returns 401 before the limiter, creating no key (`[rlx-anonymous-no-key]`). Auth.js endpoints and the sign-in action have no limiter at all. There is no IP, global or anonymous key, no `middleware.ts`/`proxy.ts`, and no use of `x-forwarded-for` (F-06, F-08) |
| Authenticated actor | `sha256(userId)` in the counter `_id`; the raw id is never stored (`[rl-key-derivation]`) | Budgets are per scope; there is no per-user cap across the 68+1 scopes. The aggregate is about 2,040 mutations/min per user (F-04) |
| Household operations | The acting member's own key | A household has no shared budget. Each member spends their own; N members get N× the budget against one household |
| Operator | The operator allowlist is checked before the probe | No limiter |
| Provider/webhook/callback | No webhooks exist. The only callback is Auth.js OAuth | Open-banking calls are user-initiated POSTs with the actor's key |

**Can an attacker cheaply obtain, reset or change the key?**
- Sign-in has no allowlist (`auth/config.ts` has only a `session` callback), so each new Google account is a fresh set of 69 budgets (F-06). Signing out and back in does not reset anything, because the key is the user id, not the session.
- Varying a scope does not help. Scope strings are fixed in code, and templated sections are zod-validated *before* the limiter, so an invalid section cannot create a budget. This is enforced by `[rlx-route-sweep]` (invalid section → no limiter call) and by the pre-limiter allowlist.
- Changing the window is impossible: it is computed from the server clock.

**Related:** the open-banking provider subject binds to the first claimant. That is already open as F-18-14-02. With open sign-in, an unclaimed deployment could be claimed by any Google account. This review records the dependency and does not re-open it.

## 7. The 429 response (`[rlx-429-safe]`)

- **Body:** exactly `{correlationId, error: {code: "RATE_LIMITED", message: "Too many requests. Try again shortly."}}`.
- **Headers:** only `cache-control: no-store` and `content-type`.
- **Not exposed:** no `Retry-After`, no `X-RateLimit-*`, no user id, no scope, and no 64-hex counter hash.
- **Logging:** none. Sentinels sent in the request body (e-mail etc.) do not appear in the response or in any output.
- **Retry information:** none exists. That reveals nothing, but clients cannot back off precisely. Adding `Retry-After` would expose only the window end, which can be derived from the clock anyway. Not proposed as a fix.
- **Accounting (`[rlx-invalid-consumes]`):**
  - Refused-origin (403) and anonymous (401) calls consume nothing.
  - Invalid bodies (400) do consume, because the limiter runs before parsing. This is deliberate: malformed floods are throttled too.
  - An invalid `[section]` is rejected before the limiter.

## 8. TTL and window lifecycle (`[rl-ttl]`, `[rl-ttl-deletion]`, `[rl-rollover]`)

- **TTL index:** `rate_limits_expiry` on `expiresAt` with `expireAfterSeconds: 0`.
- **Expiry time:** `expiresAt = windowStart + 2 × windowMs`. That is 2 min for the mutation policy and 2 h for the AI policy.
- **An expired counter is never consulted.** The window start is part of the key, so a new window creates a new key, even while an old exhausted counter physically remains. The test proves that a counter exhausted in window N does not limit window N+1.
- **Physical deletion:** the test lowers `ttlMonitorSleepSecs` to 1 s on the local test server only (restored afterwards). It inserts an already-expired counter and polls for up to 90 s until the TTL monitor removes it. It does not assume deletion at the exact expiry instant.
- **Recovery:** `rateLimits` is excluded from backups and restores (`recovery-envelope.ts`, `recovery-plan.ts`), so restored data never brings counters back.

## 9. Findings (open; reported, not remediated)

Severity is the reviewer's estimate for a single-owner G1 deployment. None was exploited outside the local machine.

| ID | Finding | Evidence | Impact | Narrow fix (proposal only) |
|---|---|---|---|---|
| **F-18-05-01** | AI report summaries are budgeted as generic mutations (30/min, i.e. ≈1,800 Anthropic calls/user/hour) instead of the AI policy (10/h). The version check is read-only and happens before the paid call, so: (a) N concurrent requests each pay the provider, and N−1 then fail with **500** on the unique version index; (b) replaying a key at the current version pays again and returns the stored row; (c) after the latest summary is soft-deleted, every regeneration pays and then fails with **500**, because the deleted row keeps its version slot while the check ignores it | `report-summaries/route.ts:13`; `report-summary-service.ts:45-54`; `report-summary-repository.ts:34,39-41,45,52`. Reproduced with a counting stub: `[rlx-summary-provider-budget]` (30 calls/min, 5/5 concurrent calls paid, statuses 201+4×500, no `ai-copilot` key) and `[rlx-summary-replay-and-delete]` (replay paid; 3 paid 500s after delete) | **High:** paid provider spend and 500s; bounded only by `OPERATIONS_DISABLE_AI` | Also consume the AI policy on this route. Look up the idempotency key before calling the provider. Compute the next version over all rows, including deleted ones |
| **F-18-05-02** | Paid open-banking refresh: each new idempotency key triggers a paid `refreshConnections` (≈20 credits). There is no cooldown, and `recordRefresh` is audit-only | `open-banking-service.ts:422-436`; `open-banking-repository.ts:463-500,796-809`; `[rlx-refresh-no-cooldown]` (5 keys → 5 paid calls) | **Medium-High:** up to 1,800 refreshes/h (≈36,000 credits). Binding owner only | A per-binding cooldown from the last `refresh_requested`, or a dedicated low budget |
| **F-18-05-03** | Fixed window allows up to 2× the limit across a boundary | `[rl-rollover]` (60 granted in 1 ms) | Low: doubles every burst bound above | Sliding or two-window weighting, if wanted |
| **F-18-05-04** | 68 per-scope budgets (sections templated) and no per-user aggregate cap | `rate-limit-matrix.ts`; `[rl-sequential]` (another scope = new budget) | Medium: ≈2,040 writes/min/user; onboarding and financial-data sections write the same collections (60/min each) | A per-user global write budget in addition to scopes |
| **F-18-05-05** | Expensive reads are unthrottled: GET reports/search/households/report-summaries/reports/[id]; pages dashboard, purchase-simulation, budgets, households, reports | §3 table; Appendix A (file:line) | Medium: one session can drive ~100k-document renders or ≤51 household-center loads per request, repeatedly. Database/CPU exhaustion, with no provider spend | A read budget for the heavy GETs and page loaders (not added: Owner decision) |
| **F-18-05-06** | No anonymous, IP or global key, and open sign-in: each Google account is a fresh budget | `auth/config.ts:22-37`; no x-forwarded-for in `src/` | Medium: multiplies every per-user bound by the number of accounts | A sign-in allowlist (G1) and/or an edge/IP limit |
| **F-18-05-07** | `createIndex` runs on every request in every repository getter, including the limiter's `ensureIndexes()` on refused requests. Up to ~50 per page | `rate-limiter.ts:85-93`; `manual-record-repository.ts:540-549`; `household-repository.ts:1047-1050` | Low-Medium: extra round trips per request; a 429 still costs a createIndex + findOneAndUpdate | Memoise index creation per process, or move it to the deploy-time `ensureApplicationIndexes` |
| **F-18-05-08** | Auth.js endpoints and the sign-in server action are unthrottled. Every anonymous sign-in POST makes an uncached OIDC discovery fetch to Google; the callback makes a token request | `@auth/core` 0.41.3 `lib/actions/signin/authorization-url.js:14-22`, `providers/google.js:109-118`; `sign-in/page.tsx:8-20` | Medium: anonymous outbound-request amplification and function invocations | An edge/IP limit in front of `/api/auth/*` and the sign-in action, or a static authorization endpoint configuration |
| **F-18-05-09** | Notification evaluation: up to 20 Resend sends + 50 `getDeliveryStatus` GETs per request. `OPERATIONS_DISABLE_EMAIL` stops sends but not the status reads | `notification-service.ts:43,175-220`; `notification-repository.ts:366-367` | Medium: up to ≈90,000 Resend GETs/user/hour | Gate status refresh with the kill switch; throttle the status refresh separately |
| **F-18-05-10** | Open-banking claim calls Financy `listConnections` before any binding check (any user). Sync calls it before the idempotency check (a completed replay still pays), makes ≤41 logical calls (≤~164 with retries) and has no kill switch | `open-banking-service.ts:225,236,252-271,301,342`; `financy-open-banking-provider.ts:303-336` | Medium: ≈73,800 logical Financy calls/h per bound user; claim reachable by any account | Check binding/idempotency first; extend the kill switch to sync |
| **F-18-05-11** | The search rebuild loads ≈52,650 documents before its 15,000 cap. `deleteMany` + `insertMany` has no transaction, so concurrent rebuilds fail with 500 and leave a partial or empty index | `search-service.ts:38-61`; `search-repository.ts:38-51` | Low-Medium: heavy work at 30/min; a stale or empty index until the next rebuild | Count before loading; replace-by-version or a transaction |
| **F-18-05-12** | `calendarMonthSchema` accepts years 1000-9999. A weekly recurring record with a month ≈190+ years out makes recurrence expansion throw `RangeError` after 10,001 iterations. `PUT budgets/periods` saves the period first and then returns **500**; the budgets page renders the error view. Months just inside the cap cost ~10k iterations per record on an unthrottled page | `budget.ts:40-42`; `financial-schedule.ts:80-97`; `budget-service.ts:640-654`. Reproduced: `[rlx-budget-far-month]` (period for 2300-01 persisted, 500, one literal log line) | Medium: a persisted unusable period, 500s and CPU amplification | Bound the month to a sane range (e.g. ±100 years), or validate before persisting |
| **F-18-05-13** | No index on `authSessions.sessionToken` (or `authAccounts` provider keys) is created by the app or the deploy-time index set. Every `auth()`, including one carrying a random cookie, may scan the session collection. Production index state is **unverified** (it needs a read-only Atlas check, which this row did not do) | `@auth/mongodb-adapter` 3.11.3 `index.js:303-307`; `operations/application-indexes.ts:30-43`; `auth/persistence.ts:3-8` | Medium if absent in Atlas: anonymous, unthrottled, O(sessions) per request | Add the adapter's unique indexes to `ensureApplicationIndexes` after an Owner-approved Atlas check |

## 10. Residual work to close 18-05

1. An Owner decision on each finding F-18-05-01..13 (remediate / accept / defer), and approval of any narrow fix as separate work.
2. A read-only Atlas check of the existing `authSessions` / `authAccounts` indexes (F-18-05-13). This needs Owner-approved read access.
3. Owner adoption (or revision) of `PHASE_18_RATE_LIMIT_THRESHOLDS_DRAFT.md`.
4. Deployed evidence, after S10 and only with Owner approval:
   - the limiter on the deployed function topology (multiple concurrent Vercel instances against Atlas);
   - 429 behaviour and headers through Vercel;
   - Auth.js/ingress flood behaviour;
   - measured latency and RU of the limiter and the heavy GETs against Atlas.
5. An edge/ingress decision: Vercel firewall/WAF or none (F-06/F-08). This is an architecture and tier decision for the Owner.
6. Re-run of this inventory after any remediation, so the matrix records the new policies.

## 11. Mutation evidence (temporary probes, all restored)

Each probe edited one file (or created one), ran the named tests against loopback MongoDB, then restored the exact bytes; a SHA-256 check confirmed each restore. Nothing was committed, and the working tree was identical before and after.

**Result: 57/57 DETECTED.** RL01–RL31 were run before the independent review; RL32–RL48 are the round-1 survivors; RL49–RL57 are the round-2 bypasses. The whole campaign was re-run after each round of fixes. In the last run RL54 and RL56 first SURVIVED: the non-call reference check had skipped every identifier whose parent was a declaration, including the declaration's initializer. The check was narrowed to the declared name only, and both were then DETECTED. That change only adds violations, so the other 55 detections are unaffected.

| Probe | Mutation | Detected by |
|---|---|---|
| RL01 | `count > limit` → `>=` (off by one) | `[rl-sequential]`, `[rl-concurrent-*]` |
| RL02 | `upsert: false` | `[rl-sequential]`, `[rl-concurrent-*]` |
| RL03 | `returnDocument: "before"` | `[rl-sequential]`, `[rl-concurrent-boundary]`, `[rl-key-derivation]` |
| RL04 | TTL `expireAfterSeconds` 0 → 3600 | `[rl-ttl]`, `[rl-ttl-deletion]` |
| RL05 | `expiresAt` = start + 1 window | `[rl-ttl]` |
| RL06 | Key without window start | `[rl-rollover]`, `[rl-key-derivation]`, `[rl-ttl]` |
| RL07 | Raw user id in key | `[rl-key-derivation]` |
| RL08 | Fail-open: store errors swallowed as count 0 | `[rl-failure-modes]` |
| RL09 | Null result treated as a grant | `[rl-failure-modes]` |
| RL10 | Key without scope | `[rl-sequential]`, `[rl-concurrent-*]`, `[rl-rollover]` |
| RL11 | AI limit 10 → 100 | `[rlx-policies]` |
| RL12 | Mutation limit 30 → 60 | `[rlx-429-safe]`, `[rlx-invalid-consumes]`, `[rlx-summary-provider-budget]` |
| RL13 | AI window 1 h → 1 min | `[rlx-policies]` |
| RL14 | Limiter removed from PUT profile | Inventory: exact limiter pin |
| RL15 | Scope `report-export` renamed | Inventory: exact limiter pin |
| RL16 | Limiter added to GET search (a `none` entry) | Inventory: exact limiter pin |
| RL17 | Limiter moved after body parsing (refresh) | Inventory: ordering |
| RL18 | Origin check removed (refresh) | Inventory: ordering |
| RL19 | Limiter call added to a page | Inventory: no unrouted limiter |
| RL20 | New unclassified route file | Inventory: universe |
| RL21 | Second (AI) limiter added to report summaries without updating the matrix | Inventory: pin + exactly one limiter |
| RL22 | `none` rationale replaced by "n/a" | Inventory: explicit `none` |
| RL23 | Finding removed from heavy `none` GET reports | Inventory: explicit `none` |
| RL24 | Matrix entry renamed (stale/missing) | Inventory: universe |
| RL25 | Health identity changed to actor | Inventory: identity |
| RL26 | Limited route reclassified as `none` | Inventory: exact limiter pin |
| RL27 | `Retry-After` header added | `[rlx-429-safe]` |
| RL28 | 429 logged | `[rlx-429-safe]` |
| RL29 | 429 message changed | `[rlx-429-safe]` |
| RL30 | `it.skip` on `[rl-distributed]`, full enforced run | Required-tests reporter |
| RL31 | `it.skip` on an inventory test, full enforced run | Required-tests reporter (module count) |
| RL32 | Limiter made conditional (`if (Date.now() < 0) await …`) on PUT profile | Inventory: structure |
| RL33 | `void` limiter call (not awaited, error swallowed) | Inventory: structure |
| RL34 | `await limiter(…).catch(() => undefined)` | Inventory: structure |
| RL35 | Import replaced by a local no-op function with the same name (shadowing) | Inventory: limiter-module references |
| RL36 | Limiter re-keyed with a random user id per request | Inventory: structure (not keyed on the actor) |
| RL37 | Limiter wrapped in a never-called closure | Inventory: structure |
| RL38 | Early `return` before the limiter | Inventory: structure (exit path before the limiter) |
| RL39 | Same-file helper whose argument reads the body before the limiter | Inventory: unrouted, ordering |
| RL40 | Aliased limiter import used in a page | Inventory: limiter-module references |
| RL41 | Namespace import (`* as rl`) used in GET search | Inventory: limiter-module references |
| RL42 | Dynamic import + `rateLimiterForDatabase(...).consume` in GET search | Inventory: limiter-module references |
| RL43 | New library file with an aliased limiter call | Inventory: limiter-module references |
| RL44 | Inline one-line `"use server"` action in a page | Inventory: server-action universe (AST) |
| RL45 | As RL32, behavioural layer only | `[rlx-route-sweep]` |
| RL46 | As RL33, behavioural layer only | `[rlx-route-sweep]` |
| RL47 | As RL35, behavioural layer only | `[rlx-route-sweep]` |
| RL48 | As RL36, behavioural layer only | `[rlx-route-sweep]` |
| RL49 | Header-gated unthrottled write placed before an unchanged limiter (N1) | Inventory: pre-limiter allowlist |
| RL50 | Heavy export built before the limiter (N1b) | Inventory: pre-limiter allowlist |
| RL51 | `let actor` re-keyed with a random user id (N2) | Inventory: pre-limiter allowlist / `const` actor |
| RL52 | `catch` turns a 429 into 200 (N3) | Inventory: `catch` shape |
| RL53 | Non-literal `import("…rate-" + "limiter")` with an aliased call (N6) | Inventory: non-literal module path |
| RL54 | `export const limiterFor = rateLimiterForDatabase` (N7) | Inventory: non-call reference |
| RL55 | Parenthesised callee `await (consumeMutationRateLimit)(…)` on a `none` route (N8) | Inventory: non-call reference |
| RL56 | `const c = consumeMutationRateLimit; await c(…)` (N8b) | Inventory: non-call reference |
| RL57 | `resolveSection` stops validating `[section]` (N9) | `[rlx-route-sweep]` (invalid section reaches the limiter) |

**Full enforced suite:** `REQUIRE_SECURITY_TESTS=1`, with both local MongoDB servers. After the round-1 and round-2 fixes, 161 files passed and 7 skipped; 856 tests passed and 15 skipped. The marker reported `ok: true` with 70 required ids, up from 51. Before the fixes: 854 tests passed, with 69 required ids.

## 12. Independent adversarial review

### Round 1 (at `cc0ce27`)

**Verdict:** no blocker. The reviewer confirmed:
- the constraints: the diff touches only `tests/` and `*.md`, nothing was remediated, the draft is not adopted, and S10 was not touched;
- every count;
- the concurrency evidence;
- the 429 safety assertions;
- the reporter change;
- findings F-01, F-02, F-10, F-11 and F-12 against the code.

| Finding | Severity | Resolution |
|---|---|---|
| M1: CI checked that a limiter call was *present*, not that it took effect. Conditional, unawaited, swallowed, shadowed, re-keyed, deferred and early-return variants all passed | Medium | Fixed with two layers. **Structural:** the limiter must be awaited directly in the handler (or its top-level `try`), keyed on the `await requireActor()` identifier, with no return/throw path before it. **Behavioural:** `[rlx-route-sweep]` drives all 59 limited methods with a recording, refusing limiter and asserts 429, exact scope, the actor's key, and no write. RL32–RL38 and RL45–RL48 are detected |
| M2: limiters called under an alias, through a namespace or dynamic import, or directly through `rateLimiterForDatabase(...).consume` were invisible | Medium | Fixed. Every reference to the limiter module in `src/` is pinned: only the two named wrappers, only in limited route files, plus the deploy-time `application-indexes.ts` use of `rateLimiterForDatabase`. Shadowing declarations fail, and the module's export list is pinned. RL40–RL43 are detected |
| M3: an inline one-line `"use server"` action escaped the action inventory (18-14 uses a line-start regex) | Medium-Low | Fixed in 18-05. The `"use server"` prologue is detected with the AST (file or any function body) and must equal the 18-14 `serverActionMatrix`. RL44 is detected. The 18-14 regex itself is unchanged; the stricter check sits beside it |
| L1: arguments were walked after the call, and a helper was counted once | Low | Fixed: arguments are walked before the call, and every helper call is counted, with a recursion guard. RL39 is detected |
| L2: failure-mode wording went further than the evidence (stubbed timeout; warm vs cold outage; the wrapper is replaced in `[rlx-store-failure]`) | Low | §5 reworded with the limitations stated. The hung-server observation is recorded |
| L3: `[rlx-summary-provider-budget]` asserted one race outcome | Low (flake) | Fixed: a barrier in the provider stub holds all 5 requests at the provider (10 s guard), so all 5 calls and 201 + 4×500 are deterministic |
| L4: the 18-05 page universe diverged from 18-14's special-file list | Low | Fixed: the 18-05 page universe is the 18-14 `pageMatrix`, which 18-14 pins to every special file on disk |
| Info: test counts in §1, the authjs keys, the weak provider-rationale check, and "done" wording in the acceptance package | Info | §1 counts corrected. The authjs keys are pinned to exactly the two Auth.js methods. A provider-backed generic-budget route needs a finding or a rationale of at least 40 characters. The acceptance package now says "pending Owner acceptance" |

### Round 2 (at `96153b8`)

**Verdict:** no blocker. All round-1 survivors (A–S2, H) were re-run and are now caught by at least one layer. The reviewer also confirmed:
- 70 required ids;
- the sweep fails on any non-429 status;
- barrier determinism, and 3 clean repeat runs;
- §1 and §11 accurate.

| Finding | Severity | Resolution |
|---|---|---|
| R2-1: work could run *before* the limiter. N1 performed a header-gated unthrottled write before an unchanged limiter; N1b built the heavy export first. The structural check only rejected return/throw | Medium | Fixed: only an allowlist of statements may precede the limiter (`assertTrustedMutationOrigin(request);`, `const actor = await requireActor();`, `const section = await resolveSection(context);`). The actor binding must be `const`. The sweep also asserts that an invalid `[section]` never reaches the limiter. N1 = RL49, N1b = RL50, N2 = RL51, N9 = RL57 |
| R2-2: a hidden limiter in a file that already imports it (parenthesised callee, `const c = consume`) could over-limit a `none` route | Low | Fixed: every identifier reference to a limiter-module name must be the direct callee of a call. RL55 and RL56 |
| R2-3: deliberate evasions: a `catch` turning a 429 into success, a non-literal `import()` path, a re-exported `rateLimiterForDatabase` | Low/Info | Fixed: the handler's `catch` must be exactly `return errorResponse(error)`; non-literal `import()`/`require()` is flagged; non-call references are flagged. RL52, RL53, RL54. Code that detects the test environment, and limiters that bypass the module, stay out of reach (stated in §1) |
| Info: barrier not reset if the burst throws; §5 authentication order | Info | The barrier is reset in `finally`. §5 now says that authentication reads MongoDB before the limiter |

## Appendix A. Cost evidence for unthrottled reads (file:line, read-only study)

- **Anonymous cost before any page work:**
  - No session cookie: no query.
  - Forged cookie: one `authSessions.findOne` (`@auth/mongodb-adapter` `index.js:307`).
  - Valid session: + `authUsers.findOne`; then the profile (`profile-repository.ts:118-124`).
  - `[section]` pages and routes validate the section before `auth()`.
- **Dashboard** (`dashboard/page.tsx:128-140` → `dashboard-service.ts:176-210` → `financial-engine-snapshot-freshness.ts:67-111`):
  - goals via `listAllForActor` (≤10,001; `manual-record-repository.ts:317-336`);
  - 9 sections × `listAllForActor` (≤10,001 each; `financial-engine-input.ts:26-36`);
  - ~40 createIndex.
- **Purchase simulation** (`purchase-simulation-service.ts:254-285`): the same freshness check, plus `findLatestForActorWithMinimumHorizon` on `result.horizonDays`, which has no matching index (`engine-snapshot-repository.ts:285-292`, indexes 107-125).
- **Budgets:**
  - `budget-service.ts:182-193,276-390,413-435` (5 whole-section loads; recurrence expansion);
  - `budget-repository.ts:760-782` (corrections `$in` ≤10,000 ids);
  - `budget.ts:40-42` (`?month` years 1000-9999).
- **Household center** (`household-service.ts:576-666`):
  - memberships and households ≤51 each (`household-repository.ts:417-439`);
  - per-household principal and memberships (`household-service.ts:113-128`);
  - shares ≤501 (`household-repository.ts:1000-1013`);
  - sequential shared projection (`household-service.ts:236-310`);
  - invitation expiry writes (`household-repository.ts:708-743`).
- **Reports:**
  - `report-service.ts:59-100` (current report, `REPORT_MAX_SOURCE_RECORDS = 10_000` at `report.ts:10`);
  - `report-service.ts:130-150` (saved reports ≤50, `report-repository.ts:144-145`, with a sequential household center for each household report).
- **Search:**
  - `search-service.ts:66-92` (≤100 candidates validated in parallel; `SEARCH_MAX_RESULTS = 100` at `search.ts:7`);
  - `validateCandidate` reloads the notification center or saved report per hit.
- **Net worth** (`net-worth-service.ts:62-69,235-267`):
  - `repositories()` is built twice (~48 createIndex);
  - goal definitions ≤5,001 (`goal-repository.ts:306-316`).
- **Progress** (`progress-journey-service.ts:40-51,223-236`): events ≤5,001 (`progress-journey-repository.ts:150-154`).
- **Open banking center:**
  - `open-banking-service.ts:400-415` (no Financy call on GET);
  - `open-banking-repository.ts:811+` (unbounded connection list; revisions ≤2,000).
- **Pages that only look expensive:**
  - reconciliation page: session + profile only (`open-banking/reconciliation/page.tsx:14-18`);
  - copilot, forecasts, notifications: no provider or computation on render.
