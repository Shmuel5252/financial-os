# Financial OS Progress

## Phase 16 — Reviews, Reports, Export, and Search

**Status:** Complete — all Phase 16 acceptance criteria objectively verified and self-accepted under the owner-approved execution-order exception. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-02

**Verified:** 2026-09-02

**Scope boundary:** Deterministic current/closed/restated monthly and yearly reports, subscriptions, authorized personal/household scope, versioned CSV/JSON exports, bounded reauthorized MongoDB search, and minimized optional AI report summaries only. No PDF, external search provider, Open Banking, implicit FX, AI-calculated totals, or canonical financial mutation.

### Implemented

- The repository began clean and synchronized at accepted Phase 15 commit `07f54c7a10a697a80fa96e72668d817e66d57ca0`; `.env.local` is ignored and untracked.
- The complete owner attachment, Master Plan, architecture, decision log, implementation plan, and progress history were reread before changes.
- Both synchronized Master Plan copies, ADR-054 through ADR-056, architecture, and the implementation plan record immutable close/restatement semantics, explicit scope, currency separation, export contracts, AI authority/retention, search reauthorization/freshness, pagination, deletion, performance targets, and Phase 9 exclusion before code relies on them.
- Added pure, versioned monthly/yearly report projection over explicit profile-timezone periods and explicit personal or currently authorized household scope. Cash flow, refunds, category spending, accounts, budgets, debts, goals, net worth, savings, and subscription signals retain exact integer-minor-unit values, currency separation, source revisions, opaque provenance aliases, deterministic order, and a reproducible SHA-256 source fingerprint; transfers do not distort operating cash flow and no implicit FX exists.
- Added immutable owner-scoped `financialReports` checkpoints. Closing stores the complete bounded report, period/scope, source evidence, currency groups, engine/policy versions, and audit identity. Later source corrections change current truth only; explicit restatement appends a linked version and preserves the original. User-visible removal is an audited visibility change and never mutates canonical finance.
- Added authenticated, no-store current/close/restatement/read/hide and export routes with server-derived actors, trusted-origin mutation checks, bounded inputs, optimistic versions, stable idempotency payloads, owner-first indexes, and current household-share fingerprint reauthorization. Revoking a shared source immediately denies a previously closed household report even before physical derived cleanup.
- Added versioned UTF-8 CSV and structured JSON exports. CSV has stable ASCII columns, a BOM for Hebrew interoperability, exact base-10 minor-unit strings, explicit currency and ISO time metadata, deterministic row order, streaming output, and server-side spreadsheet-formula neutralization. Public JSON and CSV omit owner/auth/provider/internal source identifiers; closed exports use the stored checkpoint rather than mutable current data.
- Added provider-neutral `authorizedSearchDocuments` with owner-first MongoDB indexes, normalized Hebrew/Latin prefix tokens, bounded query-bound cursors, source/index timestamps and versions, explicit rebuild, canonical query-time reauthorization, stale-result disclosure, and immediate denial after deletion/unsharing. Search covers transactions/descriptions/categories, accounts, goals, debts, savings assets, notifications, closed reports, and saved report summaries; household search is assembled only from the live Phase 11 shared projection.
- Added the optional report-summary path downstream of deterministic truth: at most 32 derived aliased facts enter the existing server-only provider abstraction; raw transactions, complete profiles, internal IDs, hidden prompts, and unrelated text do not. Schema/evidence validation prevents unsupported conclusions. `reportAiSummaries` stores only safe structured Hebrew output, source fingerprint/version, model/provider metadata, usage, and policy version; regeneration appends a version and deletion cannot affect report or financial truth.
- Added protected Hebrew/RTL `/reports`, dashboard navigation, monthly/yearly and personal/household controls, separate-currency sections, current/closed/restated states, CSV/JSON actions, authorized search, AI-authority disclosure, and LTR isolation for money, dates, versions, and identifiers. Browser verification found and fixed the period-kind control so selecting a year now changes the label, validation, and value before submission.

### Verification evidence

- The complete unit suite passed 42 files / 211 tests. The Phase 16 unit/UI coverage verifies month/leap-year/year boundaries, exact cash flow/refunds/categories, transfer exclusion, no FX, reproducibility/fingerprint sensitivity, CSV UTF-8/schema/exactness/injection protection, public JSON identifier removal, search token normalization, minimized AI evidence, Hebrew labels, LTR money isolation, and explicit yearly controls.
- The complete real-Mongo integration suite passed 17 files / 66 tests; four external-provider cases were intentionally skipped in that general run and executed separately. Phase 16 real-Mongo coverage verifies immutable report/restatement versions, BSON int64 exactness beyond JavaScript's safe integer range, owner/direct-ID denial, user-visible hide without evidence loss, summary ownership/delete, search owner separation/deletion freshness, and bounded 10,000-transaction performance. The Phase 11 regression additionally proves current-share reauthorization rejects a previously valid household report immediately after unsharing.
- The representative 10,000-transaction test passed its server-side p95 assertions: deterministic report generation remained below 2 seconds and ordinary owner-indexed search remained below 500 milliseconds across 20 measured iterations; result pages remained at or below 100 records.
- Real Anthropic regression passed 2 files / 2 live requests: the Phase 8 provider contract and the Phase 16 minimized report-summary contract both returned schema-validated Hebrew, evidence-cited output. Only synthetic deterministic acceptance facts were sent. The Phase 15 real Resend regression also passed 1 file / 2 live official test-mode requests, preserving the previously accepted provider path and truthful `sent` semantics.
- Authenticated production-browser acceptance used the retained real Google/Auth.js MongoDB session on the final optimized build at port 3001. It verified `lang=he`, document/computed RTL, LTR-isolated exact money, personal monthly reporting, explicit close plus linked restatement history, CSV download, multi-domain account/goal/debt search, and an authorized household yearly report containing no private or unshared resources. Captured browser warning/error output was empty. The browser did not invoke AI with real user data; the required real provider path was verified separately with minimized synthetic context.
- Type-check, zero-warning ESLint, two optimized Next.js production builds (including the browser-found yearly-control correction), `git diff --check`, real-Mongo integrity/isolation, registry-backed high-severity dependency audit, and server-only provider boundaries passed. The audit reported zero vulnerabilities. `.env.local` remained ignored/untracked and no secret value was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 16 is fully accepted under the autonomous progression rule. Every total remains traceable to authorized, versioned source evidence; report close/restatement history is immutable; exports reproduce the correct checkpoint with exact currency-separated money; search cannot expand current authorization; and Claude remains an optional explanation layer downstream of deterministic truth. Phase 9 remains visibly blocked and no provider provenance or bank synchronization was fabricated.

### Exact next gate

Phase 17 is next in roadmap order under the execution-order exception, but its roadmap explicitly requires a product/ethics review for restrained milestones, streaks, achievements, reversals, backfill, tone, and opt-out behavior. No approved Phase 17 policy currently resolves those material incentive-design decisions. Stop before Phase 17 code and request that policy; do not infer gamification rules that could pressure unsafe financial behavior.

## Phase 15 — Notifications

**Status:** Complete — all Phase 15 acceptance criteria objectively verified and accepted under the owner-approved autonomous progression rule. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-02

**Verified:** 2026-09-02

**Scope boundary:** Deterministic owner-scoped in-app alerts plus explicit-opt-in, generic privacy-minimized email through a server-only provider-neutral Resend adapter. Web Push, marketing, fabricated Open Banking events, detailed financial email, AI-originated alerts, and any canonical financial mutation are excluded.

### Implemented

- The repository began Phase 15 clean and synchronized at accepted Phase 14 commit `305a990a4dcaaae93b08b43fb40b50f6b6b6091c`. ADR-051 through ADR-053 and both synchronized Master Plan copies record the deterministic trigger/severity, owner evidence, consent, quiet-hour, idempotency, lifecycle, minimization, recipient-identity, and Phase 9 boundaries before implementation relies on them.
- Added versioned deterministic notification evaluation for confirmed forecast shortfall, Safety Margin crossing, material confirmed-obligation risk, budget deficit, deterministic goal milestones, and source freshness. Exact boundaries classify confirmed below-zero/uncovable obligations as critical, confirmed non-negative margin crossings as warning, and stale or milestone evidence as informational; AI and providers cannot originate or reclassify an alert.
- Added owner-scoped `notifications` and `notificationPreferences` repositories with owner-first indexes, optimistic versions, append-only lifecycle/preference audit, stable logical deduplication, 24-hour external cooldown, three-attempt retry state, revocation, and direct-ID owner filtering. Reads never create alerts and notification activity cannot mutate canonical financial truth.
- Added in-app delivery default-on and email default-off. Email requires explicit revocable consent; non-critical sends defer during deterministic 22:00–08:00 profile-timezone quiet hours, while only an objective confirmed-shortfall critical event bypasses. DST and exact boundary behavior are versioned and tested.
- Added a provider-neutral server-only email port and real Resend adapter. The delivery command is reconstructed from a fixed generic Hebrew template and authenticated application URL, recipient email derives server-side from the Auth.js user, retries reuse one idempotency key, telemetry excludes recipient/content/financial values, and provider acceptance remains `sent` until independent provider evidence establishes `delivered`.
- Added authenticated, trusted-origin, bounded, rate-limited, no-store APIs for center reads, explicit deterministic evaluation, read/dismiss, and preferences. Source loading tolerates only expected domain-unavailable projections and continues over other eligible sources; infrastructure failures remain visible.
- Added the protected Hebrew/RTL notification center and dashboard navigation with localized states, consent and quiet-hour controls, explicit privacy disclosure, LTR-isolated timestamps/hours, and a visible statement that Phase 9 provider alerts are unavailable. Financial-data export schema version 8 includes safe actor-owned views/preferences while excluding ownership/authentication/source/provider internals.
- Official Resend test mode operationally verifies the real provider path. Production delivery to arbitrary user addresses remains fail-closed until a verified sender domain and `RESEND_FROM_EMAIL` are configured; no production-domain readiness is claimed.

### Verification evidence

- Dedicated Phase 15 coverage passed 5 files / 20 tests: 12 pure/UI/provider tests, 6 real-Mongo notification tests, and 2 real-Resend acceptance tests. Coverage includes every severity boundary, exact zero/margin rules, insufficient/stale sources, stable fingerprints, DST/quiet hours, consent/revocation, logical/provider idempotency, retry and accepted-versus-delivered lifecycle, injection/minimization rejection, safe telemetry, canonical non-mutation, household/two-user/direct-ID isolation, partial source availability, and Phase 9 absence.
- The real Resend gate sent an official test-mode message through the adapter and a second message through the actual Financial OS service/repository path. Identical retries returned one provider message identity and one logical notification. No credential, recipient, financial value, or content entered telemetry. The configured send-scoped key did not authorize status reads, so acceptance is truthfully recorded as `sent`, not `delivered`.
- The complete final-state regression passed 58 files / 266 tests with `RUN_REAL_ANTHROPIC_TESTS=1`, `RUN_REAL_RESEND_TESTS=1`, one worker, real MongoDB, the real Anthropic provider, and the real Resend provider. A preceding Anthropic call received transient `PROVIDER_CAPACITY`; the unchanged focused retry and subsequent complete clean run passed, so no gate was bypassed or mocked.
- Authenticated production-browser acceptance used the retained real Google/Auth.js MongoDB session on port 3001. The Hebrew notification center rendered and reloaded with email opt-out, in-app and quiet-hours enabled, deterministic evaluation completed successfully despite an independently unavailable current budget projection, and no alert was fabricated because current evidence contained no eligible condition.
- Browser checks passed at 375x812 with `lang=he`, `dir=rtl`, computed RTL, two LTR isolates, one main/heading landmark, no horizontal overflow, the privacy/Phase 9 disclosures visible, and no console warning/error logs. Preference consent was not changed and no personal-address email was sent during browser verification.
- Read-only production MongoDB checks confirmed active Auth.js session evidence, four notification owner-first indexes plus the owner-first unique preference index, safe sampled fields, zero Phase 9 provider collections, and no fabricated notification/preference records. The dedicated isolated-database tests verified BSON ownership, concurrency, mutation denial, and lifecycle persistence.
- Type-check, zero-warning ESLint, optimized Next.js build, `git diff --check`, synchronized Master Plan hashes, ignored/untracked `.env.local`, tracked-file secret review, and the registry-backed high-severity audit passed; the audit reported zero vulnerabilities. No secret value was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 15 is fully accepted under the autonomous progression rule. Every notification traces to deterministic actor-owned evidence; delivery is consented, minimized, idempotent, lifecycle-truthful, and unable to alter financial truth. The operational real Resend test-mode path is verified, while arbitrary production-address delivery remains explicitly qualified. Phase 9 remains visibly blocked and unaccepted.

### Exact next gate

Phase 16 is next under the approved execution-order exception. Its current roadmap scope does not define the material review-finalization, report-period/versioning, search-index freshness/authorization, export-format/CSV, AI-summary persistence, or target-volume/performance policies needed to implement and objectively accept reports and global search. Phase 16 remains unstarted pending those owner product/security decisions; no Phase 16 code is included in the Phase 15 acceptance.

## Phase 14 — Savings, Assets, and Net Worth

**Status:** Complete — all Phase 14 acceptance criteria objectively verified and accepted under the owner-approved execution-order exception. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-02

**Verified:** 2026-09-02

**Scope boundary:** Deterministic provider-neutral current net worth by currency, explicit asset/liability valuation evidence, canonical double-count prevention, source-specific freshness, immutable snapshots/history, goal-reference projection without duplicated value, and authenticated Hebrew/RTL presentation only. No implicit FX, live market/brokerage/bank provenance, scenario valuation, canonical payment mutation, or AI-calculated value.

### Implemented

- The complete attached Phase 14 policy, both synchronized Master Plan copies, architecture, decision log, implementation plan, and progress history were read before implementation changes.
- The working tree began clean and synchronized at accepted Phase 13 commit `71b8b57f767570015554eb3bf94a52432e2335c5`.
- ADR-049/050 record the exact valuation aggregation, source/type freshness, liability priority, immutable snapshot, deletion/correction, household isolation, provider-neutral, and AI-authority decisions. No unresolved product or security gate remains for the bounded Phase 14 implementation.
- Added pure versioned `net-worth/1.0.0` aggregation over actor-owned accounts, detailed savings, loans, cards, and explicit `netWorthItems`. Exact assets, liabilities, net worth, cash, and non-cash assets remain grouped by currency. Negative accounts become overdraft liabilities; future-effective evidence is excluded; stale evidence remains visible; and no implicit FX exists.
- Added explicit canonical aggregation relationships for standalone assets, parent-account versus holding authority, and higher-quality loan/card evidence. Detailed savings replace account fallback, goal references add no value, and fresh settlement/outstanding/derived/user-reported liability evidence follows the approved deterministic priority without inventing payoff charges.
- Added deterministic `net-worth-freshness-v1` source/type thresholds in the profile IANA timezone, explicit provenance and source revisions, stable input/state fingerprints, and precise inclusion/exclusion reason evidence.
- Added audited, optimistic-versioned, soft-deletable `netWorthItems` and append-only `netWorthSnapshots`. Current mutations may produce at most one automatic material-change snapshot per actor/calendar day; explicit identical-state retries are idempotent; page reads never write; and historical copies retain complete exact evidence after current correction/deletion.
- Added trusted-origin, bounded-body, rate-limited, no-store APIs and protected Hebrew/RTL `/net-worth`. The current statement, valuation freshness, included/excluded evidence, non-cash warning, explicit capture, synthetic asset form, immutable per-currency history chart, and savings-goal references are localized with LTR isolation for exact money, dates, currencies, and versions.
- Financial-data export schema version 7 includes bounded actor-owned net-worth items and snapshots while omitting internal ownership/authentication fields. Dashboard and debt-strategy navigation expose the center without unrelated visual redesign.
- Phase 9 remains blocked; no Open Banking, market-data, brokerage, FX, payment, canonical transaction, budget, Safe to Spend, or verified-goal mutation was introduced.

### Verification evidence

- Dedicated Phase 14 unit/UI/real-Mongo coverage passed 3 files / 19 tests. It covers sign/classification, exact currency grouping, market-versus-cash separation, every source/type freshness threshold, future/stale evidence, savings/account/holding/goal/card/debt deduplication, liability priority, no implicit FX, bigint/BSON int64 boundaries, deterministic reproduction, snapshot daily/idempotency/immutability, correction/deletion history, export, canonical non-mutation, and actor/household/two-user denial.
- The complete final-state regression with `RUN_REAL_ANTHROPIC_TESTS=1` passed 53 files / 245 tests using one worker. Real MongoDB and the real Anthropic provider regression gate passed without mocks or skipped acceptance checks.
- Authenticated production-browser acceptance on port 3001 used the retained real Google/Auth.js MongoDB session. It loaded the Hebrew net-worth center, added one clearly labelled synthetic `123.45 ILS` unrealized-market asset, classified it as non-cash, generated one material-change snapshot, deduplicated an explicit same-state capture, and retained current/history state after reload.
- Browser checks passed with `lang=he`, `dir=rtl`, computed RTL, 26 explicit LTR isolates after reload, one history SVG, no horizontal overflow, and no browser warning/error logs.
- Read-only real-Mongo acceptance confirmed the synthetic current item belongs to an owner with an active Auth.js database session, exact money is stored as BSON `int64`, the owner-scoped immutable snapshot exists with a valid SHA-256 state fingerprint, the automatic snapshot is unique for the state/day, and Phase 9 `bankConnections` remain absent.
- Type-check, zero-warning ESLint, optimized Next.js production build, `git diff --check`, synchronized Master Plan hashes, ignored/untracked `.env.local`, isolated port-3001 production runtime, and the registry-backed high-severity audit passed; the audit reported zero vulnerabilities. No secret value was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 14 is fully accepted under the autonomous progression rule. Present and historical net worth are exact, currency-separated, provenance/freshness-qualified, canonically deduplicated, immutable where required, owner-isolated, provider-neutral, and independent of AI authority. Phase 9 remains visibly blocked and unaccepted.

### Exact next gate

Phase 15 is next in roadmap order, but implementation has not begun. Its definition of done requires in-app delivery plus at least one operationally verified real email or push channel. The source of truth does not yet select that external channel/provider or define its concrete preference, quiet-hour, and delivery policy; those decisions and matching provider access are a genuine gate before Phase 15 code changes.

## Phase 13 — Debt Strategies

**Status:** Complete — all Phase 13 acceptance criteria objectively verified and accepted under the owner-approved autonomous progression rule. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-01

**Verified:** 2026-09-02

**Scope boundary:** Deterministic provider-neutral debt-term assessment, exact amortization schedules, baseline/Avalanche/Snowball/custom comparisons, explicit extra-payment budgets, immutable optional saves, and authenticated Hebrew/RTL presentation only. No lender/Open Banking sync, payment execution, canonical debt mutation, AI calculation, Phase 14 asset/net-worth work, or fabricated provider provenance.

### Implemented

- The complete attachment, synchronized Master Plan, architecture, decision log, implementation plan, and progress record were reread before changes. The working tree began clean and synchronized at accepted Phase 12 commit `8e582c16b9c853ceeb57ddd9ca535408f66a14b5`.
- Contract/evidence-first terms, explicit completeness states, no hidden day-count/compounding/allocation/minimum/rate/fee/prepayment defaults, deterministic baseline/Avalanche/Snowball/custom rules, explicit extra budget, strict truth/scenario/AI separation, actor-only household privacy, immutable reproducibility, provider-neutral manual operation, and the full verification matrix are recorded in both synchronized Master Plan copies, ADR-047/048, architecture, and the implementation plan before engine implementation.
- Added pure versioned `debt-strategy/1.0.0` calculation over explicit owned debt revisions. Supported evidence includes no-interest, fixed and known effective-dated variable rates; monthly, Actual/365, and Actual/360 accrual; payment-date or period-start rate application; exact fixed/formula minimums; provenance-bearing allocation order; known fees; and explicit free/fixed/percentage prepayment terms. Unknown material terms remain `insufficient_information`; explicit assumptions remain `assumption_based`; only sufficient evidenced terms are `verified`.
- Added exact baseline, Avalanche, Snowball, and explicit custom-priority schedules with one same-currency monthly extra-payment budget. Required minimums run before extra allocation, globally ordered calendar events prevent anchor-date inversion, half-even rounding is used for fractional minor units, dated fees/rates remain auditable, and exact current monthly debt load, payoff dates/order, interest, fees, repayment, time/cost comparison, exclusions, and bounded UI timelines are exposed.
- Added ephemeral authenticated evaluation and explicit append-only `debtStrategyScenarios` saves. Each record preserves current owned loan ID/version, explicit terms/provenance, exact BSON `Long` input/result money, engine/policy versions, full schedule, audit event, idempotency hash, and optional user name/note. Save revalidates every owner/version reference and the financial-data export schema now includes actor-scoped debt-strategy evidence.
- Added trusted-origin, bounded-body, rate-limited, no-store APIs plus protected `/debt-strategies`. Natural Hebrew copy distinguishes contractual evidence, user reports, assumptions, incomplete terms, non-comparable Avalanche cost claims, and hypothetical/non-mutating saves; dates, money, engine versions, and technical values use LTR isolation. Dashboard navigation exposes the page without an unrelated visual redesign.
- Phase 9 remains blocked and no Open Banking/lender collection, sync state, external identifier, or provider provenance was introduced. Manual `loans` remain canonical and provider-neutral.

### Verification evidence

- Dedicated Phase 13 unit/UI/real-Mongo coverage passed 3 files / 23 tests. It covers verified/assumption/incomplete boundaries, fixed/effective-dated variable and negative rates, all three approved accrual conventions, explicit rate-application compatibility, stable same-day ordering, payment allocation, minimum rules, known/unknown fees and prepayment, all four strategies, global event chronology, exact half-even rounding, ISO currency precision, no implicit FX, partial-result honesty, AI independence, owner/household/two-user denial, stale-revision conflict, idempotency, BSON int64, exportable immutable evidence, and canonical non-mutation.
- Every schedule test reconciles principal + interest + fees before payment against the exact component balances after payment, proves payment sums equal total repayment, and proves fully paid schedules end at exact zero. Identical input reproduction passed.
- The complete final-state regression with `RUN_REAL_ANTHROPIC_TESTS=1` passed 50 files / 226 tests using one worker. Real MongoDB and the real Anthropic provider path passed; no mock substituted either required boundary.
- Authenticated production-browser acceptance on port 3001 used the retained real Google/Auth.js MongoDB session. It evaluated a real owned synthetic loan using explicit contract provenance, a `250.00 ILS` extra budget and verified terms, displayed exact baseline/Avalanche/Snowball/custom results, saved one immutable Hebrew-named scenario, and loaded it after reload. The page passed `lang=he`, `dir=rtl`, computed RTL, four LTR isolates in the reloaded compact state, one `main`, one `h1`, no horizontal overflow, no visible internal IDs, and no browser warning/error logs.
- Read-only real-Mongo acceptance confirmed the saved scenario owner matched an active `authSessions` database session, the referenced live loan owner/version matched, exact extra-payment/balance/repayment fields remained BSON `Long`, the loan predates and was not rewritten by the save, the append-only audit action is `saved`, and Phase 9 collections remain absent.
- Type-check, zero-warning ESLint, optimized Next.js production build, `git diff --check`, synchronized Master Plan hashes, ignored/untracked `.env.local`, isolated ports 3000/3001, and the registry-backed high-severity audit passed; the audit reported zero vulnerabilities. No secret value was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 13 is fully accepted under the autonomous progression rule. Debt schedules are exact, explainable, reproducible, contract/evidence qualified, owner-isolated, and non-mutating. Phase 9 remains visibly blocked and unaccepted.

### Exact next gate

Phase 14 is the next architecturally independent roadmap phase under the execution-order exception. No Phase 14 implementation has begun in this commit; its scope and any unresolved valuation/currency/history policies must be reviewed before code changes.

## Phase 12 — Advanced Forecast and Scenarios

**Status:** Complete — all Phase 12 acceptance criteria objectively verified and accepted under the owner-approved execution-order exception. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-01

**Verified:** 2026-09-01

**Scope boundary:** Deterministic 7/30/60/90-day operational forecasts, categorical evidence confidence, confirmed-versus-estimated timelines, immutable snapshots, and separate exact what-if comparisons only. No Open Banking, fabricated provider provenance, AI-calculated forecast truth, canonical financial mutation, Phase 13 debt strategy, or later-phase feature.

### Implemented

- The complete synchronized Master Plan, architecture, decision log, implementation plan, and progress history were reread before changes; the working tree began clean at accepted Phase 11 commit `844df0690634d0fbc4cb89ddd725f7989939b58e`.
- The owner-approved 7/30/60/90-day horizons, confirmed/estimated truth model, categorical confidence rules, duplicate prevention, current-versus-forecast truth, scenario separation, Phase 10 review precedence, provider-neutral/manual operation, household privacy, deterministic AI boundary, provenance, and verification requirements are now recorded in both synchronized Master Plan copies, ADR-045/046, architecture, and the implementation plan.
- Added a pure versioned operational-forecast engine over immutable Phase 3 evidence. It keeps confirmed balance separate from projected balance, carries uncertain income only as estimated, uses conservative same-day ordering and user-timezone dates, prevents exact confirmed/estimated duplicates, rejects implicit FX, and calculates exact projected minima plus first Safety Margin/zero crossings and contributing obligations.
- Added deterministic `forecast-confidence-v1` thresholds for `HIGH`/`MEDIUM`/`LOW`, including observation count, recency, cadence stability, amount stability, freshness, and durable Phase 10 review precedence. Reviewed signals keep their stable decision across later identical intelligence runs; dismissed patterns are excluded and reopened patterns remain unreviewed.
- Added append-only actor-owned `forecastSnapshots` and `forecastScenarios` with exact BSON `Long` money, immutable Phase 3/10 provenance, calculation/policy versions, idempotency/concurrency protection, owner-first indexes, and bounded safe views. Explicit scenarios cover income, expense, reduction, loan/card payment, and savings-transfer adjustments without writing canonical truth.
- Added authenticated, trusted-origin, body-bounded, rate-limited, no-store APIs and protected Hebrew/RTL `/forecasts`. Navigation, horizons, confidence/freshness disclosure, current-versus-projected labels, timelines, empty/failure states, and what-if forms are natural Hebrew with explicit LTR isolation.
- Phase 9 remains blocked and no Open Banking collection, synchronization state, provider identifier, or bank provenance was introduced. Manual/provider-neutral records remain first-class inputs.

### Verification evidence

- Dedicated Phase 12 unit/UI/real-Mongo run passed 3 files / 19 tests. Coverage includes all four horizons, timezone boundaries, confirmed/estimated separation, every confidence boundary and degradation rule, reviewed/dismissed Phase 10 evidence, duplicate suppression, exact crossings, implicit-FX rejection, bigint arithmetic, scenario isolation, reproducibility, BSON int64 persistence, direct-ID/two-user/household denial, idempotency, and canonical non-mutation.
- The complete final-state regression with `RUN_REAL_ANTHROPIC_TESTS=1` passed 47 files / 203 tests using one worker. Real MongoDB isolation/integrity and the real Anthropic provider gate both passed; no mock replaced either required boundary.
- Authenticated production-browser acceptance on port 3001 used the retained real Auth.js session. It calculated and reloaded a 90-day deterministic forecast, honestly reported `LOW` confidence for insufficient predictive history while retaining confirmed events, and loaded exactly one explicit `123.45 ILS` hypothetical-income comparison without treating it as financial truth.
- Browser checks passed with `lang=he`, `dir=rtl`, computed RTL, 45 explicit LTR isolates, one `main`, one `h1`, no horizontal overflow, no visible internal IDs, one retained scenario, and no new warning/error logs. A production-only backward-compatibility failure for an earlier valid scenario was detected during acceptance and fixed by keeping confidence-version provenance on the referenced immutable forecast rather than duplicating it in scenario schema.
- Read-only real-Mongo acceptance confirmed the scenario owner matched an active Auth.js database session, its forecast/Phase 3/Phase 10 sources had the same owner, exact forecast/scenario money remained BSON `Long`, and accounts, transactions, budgets, and Goal Engine evidence received zero writes. Phase 9 collection count remained zero.
- Strict type-check, zero-warning ESLint, optimized Next.js production build, `git diff --check`, synchronized Master Plan hashes, tracked-secret/configuration checks, and the registry-backed high-severity audit passed; the audit reported zero vulnerabilities. `.env.local` remained ignored and untracked, port 3000 retained its original process, and no credential was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 12 is fully accepted under the execution-order exception. Operational forecast, scenario projection, and confirmed financial truth are distinct reproducible contracts; confidence remains deterministic evidence quality and AI remains explanation-only. Phase 9 remains visibly blocked and unaccepted.

### Exact next gate

At the Phase 12 acceptance checkpoint, Phase 13 had not started and its debt-term policies were still unresolved. Those policies were subsequently approved by the owner and Phase 13 is now completed in the newer section above.

## Phase 11 — Households and Permissions

**Status:** Complete — all Phase 11 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-01

**Verified:** 2026-09-01

**Scope boundary:** Owner/member households, secure invitations, explicit account/verified-goal sharing, shared-only exact summary, membership lifecycle, immutable audit, and authenticated Hebrew/RTL partner UX only. Individual ownership remains unchanged. No household-owned financial truth, household Safe to Spend, duplicated budget/goal engine, Open Banking, provider provenance, or unrelated later-phase feature.

### Implemented

- Phase 10 is preserved at synchronized clean commit `a67aeef88c2bdc127c367fc103708e1827de9ede`; `.env.local` is ignored and untracked.
- The attached owner policy, complete Master Plan, architecture, decision log, implementation plan, and progress record were read in full before changes.
- The previously unresolved private/shared, role, invitation, removal/leave, dissolution, derived-data, direct-ID, audit, and AI-isolation gates are resolved and recorded in both synchronized Master Plan copies, ADR-043/044, architecture, and the implementation plan.
- Added a deny-by-default owner/member policy evaluator and strict owner-free client commands. Every request derives its actor from Auth.js; household IDs, membership IDs, invitation IDs, resource IDs, roles, ownership, and visibility claims never prove authorization.
- Added `households`, member-only `householdMemberships`, hash-only/email-bound `householdInvitations`, and versioned `householdResourceShares` repositories with owner/current-state indexes, optimistic versions, idempotent creation, unique active membership/invitation/resource constraints, membership epochs, and entity-local append-only audit evidence.
- Added a secure seven-day invitation lifecycle with 256-bit server randomness, one-time fragment links, normalized intended-email hashing, safe hints, self/duplicate/replay rejection, expiry/revocation, and a convergent accept-before-activation sequence. No plaintext token, email, Auth.js identifier, or secret is persisted in invitation evidence.
- Added explicit owner-controlled sharing/unsharing of individually owned accounts and latest Goal Engine definitions. Source ownership and records never change. Other members receive read-only shared views and can share only their own eligible resources. Existing and newly created resources remain private until an explicit grant.
- Added a deterministic shared-only projection with exact currency-grouped account totals and safe contribution provenance plus authorized latest-goal definition/progress views. Full owner engine snapshots, budgets, Safe to Spend, forecasts, provider data, AI history, and private sources never enter the household view.
- Added removal, leave, rejoin, and dissolution semantics that revoke access from current state rather than cleanup. Membership epochs prevent stale grants from reviving after rejoin; a new explicit share action is required. Individually owned financial records and historical audit evidence remain intact.
- Added authenticated, trusted-origin, body-bounded, rate-limited, no-store APIs and a protected Hebrew/RTL `/households` UX for creation, acceptance, owner/member review, explicit resources, invitations, audit, settings, leave/removal, and dissolution. Email, tokens, timestamps, money, currencies, and safe provenance use natural LTR isolation.
- The initial implementation remains intentionally limited to explicit sharing of existing individually owned accounts and verified goals. Current full-user engine/budget/Copilot evidence is not a safe household projection because it may contain private inputs.

### Verification evidence

- Unit/UI suite: 31 files / 141 tests passed. Phase 11 coverage includes the complete role matrix, rejection of client ownership/role/visibility claims, seven-day opaque invitation contracts, deterministic email normalization/hashing/masking, private-by-default states, natural Hebrew copy, and LTR value isolation.
- Dedicated real-Mongo Phase 11 suite: 1 file / 6 lifecycle tests passed. It proved pre-existing/future-resource privacy, idempotent creation, hash-only expiring/revocable/single-use email-bound invitations, cross-user/cross-household/direct-ID denial, explicit owner-only resource grants, exact BSON `Long` source money and same-currency totals, goal views, immutable audit, optimistic concurrent removal, immediate removal/leave/dissolution revocation, source preservation, membership-epoch rejoin protection, and no Open Banking collections.
- Copilot-isolation acceptance proved that an active household and explicitly shared account cannot change another member's actor-owned provider context; household IDs, both internal user IDs, and the other owner's unique private balance were absent from minimized provider input.
- Complete environment-loaded regression with the real Anthropic gate enabled passed 44 files / 184 tests. An initial parallel attempt caused seven MongoDB setup hooks to exceed their 10-second shared-infrastructure timeout; rerunning the unchanged suite with one worker passed every test. All prior real-Mongo, exact-money, deterministic-engine, budgeting, goals, simulation, AI, and transaction-intelligence guarantees remained green.
- Authenticated production-browser acceptance on port 3001 used the retained real Auth.js session to create a private household. The page exposed three existing resources only as explicit share candidates while both shared-account and shared-goal summaries remained empty. DOM checks confirmed `lang=he`, `dir=rtl`, LTR email/token/date isolation, natural Hebrew controls and empty states, and no browser/server errors.
- Strict TypeScript, zero-warning ESLint, optimized Next.js production build, `git diff --check`, tracked-secret/configuration checks, and the registry-backed high-severity dependency audit passed; the audit reported zero vulnerabilities. `.env.local` remained ignored and untracked, and no credential was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 11 is fully accepted. Household membership is now a reversible audited authorization layer over immutable individual ownership; it never creates household-owned financial truth or grants implicit access. Phase 9 remains visibly blocked and unaccepted. Autonomous progression reaches the Phase 12 policy gate, whose forecast range/confidence presentation requires an explicit product decision before implementation.

## Phase 10 — Transaction Intelligence

**Status:** Complete — all Phase 10 acceptance criteria objectively verified and accepted under the owner-approved execution-order exception. Phase 9 remains BLOCKED, unimplemented, and unaccepted.

**Started:** 2026-09-01

**Verified:** 2026-09-01

**Scope boundary:** Deterministic merchant normalization, category suggestions, recurring/subscription, duplicate, unusual-amount, increase, and unusual-merchant review signals over bounded provider-neutral manual history. Predictions and reviews remain separate from confirmed transaction facts. No Open Banking provenance, bank sync, automatic categorization, transaction mutation, recurring-obligation creation, AI financial authority, or later-phase capability.

### Approved checkpoint

- Phase 8 remains preserved at pushed commit `a8e0471dbde75e65b3b9b1eaf7865de4eb7dd93d`; the Phase 10 start inspection found clean synchronized `main`/`origin/main` and an ignored/untracked `.env.local`.
- The complete Master Plan, architecture, decision log, implementation plan, and progress record were reread before changes.
- ADR-041 records the execution-order exception only. Phase 9 remains blocked on provider, jurisdiction/legal, consent, encryption/KMS, and official Integration/Sandbox access; no Phase 9 code or acceptance is implied.
- ADR-042 records the deterministic, immutable, owner-scoped, review-only intelligence boundary. There is no unresolved Phase 10 product/security gate requiring unsafe assumptions before implementation.

### Implemented

- Added a pure deterministic, versioned transaction-intelligence engine with bounded inputs/signals, Unicode-safe merchant normalization, curated merchant rules, user-confirmed-history precedence, exact duplicate matching, recurring cadence detection, subscription and price-increase signals, same-currency amount anomalies, unusual-merchant signals, integer-basis-point confidence, closed explanation codes, and stable evidence identifiers. The engine has no provider or AI dependency.
- Added immutable actor-owned `transactionIntelligenceRuns` and append-only `transactionIntelligenceReviews` repositories with owner-first indexes, BSON `Long` money, canonical input hashes, version/provenance evidence, idempotent run commands, concurrency-safe review sequences, and no update/delete path.
- Added an authenticated service and trusted-origin, body-bounded, rate-limited, no-store APIs. Reads are side-effect free; analysis is explicit. Client contracts cannot select an owner. An explicit category confirmation appends the existing Phase 5 correction evidence and leaves the source transaction unchanged; all other reviews remain reversible append-only evidence.
- Added protected Hebrew/RTL `/transaction-intelligence` review UX with natural LTR isolation for money, dates, confidence, and versions. The page distinguishes detected evidence from confirmed financial truth, exposes empty/failure/review states, and never presents a prediction as an applied transaction/category/recurrence.
- Extended the bounded owner-only financial export to schema version 5 with public intelligence runs and review evidence while omitting ownership, internal transaction/repository identifiers, idempotency material, and audit internals.
- Extracted the shared effective-category projection used by budgets and transaction intelligence, preserving Phase 5 refund/correction semantics and keeping immutable transaction facts authoritative.

### Verification evidence

- Unit suite: 29 files / 134 tests passed. Coverage includes known merchants, correction-history precedence/conflicts, low-confidence omission, duplicate/recurring/subscription/increase/anomaly signals, currency separation, strict no-owner command schemas, deterministic quality fixtures, Hebrew/RTL rendering, and absence of internal identifiers.
- Dedicated real-Mongo Phase 10 suite: 1 file / 6 tests passed. It proved BSON int64 evidence, immutable runs, two-user isolation, explicit correction linkage without source mutation, run idempotency/conflict handling, append-only dismiss/reopen review history, owner-first indexes, and safe analyzer failure with unchanged canonical finance.
- Complete regression with real Anthropic acceptance enabled: 41 files / 172 tests passed. The full real-Mongo integration set, prior phase regressions, and the real Phase 8 provider path remained green.
- Authenticated production browser acceptance on port 3001 passed with a real Auth.js session: explicit analysis persisted, a known merchant produced an 85% category suggestion, explicit confirmation persisted immutable review/correction evidence, reload preserved the accepted state, and the source transaction category/version remained unchanged. DOM checks confirmed `lang=he`, `dir=rtl`, computed RTL, natural LTR isolates, one review card, no horizontal overflow, and no error alert.
- A read-only database acceptance check confirmed the active session owner matched all new records, exact money was BSON int64, review/correction linkage was correct, the original transaction remained unchanged, and no Phase 9/Open Banking collection was created.
- Strict TypeScript, zero-warning ESLint, optimized production build, `git diff --check`, and the high-severity dependency audit passed; the audit reported zero vulnerabilities. `.env.local` remained ignored and untracked, and no secret was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 10 is fully accepted under the execution-order exception. Transaction intelligence is deterministic review evidence over provider-neutral manual history and cannot silently rewrite confirmed financial truth. Phase 9 remains blocked and unaccepted. Autonomous progression stops before Phase 11 because its private/shared resource semantics and permission lifecycle remain a genuine unresolved product-policy gate; no Phase 11 code has started.

## Phase 8 — Claude Financial Copilot

**Status:** Complete — all Phase 8 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule.

**Started:** 2026-09-01

**Verified:** 2026-09-01

**Scope boundary:** Server-only Anthropic adapter, minimized structured deterministic context, Hebrew chat and Safe-to-Spend/purchase/goal/monthly guidance, closed FACT/INSIGHT/RECOMMENDATION responses, owner-scoped deletable history, safe metadata telemetry, prompt-injection defenses, and usage controls only. No AI calculation or mutation of financial truth, Phase 9 banking, Phase 10 transaction intelligence, or later-phase capability.

### Approved policy checkpoint

- Phase 7 is preserved at pushed commit `7ac23756b8b5c6624e1bf9ec73bed8a612f778f9`; the Phase 8 start check found a clean synchronized `main` and an ignored/untracked `.env.local`.
- The configured Anthropic capability was confirmed only as present; its value was not printed or logged.
- The complete Master Plan, architecture, decision log, implementation plan, and progress record were reread before changes.
- Owner-approved context minimization, forbidden-data redaction, identifier minimization, untrusted-text handling, owner-scoped deletion/retention, provider handling, metadata-only telemetry, safe errors, per-user isolation, deterministic authority, no-hidden-mutation, server-side redaction, and provider-abstraction rules are recorded in both synchronized Master Plan copies, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, and ADR-039 before implementation.

### Implemented

- Added a provider-neutral server-only AI port and native Anthropic Messages adapter with schema-constrained output, explicit timeouts, safe provider/configuration error categories, optional private multi-workspace selection, and no Anthropic transport types in financial/domain code.
- Added deterministic purpose-specific context assembly for Safe to Spend, the latest saved purchase simulation, verified goal progress, and the current monthly budget. Only selected actor-owned engine facts and aliased/versioned evidence enter provider context; internal owner, MongoDB, session, source, and provider identifiers are omitted.
- Added deterministic server-side redaction and fail-closed validation for credentials, authentication artifacts, card/CVV data, private keys, secret-bearing assignments/URIs, forbidden internal fields, excessive history, non-Hebrew output, generated numerical text, and missing/foreign evidence citations. User/import/provider text remains explicitly untrusted and cannot override system policy or financial authority.
- Added owner-scoped `aiConversations` persistence with owner-first indexes, bounded twelve-exchange history, optimistic continuation, minimal user-visible messages, schema-validated results, safe provider metadata, internal evidence provenance, explicit last-two-message history opt-in, and hard deletion isolated from canonical financial records. Hidden prompts, raw contexts, provider payloads, secrets, and auth artifacts are not stored.
- Added metadata-only telemetry with opaque request correlation, provider/model, duration, token usage, status/error category, retry count, and minimization/redaction versions. Logs contain no prompts, responses, raw financial payloads, actors, source IDs, credentials, or unsanitized financial values.
- Added authenticated trusted-origin, body-bounded, no-store, rate-limited list/send/delete APIs and protected Hebrew/RTL `/copilot`. The UI separates עובדות/תובנות/המלצות, renders cited deterministic evidence independently in natural LTR, explains privacy/authority/history rules, supports focus selection and explicit bounded-history opt-in, and exposes no internal identifiers.

### Verification evidence

- Unit suite: 27 files / 125 tests passed, including minimization, forbidden-field redaction, injection boundaries, evidence-only numerical authority, provider contract/failure handling, workspace configuration, and Hebrew/RTL rendering.
- Dedicated real-Mongo Phase 8 suite: 1 file / 5 tests passed against an isolated database. It proved owner-scoped sanitized storage, explicit bounded history, two-user read/continue/delete isolation, owner-first indexes, failure with no partial conversation, hard deletion limited to the owned AI conversation, and unchanged canonical account/snapshot evidence.
- Complete regression with `RUN_REAL_ANTHROPIC_TESTS=1`: 38 files / 156 tests passed. The real Anthropic test returned a schema-validated Hebrew response with valid deterministic evidence citations and provider token usage; no mock substituted for this gate.
- Authenticated production server journey on port 3001 returned `201` through the real `/api/ai/conversations` route using a real Auth.js session, real actor-owned financial context, real MongoDB persistence, and the real Anthropic workspace. Safe telemetry contained only approved metadata. The response was stored only after provider and evidence validation succeeded.
- Production browser acceptance verified `lang=he`, `dir=rtl`, computed RTL, Hebrew navigation/form/privacy/authority/history and עובדות/תובנות/המלצות, 15 naturally LTR evidence values, no alert, and no visible `userId`, `sourceId`, `conversationId`, or `_id`.
- Strict TypeScript passed; zero-warning ESLint passed; the optimized Next.js production build passed with both AI routes and `/copilot`; `npm audit --audit-level=high` reported zero vulnerabilities; `git diff --check` passed. `.env.local` remained ignored and untracked, and no Anthropic credential or workspace value was printed, logged, committed, or pushed.

### Acceptance conclusion

Phase 8 is fully accepted. Claude is an authenticated, minimized, owner-isolated explanation layer over deterministic Financial OS evidence; it cannot calculate, redefine, or mutate financial truth. All Phase 0–7 and Hebrew/RTL guarantees remain intact.

## Phase 7 — Purchase Impact Simulation

**Status:** Complete — all Phase 7 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule.

**Started:** 2026-09-01

**Verified:** 2026-09-01

**Scope boundary:** Deterministic one-time/monthly purchase impact, exact explicit charges and installment schedules, rolling 30-day classification, 90-day earliest-`SAFE` search, source freshness disclosure, ephemeral results, and immutable explicit saves only. No AI, provider integration, purchase commitment, advanced Phase 12 scenarios, or later-phase functionality.

### Implemented

- Preserved the clean Phase 6 checkpoint at `962c024911a59c7d9d50e1f581db6769825551ea` and recorded every owner-approved Phase 7 rule in both synchronized Master Plan copies, the implementation plan, architecture, and ADR-038 before relying on it.
- Added a pure versioned purchase-simulation engine over immutable Phase 3 results. It reconstructs confirmed and expected balances with the original obligation/income ordering and Safety Margin boundaries, evaluates an explicit rolling 30-day window, and deterministically classifies exact boundary cases as `SAFE`, `CAUTION`, or `UNSAFE`.
- Added one-time and monthly-installment total-price inputs. Known interest/fees are explicit user-reported provenance and enter the true financed cost; unknown charges remain absent. Exact minor-unit division gives remainders to earliest installments and always conserves the full cost. The full schedule is shown separately from installments that fall within a particular 30-day evaluation.
- Added the approved 90-day first-`SAFE` search. The source snapshot must cover every candidate window; a proposed date may be up to 90 days after the source evaluation point, so the UI explicitly creates/selects a 210-day Phase 3 baseline. Incomplete data fails rather than extrapolating or calling `CAUTION` safe.
- Extracted the existing Phase 4 source/profile/calendar freshness algorithm into one shared server-only service. Dashboard behavior remains unchanged; Phase 7 returns `FRESH`/`STALE` separately from risk and visibly qualifies stale results without changing their mathematics.
- Added actor-owned, append-only `purchaseSimulations` with exact BSON `Long` evidence, owner-first indexes, source-snapshot and optional budget-period validation, idempotent explicit saves, one redacted save audit event, and no update/delete path. Ordinary evaluations remain non-persisting.
- Extended the bounded owner-only export to schema version 4 with public saved-simulation evidence while continuing to omit owner IDs, audit events, idempotency material, Auth.js records, and secrets.
- Added authenticated, trusted-origin, body-bounded, rate-limited, no-store evaluation/save APIs and protected Hebrew/RTL `/purchase-simulation`. The UI discloses hypothetical status, exact costs/schedule, 30-day timeline, classification, 90-day result, freshness, source/budget provenance, and explicit-save semantics with LTR money/date/identifier isolation.
- Added purchase-simulation navigation without visual redesign. No Claude, bank/card provider, purchase commitment, advanced scenario, notification, household, or later-phase functionality was introduced.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full automated suite against real MongoDB | Pass | 32 test files and 141 tests passed with no skips using the ignored real local configuration. |
| Phase 7 deterministic/UI suite | Pass | 23 unit files and 116 tests passed. New coverage proves exact `34 + 33 + 33` remainder allocation, month-end schedule anchoring, classification boundaries, uncertain-income exclusion, same-day conservatism, earliest/no safe date, charges/true cost, insufficient-horizon failure, Hebrew copy, stale disclosure, and LTR isolation. |
| Phase 7 real-Mongo integration | Pass | 9 integration files and 25 tests passed. New cases verify ephemeral reads, source/budget provenance, stale/math separation, immutable exact save/retry/conflict behavior, BSON `Long`, owner-first indexes, schema-4 export, two-actor isolation, and test-database cleanup. |
| Non-mutation/data-integrity gate | Pass | Real MongoDB before/after evidence shows evaluation writes nothing and save changes only `purchaseSimulations`; accounts, transactions, budget periods, Financial Engine/source snapshots, Safe to Spend, and Goal Engine evidence remain unchanged. |
| Real authenticated browser journey | Pass | The retained real Google/Auth.js MongoDB session opened the protected production page on port 3001, created an owned 210-day baseline, evaluated `1.00 ILS + 0.03 ILS` across three exact `0.35/0.34/0.34` installments as `SAFE`, explicitly saved/reloaded one labelled synthetic scenario, then evaluated an unsaved `100,000.00 ILS` purchase as `UNSAFE` with no invented safe date. No auth, repository, or calculation path was mocked. |
| Browser/database ownership evidence | Pass | The saved scenario owner matched an active Auth.js database session; its engine snapshot was owned by the same actor; exact fields were BSON `Long`; the schedule was `35/34/34` minor units; and one save audit event existed. No identifier, token, or secret was printed. |
| Hebrew/RTL/accessibility/responsive | Pass | Production DOM reported `lang="he"`, `dir="rtl"`, explicit LTR isolates, natural Hebrew labels/statuses, semantic headings/forms/lists/alerts, no browser warnings/errors, no default-width overflow, and no overflow at a reported 375-pixel narrow viewport. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; `/purchase-simulation` and both purchase-simulation APIs compiled as dynamic server routes. |
| Dependency audit | Pass at unchanged-dependency boundary | `npm audit --offline --audit-level=high`: zero vulnerabilities. Dependency manifests/lockfile are unchanged from Phase 6's same-day registry-backed zero-vulnerability gate; registry resubmission was blocked by the execution safety policy and is not claimed. |
| Runtime/security smoke | Pass | Production port 3001 served the authenticated/no-store journey with clean browser/server logs and server-derived ownership; the unrelated port-3000 application was not modified. |
| Secret/Git hygiene | Pass | `.env.local` remained ignored and untracked; no secret value was printed, logged, staged, exported, or added to source. |

The authenticated acceptance journey added one immutable 210-day Phase 3 source/result pair and one clearly labelled synthetic saved purchase simulation to the existing local test profile. It also ran one unsaved `UNSAFE` evaluation. It did not create a transaction or modify another user's records.

### Acceptance conclusion

Phase 7 is fully accepted. Purchase impact is exact, deterministic, owner-isolated, provenance-bearing, freshness-aware, and visibly hypothetical. Classification and earliest-safe-date behavior reconcile to the confirmed Phase 3 timeline, while saving remains a separate immutable evidence operation with no contamination of financial truth. All Phase 0–6 and Hebrew/RTL guarantees remain intact.

### Exact next milestone

Phase 8 — Claude Financial Copilot. Under the autonomous progression rule, Phase 8 may begin only after this verified Phase 7 work is committed and pushed. Its credential, privacy/redaction, structured-context, prompt-injection, retention, and cost/rate gates must be preflighted before code changes.

## Phase 6 — Goals and Measurable Progress

**Status:** Complete — all Phase 6 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule.

**Started:** 2026-08-31

**Verified:** 2026-08-31

**Scope boundary:** Versioned deterministic goal definitions, verified/manual baseline provenance, current progress, immutable meaningful evidence, milestones, lifecycle/versioning, and authenticated Hebrew/RTL goal management only. No Phase 7 purchase simulation, Phase 8 AI, Phase 9 banking, Phase 12 advanced scenarios, notifications, households, investments, or gamification.

### Implemented

- Recorded all owner-approved Phase 6 policies in both synchronized Master Plan copies, the implementation plan, architecture, and ADR-035/036 before relying on them. ADR-037 records the verified server-time/idempotency boundary discovered during acceptance.
- Added a pure exact-money Goal Engine with direction-aware raw and normalized basis-point progress, remaining gap, trend, point-in-time completion, explicit sustained-success durations, pending confirmation, preserved completion dates, regression/reopen semantics, and deterministic one-time 25/50/75/100 milestones.
- Implemented every approved canonical metric: scoped outstanding liabilities; scoped account balances; Financial Engine-backed credit independence with confirmed coverage and non-increasing dependence; explicit/liquid emergency funds with exact closed-budget essential-expense targets; scoped savings; current profile-timezone monthly spending under Phase 5 refund/correction rules; and explicit custom metrics that remain manual/unverified.
- Preserved Phase 1 goal values as user-reported evidence. Each tracked version stores that provenance separately from its first engine-derived verified baseline/current value; disagreement is retained rather than silently rewritten.
- Added owner-scoped `goalDefinitions`, append-only `goalProgress`, and technical `goalCommandReceipts` collections. Definitions/evidence use owner-first indexes, exact BSON `Long` money, bounded reads/exports, optimistic version expectations, evidence hashes, safe retry receipts, and actor-owned source validation.
- Material metric, target, deadline, scope, basis, or sustained-duration changes create immutable definition versions. Presentation-only Phase 1 goal edits remain allowed; tracked financial fields and deletion are rejected so historical evidence cannot be silently rewritten or removed.
- Evidence timestamps are derived from the server clock and the profile timezone; clients cannot backdate verified progress. Reads never write. Repeated equivalent evaluations on the same date/source state deduplicate without producing meaningless snapshots, while reused idempotency keys with different payloads fail closed.
- Added authenticated, trusted-origin, rate-limited, no-store definition/evaluation APIs and a protected Hebrew/RTL `/goals` center. It shows reported versus verified baselines, status, exact current/target/gap, trend, deadline, milestones, versioned history, localized metric inputs, and LTR-isolated source provenance.
- Added `/financial-data/goals` to the authenticated management surface and linked goals from the dashboard/financial-data navigation. System category identifiers are localized at presentation boundaries; user-authored labels remain unchanged.
- Extended the owner-only financial export to schema version 3 with serialized goal definitions and immutable progress evidence while excluding `userId`, idempotency hashes/receipts, internal audit fields, Auth.js data, and secrets.
- Kept verified goal progress separate from Phase 5 scenarios. No purchase simulator, advanced projection, AI, bank/investment integration, notification, gamification, or other future-phase feature was introduced.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full automated suite against real MongoDB | Pass | 29 test files and 125 tests passed with no skips using the ignored real local test configuration. |
| Phase 6 unit/UI suite | Pass | 21 unit files and 105 tests passed. New cases cover increase/decrease formulas, exact over-target values, manual/insufficient states, configurable 30-day stability, completion/regression/reopen, one-time milestones, mixed-currency rejection, Hebrew copy, system-category localization, provenance, and LTR isolation. |
| Phase 6 real-Mongo integration | Pass | 8 integration files and 20 tests passed. The Phase 6 fixture activates all seven goal strategies and verifies real Phase 3 snapshot/Phase 5 closed-budget linkage, manual-versus-verified baselines, immutable versions/evidence, material edit/delete guards, sustained success, milestones, regression, exact BSON `Long`, bounded safe export, retry/dedup behavior, owner-first indexes, and two-actor isolation. |
| Real authenticated browser journey | Pass | The production `/goals` page used the retained real Google/Auth.js MongoDB session on port 3001. Through the real UI it activated an existing synthetic debt goal against an owned loan, created a verified 8,000.00 ILS baseline/current value, retained the separate manual values, displayed the zero target and gap, then deduplicated an unchanged explicit reevaluation. History exposed the localized metric input and owned source/version. `/financial-data/goals` loaded successfully. No auth, API, repository, or metric path was mocked. |
| Hebrew/RTL/accessibility | Pass | The authenticated production DOM reported `lang="he"`, `dir="rtl"`, 16 explicit LTR isolates on the verified goal view, natural Hebrew labels/states/history, LTR money/dates/identifiers, semantic headings/regions/lists/details, and no browser warnings or errors. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; `/goals`, both goal APIs, and `/financial-data/[section]` compiled as dynamic server routes. |
| Dependency audit | Pass | Registry-backed `npm run security:audit`: zero vulnerabilities. |
| Runtime/security smoke | Pass | The production build served the authenticated goal center on port 3001 with no browser/server warnings or errors; identity remained server-derived, mutations retained origin/rate/body guards, and port 3000 was untouched. |
| Secret/Git hygiene | Pass | `.env.local` remained ignored and untracked; no secret value was printed, logged, staged, exported, or included in source. |

The authenticated journey added one immutable Phase 6 definition and baseline evidence to the existing synthetic local Financial OS profile. It did not delete or rewrite source records and did not alter another user's data.

### Acceptance conclusion

Phase 6 is fully accepted. Supported goals now have deterministic, versioned, owner-isolated, exact, explainable progress with honest manual/verified separation, immutable evidence, sustained-success and regression semantics, and no contamination from hypothetical scenarios. All Phase 0–5 and Hebrew/RTL guarantees remain intact.

### Exact next milestone

Phase 7 — Purchase Impact Simulation. Under the owner's autonomous progression authorization, Phase 7 may begin only after this verified Phase 6 change is committed and pushed to `origin/main`.

## Phase 5 — Budgets and Monthly Allocation

**Status:** Complete — all Phase 5 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule.

**Started:** 2026-08-31

**Verified:** 2026-08-31

**Scope boundary:** Phase 5 budget taxonomy, monthly allocation, rollover, refund/correction reporting, and explicitly separate deterministic scenarios only. No Phase 6 goal strategy/progress history, purchase-impact simulation, Claude, Open Banking, notifications, household behavior, gamification, or later-phase functionality was implemented.

### Implemented

- Recorded the owner's approved Phase 5 policies in both synchronized Master Plan copies, the implementation plan, architecture, and ADR-033 before using them as invariants.
- Added a pure exact-money budget engine. Real allocations use confirmed income only and reconcile as `confirmed income - allocations = signed unallocated`; over-allocation remains valid and is displayed as a highly visible negative deficit. Expected income is reported separately and cannot raise real allocatable money.
- Added hybrid categories with stable internal system/custom identifiers and user-controlled labels, visibility, order, and per-category rollover. System defaults are available without duplicating records; custom categories and overrides are owner-scoped. The default policy is `reset`, while `carry` forwards the exact signed prior remainder.
- Added owner-scoped `budgetCategories`, `budgetPeriods`, and append-only `budgetCategoryCorrections` repositories with owner-first indexes, bounded reads, BSON `Long` money, idempotent custom-category creation/correction commands, optimistic period/category updates, and entity-local audit evidence.
- Added open-period save and completed-month close behavior. Closing freezes exact allocation/results and rollover evidence; a later period prevents retroactive save/close of an earlier period. Reset categories carry zero, carry categories preserve both positive and negative remainders, and historical overspending remains visible.
- Added refund semantics to actual transactions. A refund must link to an owned expense, reduces category spending in its actual calendar period, and never rewrites an earlier closed period. Refunds do not become confirmed-income basis.
- Prevented silent category rewrites on transactions. Category corrections append immutable evidence with original/corrected identity, actor, reason, and time; reporting projects corrected classifications while retaining source facts.
- Added a separate deterministic scenario/target-gap calculation. It starts from the latest actor-owned Phase 3 conservative result, accepts hypothetical income, uncertain income, expense reductions, investment proceeds, and additional expenses, and never persists them as real transactions, balances, allocations, or engine inputs.
- Added protected, no-store category/period/correction/scenario APIs and a protected Hebrew/RTL `/budgets` planner with exact LTR money/date values, deficit disclosure, category settings, close-state explanation, corrections, and scenario separation. Dashboard and financial-data navigation now link to the planner.
- Extended the bounded owner-only financial export with budget periods, categories, and correction evidence while continuing to exclude ownership internals, audit/idempotency material, Auth.js records, and secrets.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full automated suite against real MongoDB | Pass | 26 test files and 112 tests passed with no skips when loaded with the ignored real local test configuration. |
| Phase 5 deterministic/unit suite | Pass | 19 unit files and 96 tests passed. New fixtures cover confirmed/uncertain income separation, exact signed deficits, reset and signed carry, same/later-period refunds, uncategorized cash truth, correction projection, scenario isolation/target gaps, schema invariants, and Hebrew/RTL UI behavior. |
| Phase 5 real-Mongo integration | Pass | 7 integration files and 16 tests passed. Phase 5 cases verify BSON `Long`, owner-first indexes, optimistic/audited saves, frozen close evidence, rollover chains, immutable corrections, later-period refunds, two-user isolation, and exact scenario separation. |
| Real authenticated browser journey | Pass | The production `/budgets` page used the retained real Google/Auth.js MongoDB session on port 3001. Through the real UI it created a custom carry category, appended a correction, saved a 100.00 ILS over-allocation against 0.00 confirmed income, displayed `-100.00 ILS` unallocated, calculated a non-persisting scenario, and renamed/reordered/hid the stable category while preserving the saved allocation. No auth, API, repository, or calculation path was mocked. |
| Historical close acceptance | Pass at the objectively testable boundary | The current browser month was still open and therefore correctly could not be closed. Real-Mongo integration used completed months to verify close eligibility, frozen evidence, reset/signed-carry behavior, later-period protection, post-close correction evidence, and later-period refund recognition. |
| Hebrew/RTL/accessibility/responsive | Pass | The authenticated production DOM reported `lang="he"`, `dir="rtl"`, 136 explicit LTR isolates, 446px document/client widths with no horizontal overflow, natural Hebrew labels/errors/states, and no browser warnings or errors. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; `/budgets` and all four budget API routes compiled as dynamic server routes. |
| Dependency audit | Pass | Registry-backed `npm run security:audit`: zero vulnerabilities. |
| Runtime/security smoke | Pass | The production build served the authenticated planner on port 3001 with no browser/server warnings or errors; responses retained server-derived identity and no-store boundaries. Port 3000 was not modified. |
| Secret/Git hygiene | Pass | `.env.local` remained ignored and untracked; no secret value was printed, logged, staged, or included in source. |

The authenticated journey created one custom category, one immutable category correction, and one open-period allocation in the existing synthetic local test profile. It did not alter or delete another user's records. Scenario values were not persisted as financial truth.

### Acceptance conclusion

Phase 5 is fully accepted. Current and historical budget truth is exact, deterministic, auditable, user-isolated, and explainable; over-allocation, refunds, corrections, rollover, uncertain income, and scenarios follow the approved policy without weakening Phase 0–4 or Hebrew/RTL guarantees. No Phase 6 behavior was pulled forward.

### Exact next milestone

Phase 6 — Goals and Measurable Progress. Under the owner's autonomous progression authorization, Phase 6 may begin only after this verified Phase 5 change is committed and pushed to `origin/main`.

## Phase 4 — Financial Dashboard

**Status:** Complete — all Phase 4 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule.

**Started:** 2026-08-31

**Verified:** 2026-08-31

**Scope boundary:** Phase 4 snapshot presentation and freshness-aware dashboard reads only. No budgets/allocation, advanced goal progress policy, Claude, Open Banking, proactive notifications, household behavior, gamification, or later-phase functionality was implemented.

### Implemented

- Added a protected dynamic `/dashboard` that answers current position, expected future position, Safe to Spend, and stored manual-goal direction from the latest owned Phase 3 result. Navigation now connects completed onboarding, financial-data management, and the dashboard.
- Added a server-only dashboard query service. It loads the latest two actor-owned engine snapshots, linked actor-owned source manifest, current profile/source revisions, and actor-owned goals. The browser receives bounded serialized view models only; no MongoDB documents, owners, audit data, or `bigint` values cross the boundary.
- Preserved the Phase 3 truth boundary. Safe to Spend, current/future balances, Safety Margin, shortfall, monthly totals, debt, savings, credit, and timeline balances come directly from versioned engine results. The dashboard only selects already-calculated events for 7/14/30-day windows, finds the recorded minimum-capacity point, and computes an exact result-to-result change delta on the server.
- Added explicit freshness semantics. Source revision drift, profile updates, a missing/foreign source manifest, and a new calendar day in the user's configured timezone mark the view stale and state why. Reads never write; the user explicitly requests a new 30-day snapshot through the authenticated, origin-checked, rate-limited engine endpoint.
- Added real empty, loading, error, current, stale, and no-alert states; a main Safe to Spend card; current/future balance summaries; limiting-point explanation; snapshot-derived on-screen alerts; timeline tabs; monthly metrics; and persisted goal current/target summaries without pulling Phase 6 goal policy forward.
- Kept Financial OS Hebrew-first/RTL-first and isolated all money, percentages, dates, month codes, and timestamps as LTR values. Semantic headings, definition lists, ordered/unordered lists, tab roles/relationships, status live regions, clear focusable buttons, mobile-first grids, wrapping, and long-money break behavior protect accessibility and responsive layout without a redesign.
- Limited each client timeline window to the first 100 ordered events and goals to the first 20 priority-ordered records, with explicit Hebrew truncation notices. Phase 4 adds no database collection or shared dashboard cache.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full automated suite against real MongoDB | Pass | 23 test files and 101 tests passed with no skips. |
| Dashboard unit/view tests | Pass | 17 unit files and 88 tests passed. Phase 4 fixtures reconcile Safe to Spend and change to engine outputs, verify limiting event/alerts/windows/goals, stale source/profile/day states, honest empty state, 100-event/20-goal payload bounds, Hebrew copy, ARIA tabs, and LTR isolation. |
| Real-Mongo isolation | Pass | 6 integration files and 13 tests passed. The Phase 3 fixture now verifies that two actors receive distinct dashboard snapshots/currencies, cannot load the other actor's manifest, and retain all prior result/source ownership guarantees. |
| Real authenticated browser journey | Pass | The protected dashboard loaded with the retained real Google/Auth.js database session. An explicit first calculation produced and reloaded the complete dashboard; a second explicit refresh showed no engine-result change; 7/14/30 controls switched the visible event window; displayed values reconciled to the stored Phase 3 result. No auth or calculation path was mocked. |
| Hebrew/RTL/accessibility | Pass | The production DOM reported `lang="he"`, `dir="rtl"`, 26 explicit LTR isolates, semantic headings/lists/terms, named tablist/tabs/tabpanel, live status regions, and one instance of each dashboard section. User-entered goal text remained user-controlled rather than forcibly translated. |
| Responsive presentation | Pass at implemented/tested boundary | Authenticated wide-layout inspection had no horizontal overflow; mobile-first base classes stack before `sm`/`lg` enhancements, long exact-money values use break-safe typography, and component/build tests protect the responsive structure. The browser backend's attempted narrow viewport override did not change its reported viewport and is not claimed as narrow-device visual evidence. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; `/dashboard` compiled as a dynamic protected route. |
| Dependency audit | Pass | Registry-backed `npm run security:audit`: zero vulnerabilities. |
| Runtime/security smoke | Pass | Production build ran on port 3001; protected dashboard/API behavior remained authenticated/no-store and server logs remained error-free. Port 3000 was not modified. |
| Secret/Git hygiene | Pass | `.env.local` remained ignored and untracked; no secret value was printed, logged, staged, or included in source. |

The authenticated acceptance journey created immutable Phase 3 engine/source snapshot pairs in the existing synthetic local test profile through the intended explicit refresh action. No user-owned source record was altered or deleted.

### Acceptance conclusion

Phase 4 is fully accepted. The dashboard is useful with manual data, reconciles to deterministic engine truth, remains owner-isolated and bounded, handles missing/stale state honestly, and preserves Hebrew/RTL, exact money, security, and all prior regressions. No Phase 5 code was pulled forward.

### Exact next milestone

Phase 5 — Budgets and Monthly Allocation. Under the owner's autonomous progression authorization, Phase 5 may begin only after this verified Phase 4 change is committed and pushed to `origin/main`.

## Phase 3 — Deterministic Financial Engine

**Status:** Complete — all Phase 3 acceptance criteria objectively verified and accepted under the authorized autonomous progression rule.

**Started:** 2026-08-31

**Verified:** 2026-08-31

**Scope boundary:** Phase 3 pure financial calculation and owned snapshot orchestration only. No dashboard/read-model UI, budgets, Claude, Open Banking, longer-range forecast product, household, gamification, or other later-phase functionality was implemented.

### Implemented

- Recorded the approved horizon, uncertainty, percentage-margin, and same-day-order policies in the Master Plan, implementation plan, architecture, and ADR-029 before treating them as invariants.
- Added a pure versioned financial engine with explicit `asOf`, IANA timezone, currency, 1–366-day horizon, exact-money balances, typed events, monthly confirmed-income basis, and fixed/percentage Safety Margin inputs. The product default is 30 rolling calendar days; calculation architecture is not fixed to that value.
- Added anchored recurrence expansion for one-time, irregular, weekly, biweekly, monthly, quarterly, and annual schedules. Short months clamp from the original anchor rather than drifting. Cards become one billing obligation; loan installments are monthly and the final payment is capped at remaining principal.
- Implemented deterministic ordering and balance projection. Reliable UTC timestamps order chronologically; otherwise a same-date obligation precedes income. The engine tracks confirmed and expected balances separately, evaluates the minimum confirmed balance across the full timeline, and derives non-negative Safe to Spend plus an explicit shortfall.
- Enforced the 100%-certainty rule. Confirmed income may affect core safety; uncertain income is preserved in timeline/totals/expected balance but cannot raise Safe to Spend. Percentage margins use confirmed income in each applicable user-timezone calendar month and exact round-half-to-even minor-unit arithmetic.
- Added exact monthly realized/forecast metrics, account/available-cash/savings/debt/credit summaries, and credit utilization without floating-point money arithmetic.
- Added conservative Phase 2 source mapping under ADR-030: current bank/cash liquidity is not mutated by replaying historical transactions; restricted-destination and non-confirmed income do not fund core safety; recurring income without certainty remains uncertain; detailed savings avoid legacy savings double-counting; and separate source records remain separate auditable events.
- Extended `financialSnapshots` with immutable owned `engine_result` documents linked to immutable source manifests. Results store engine/policy versions, canonical SHA-256 input hash, exact BSON `Long` money, audit metadata, and JSON-safe views. Source/result queries discriminate by both owner and kind.
- Added authenticated, origin-protected, rate-limited, no-store `GET`/`POST /api/financial-engine/snapshots` orchestration. The route derives the actor from Auth.js and accepts no ownership field; all source reads and snapshot writes remain server-only.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full automated suite against real MongoDB | Pass | 21 test files and 96 tests passed with no skips. |
| Phase 3 deterministic unit suite | Pass | 83 total unit tests passed. Engine fixtures cover the approved four policies, alternative horizons, negative balances/shortfall, exact monthly metrics, timeline minima, timestamp fallback/override, int64 overflow, repeated safety invariants, missing data, duplicate obligations, recurrence anchors, leap years, cards, and capped loan installments. |
| Phase 3 real-Mongo integration | Pass | 13 total integration tests passed. Two actors verified owned source assembly and isolated engine/manifest listings; results persisted as BSON `Long`; audit/source-manifest linkage included Safety Margin; exact retries were idempotent; changed-input key reuse conflicted; and independent identical inputs produced identical hashes/results. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; `/api/financial-engine/snapshots` compiled as a dynamic server route. |
| Dependency audit | Pass | Registry-backed `npm run security:audit`: zero vulnerabilities. |
| Runtime/security smoke | Pass | Production build on port 3001 returned health 200; unauthenticated engine access failed closed with 401 and `no-store`; MIME/frame security headers remained present. Port 3000 was not modified. |
| Authentication boundary | Pass at inherited verified boundary | No Phase 3 auth path was mocked or weakened. The route uses the same real Auth.js server-derived actor boundary accepted in Phases 1–2; Phase 3 did not require a new interactive provider flow. |
| Secret/Git hygiene | Pass | `.env.local` remained ignored and untracked; no secret value was printed, logged, staged, or included in source. Tracked code uses no public secret variables. |

### Acceptance conclusion

Phase 3 is fully accepted. Safe to Spend is deterministic, conservative, exact, reproducible from the same typed input, provenance-linked, and owner-isolated. All Phase 0–2, authentication, security, data-integrity, and Hebrew/RTL regressions remain green. No Phase 4 code was pulled forward.

### Exact next milestone

Phase 4 — Financial Dashboard. Under the owner's autonomous progression authorization, Phase 4 may begin only after this verified Phase 3 change is committed and pushed to `origin/main`.

## Phase 2 — Core Financial Data Foundation

**Status:** Complete — all Phase 2 acceptance criteria verified and accepted.

**Started:** 2026-08-31

**Verified:** 2026-08-31

**Scope boundary:** Phase 2 source-data storage and management only. No cash-flow engine, recurrence expansion, forecasting, Safe to Spend calculation, Claude, Open Banking, dashboard, household, gamification, or other later-phase behavior was implemented.

### Implemented

- Extended the Phase 1 manual-data architecture without duplicating financial truth. Existing `accounts`, `incomeSources`, `creditCards`, `recurringExpenses`, and `loans` collections remain authoritative; Phase 2 adds `transactions`, `recurringTransactions`, `savings`, and `financialSnapshots`.
- Added closed Zod schemas and invariants for actual income/expense/transfer transactions, explicit recurring-transaction definitions, and liquid/fixed-term savings. Transfers require two distinct owned accounts; recurrence dates and fixed-term maturity are validated deterministically.
- Preserved exact money as decimal input -> domain `bigint` minor units -> MongoDB BSON `Long` -> JSON minor-unit strings. Phase 2 browser and database verification included values beyond JavaScript's safe-integer range and exact reload checks.
- Added authenticated Phase 2 management pages and APIs for accounts, transactions, recurring transactions, incomes, recurring expenses, credit cards, loans/debts, and savings. All Financial OS-controlled copy is Hebrew, the document remains RTL, and currency/date/numeric values are LTR-isolated.
- Added cursor pagination with bounded page sizes, bounded full-data reads for exports/snapshots, optimistic concurrency, recoverable soft deletion, entity-local audit events, and user-prefixed query/version/date indexes.
- Added create idempotency using per-owner SHA-256 key hashes and payload hashes. Exact retries return the original result; reuse of the same key for different data returns a conflict. Raw idempotency keys are not persisted.
- Added server-side validation of transaction account references. Every referenced account must be active and owned by the authenticated actor; destination accounts are accepted only for transfers.
- Added immutable versioned `source_manifest` snapshots. Phase 2 snapshots record the exact source record IDs, versions, and update timestamps included, but deliberately contain no calculated balance, forecast, timeline, or Safe to Spend result.
- Added a bounded owner-only JSON export that contains public profile/record view models but excludes `userId`, audit trails, idempotency hashes, Auth.js records, tokens, and provider secrets. Responses are no-store, attachment-marked, and MIME-sniff protected.
- Preserved backward compatibility for Phase 1 records whose stored source metadata used the earlier string representation; new records use `{ kind: "manual" }` without rewriting or destructively migrating existing data.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Full automated suite against real MongoDB | Pass | 17 test files and 78 tests passed with no skips. |
| Phase 2 integration suite | Pass | Real MongoDB verified owner-scoped CRUD, foreign-account rejection, per-owner idempotency, conflict recovery, cursor pagination, BSON `Long`, source metadata, custom indexes, snapshot isolation, and safe exports for two constructed actors. |
| Real authenticated browser journey | Pass | A real Google OAuth callback returned to Financial OS; the protected Hebrew/RTL data hub loaded; an explicitly labelled synthetic account and transaction were created through the UI, persisted, and reloaded with exact `1.23 ILS` and `2.34 ILS` values; a source snapshot was captured. No auth/session path was mocked. |
| Database-session ownership evidence | Pass | A read-only database check confirmed an active Auth.js MongoDB session and that both E2E records' owners matched that session user. Their money fields were BSON `Long`, their source was manual, and both had audit entries. No IDs or tokens were printed. |
| UI failure recovery | Pass | The browser exposed an async React form-lifecycle defect after a successful insert. The form reference is now captured before `await`; rebuild and real-browser retry returned the Hebrew success state and reloaded correctly. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; all Phase 2 pages and APIs compiled as dynamic protected routes. |
| Dependency audit | Pass | Registry-backed `npm run security:audit`: zero vulnerabilities. |
| Runtime/security smoke | Pass | Global CSP/frame/MIME headers were present; unauthenticated financial API access returned 401 with `Cache-Control: no-store`; the authenticated server log remained error-free after the fixed OAuth retry and Phase 2 journey. |
| Secret/Git hygiene | Pass | `.env.local` remained ignored and untracked; no credential value was printed, committed, or prepared for push. |

The authenticated acceptance run intentionally left its clearly labelled synthetic account, transaction, and immutable source snapshot in the authenticated local test profile. No user-owned financial record was automatically deleted.

### Acceptance conclusion

Authorized users can maintain and reload the complete Phase 2 manual source-data set without precision loss. Ownership is derived from the real Auth.js database session, foreign account references fail closed, source mutations are audited, duplicates are controlled by idempotency, lists are bounded, and snapshots/exports remain owner-scoped. Every defined Phase 2 criterion and regression gate passed. Phase 2 is accepted.

## Hebrew-first / RTL-first localization baseline

**Status:** Complete — permanent pre-Phase-2 product requirement implemented and verified.

**Started:** 2026-08-30

**Verified:** 2026-08-31

**Scope boundary:** Localization of the existing Financial OS-controlled Phase 0/1 UI only. No visual redesign and no Phase 2 functionality.

### Implemented

- Added Hebrew-first and RTL-first as permanent cross-phase requirements in `MASTER_PLAN.md`, the preserved master prompt, `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE.md`, and ADR-025.
- Set the root document to `lang="he"` and `dir="rtl"` and localized metadata.
- Centralized active product copy and safe client-visible error-code mapping under `src/lib/i18n`; future locale selection can replace the active catalog without changing domain components or API contracts.
- Localized the landing page, navigation, Google sign-in wrapper, profile onboarding, all seven manual sections, options, actions, empty states, record summaries, review/completion, sign-out, not-found page, and application error boundary to natural Hebrew.
- Preserved English for source identifiers, schemas, API fields/codes, database records, logs, tests, and engineering documentation. Google/provider-controlled screens remain outside the localization boundary.
- Added explicit LTR isolation for country/currency codes, IANA timezones, money summaries, dates, percentages, numeric inputs, and other inherently LTR values through `dir="ltr"` and `<bdi dir="ltr">`.
- Kept the existing visual system and page composition; only copy, directionality, and bidirectional-text safety changed.

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Localization/RTL unit and render coverage | Pass | New suite verifies the Hebrew/RTL locale defaults, centralized Hebrew catalog, every Phase 1 manual form, safe public error mapping, and LTR technical-value isolation: 5/5 tests passed. |
| Full credential-free regression suite | Pass | `npm test`: 12 files passed, 4 integration files skipped; 64 tests passed, 5 explicitly skipped. |
| Real-local-Mongo integration suite | Pass | Environment-scoped `npm run test:integration`: 4 files and 5 tests passed. Localization did not change persistence or ownership behavior. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; localized static, protected, auth, onboarding, review, error, and API routes compiled. |
| Dependency audit | Pass | `npm run security:audit`: zero vulnerabilities. |
| Rendered browser acceptance | Pass | Production port 3001 reported `lang="he"`, `dir="rtl"`; landing, sign-in, navigation, and not-found accessible snapshots were Hebrew. Visual inspection confirmed RTL composition without redesign. |
| Master Plan preservation | Pass | `MASTER_PLAN.md` and `FINANCIAL_OS_MASTER_PROMPT.md` received the same permanent requirement and remain normalized copies. |

### Acceptance conclusion

The Hebrew-first/RTL-first baseline is implemented and verified for every existing Financial OS-controlled UI surface. The requirement is permanent for later phases: new copy must use the localization boundary, new UI must default to RTL/Hebrew, and inherently LTR values must remain isolated. Phase 2 has not started and still requires explicit approval.

## Phase 1 — Identity, Profile, and Manual Onboarding

**Status:** Complete — real authentication acceptance gate passed.

**Credential-free implementation approval:** Approved by the project owner on 2026-08-30. The real-authentication acceptance evidence below supersedes the earlier pending status without changing the preserved credential-free evidence.

**Started:** 2026-08-30

**Verified:** 2026-08-30

**Scope boundary:** Phase 1 only. No Financial Engine, Safe to Spend, Claude, Open Banking, household, forecasting, gamification, or later-phase functionality has started.

### Implemented

- Created an ignored `.env.local` configuration boundary. Real development credentials remain local and untracked; no secret value was printed, logged, committed, or pushed. Local Auth.js uses `AUTH_URL=http://localhost:3001` and the registered Google callback `http://localhost:3001/api/auth/callback/google`.
- Added a real Auth.js Google sign-in page, protected onboarding pages, Auth.js sign-out action, MongoDB database sessions, and a server-derived actor boundary. There is no fallback provider, mock session, hardcoded user, or fake sign-in.
- Added a Financial OS-specific Auth.js cookie namespace. This prevents PKCE, state, CSRF, callback, and session cookies from colliding with another Auth.js application on the same `localhost` hostname but a different port, while retaining `__Secure-`/`__Host-` prefixes for HTTPS.
- Bound the Auth.js adapter to the configured Financial OS database and namespaced its collections as `authUsers`, `authAccounts`, `authSessions`, and `authVerificationTokens`. This prevents the adapter's default `accounts` collection from colliding with the financial accounts capability.
- Google sign-in requests explicitly show the account chooser so two real Google identities can be exercised without relying on a previously selected account.
- Added a one-profile-per-user model with display name, country, primary currency, IANA timezone, household type, optimistic versioning, resumable onboarding state, completion timestamp, and entity-local audit trail.
- Added manual onboarding for income, accounts, credit cards, recurring expenses, loans/debts, safety margin, and goals, including create/list/update/delete APIs, create/list/delete UI, reload/resume behavior, review counts, and explicit completion of sections that do not apply.
- Added capability-separated MongoDB collections: `profiles`, `incomeSources`, `accounts`, `creditCards`, `recurringExpenses`, `loans`, `safetyMargins`, and `goals`.
- Added repository-owned `userId` predicates for every read/update/delete, immutable server-derived ownership on inserts, optimistic concurrency, active-record filtering, a 100-record onboarding list bound, and user-prefixed indexes.
- Added exact decimal-major-unit parsing to `bigint` minor units, ISO-style currency tagging, runtime ISO/`Intl` minor-unit precision, BSON `Long` persistence, and profile-primary-currency enforcement. Financial values never pass through binary floating-point parsing.
- Added strict Zod schemas and invariants for all Phase 1 record types, including loan/currency constraints, certainty/interest basis points, billing days, dates, priorities, and one active safety margin per user.
- Added exact-origin mutation checks, JSON-only 16 KB body limits enforced on actual bytes, MongoDB-backed per-actor mutation rate limits with hashed actor keys, safe typed errors, correlation IDs, and no-store API responses.
- Added entity-local atomic audit events for create/update/delete and soft deletion for ordinary onboarding record removal. Future full-account privacy erasure remains a separate hard-deletion operation.

### Infrastructure and acceptance gate

| Dependency/invariant | Result | Verified evidence |
| --- | --- | --- |
| Real MongoDB availability | Verified locally | MongoDB 8.3.2 at `mongodb://127.0.0.1:27017` returned `ping: 1`. |
| Real MongoDB persistence | Verified locally | Four integration files used randomly suffixed databases and persisted profiles, onboarding state, BSON `Long` money, manual records, audit events, soft deletion, and rate-limit counters. |
| Previously skipped MongoDB ownership-isolation test | Passed | Real-local-Mongo `npm run test:integration`: 4 files passed, 5 tests passed, no skip. This includes the original generic ownership test. |
| Repository ownership isolation | Verified | Real MongoDB tests deny constructed cross-owner access; a second real Auth.js database session also received an empty account list and a forged update against the first user's account was rejected with `409 CONFLICT`, leaving the record unchanged. |
| Isolated test cleanup | Verified by test teardown | Every integration suite drops its random database in `afterAll`; the infrastructure-gate database-prefix check previously found no leftovers. |
| Google OAuth callback verification | Passed with real Google | Two distinct interactive Google sign-ins completed through the registered port-3001 callback. The initial PKCE collision was reproduced, diagnosed from server logs, fixed with project-specific cookies, and then retested successfully. |
| Auth.js database session verification | Passed with real MongoDB | The configured database persisted two Google-linked Auth.js users/accounts. Each login created an opaque database session linked by MongoDB `ObjectId`; sign-out removed the session. |
| Per-user authenticated identity verification | Passed | The two logins resolved to different persisted Auth.js user IDs. Protected pages opened only with a live session and redirected to `/sign-in` after invalidation. |
| End-to-end server-derived ownership verification | Passed | Profile POSTs contained no client owner ID. For both real sessions, the stored profile owner and create-audit actor exactly matched the Auth.js session user ID. |
| Two authenticated users' isolation verification | Passed | Before its own writes, the second user saw zero income/accounts and did not receive the first user's labels. Direct cross-owner mutation was denied; MongoDB retained two profiles with two distinct owners. |
| Real sign-out and invalidation | Passed twice | Auth.js sign-out removed the database session; the signed-out browser was redirected from a protected route. Final configured-database counts were zero sessions, two auth users/accounts, and two separately owned profiles. |
| Authenticated Playwright onboarding journey | Passed with a real session | The in-app Playwright browser completed the first user's profile plus all seven manual sections, verified reload/resume, reviewed one record per section, completed onboarding, and signed out. No mocked auth or stored test session was used. |

### Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Credential-free regression suite | Pass with explicit infrastructure skips | `npm test`: 11 files passed, 4 integration files skipped; 59 tests passed, 5 skipped. The new cookie/database namespace tests are included; `.env.local` is intentionally not auto-promoted into the test process. |
| Real-local-Mongo integration suite | Pass | Environment-scoped `npm run test:integration`: 4 files passed, 5 tests passed. Tests use randomly suffixed databases and real MongoDB 8.3.2. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; all profile, onboarding, review, auth, and health routes compiled. |
| Dependency audit | Pass | `npm run security:audit`: 0 vulnerabilities after registry access was permitted. |
| Production runtime/security smoke | Pass | On port 3001 after the final build: root 200, sign-in 200, signed-out protected profile 307 to `/sign-in`, `Cache-Control: no-store`, CSP present, `X-Powered-By` absent, frame denial and MIME-sniff protection present. Port 3000 remained independently listening and was not modified. |
| Environment and secret safety | Pass | `.env.local` is ignored and absent from Git's tracked index; required real-auth fields are present without their values being displayed; `AUTH_URL` is exactly port 3001. Tracked secret-pattern review found only the intentional angle-bracket credential URI in `.env.example`, not a credential. |
| GitHub synchronization | Pass | `origin` is `https://github.com/Shmuel5252/financial-os.git`; local `main`, its upstream, and GitHub's advertised `main` matched with ahead/behind `0/0` after the acceptance commit was pushed. |

### Phase 1 acceptance review

| Acceptance criterion | Result |
| --- | --- |
| Real user can sign in/out with Google | Accepted: two distinct real callbacks; real sign-out/session invalidation verified |
| Auth.js user/account/session persistence | Accepted in the configured MongoDB database with namespaced collections |
| Persist/resume/finish manual profile | Accepted: authenticated Playwright journey completed all Phase 1 sections and reload/resume |
| Two users cannot access each other | Accepted: authenticated empty reads, cross-owner mutation denial, and distinct database owners verified |
| No fake auth path | Accepted and code/runtime verified |
| Financial precision, validation, audit, rate limits, ownership predicates | Implemented; unit and real-Mongo integration gates pass |
| First authenticated Playwright journey | Accepted with a real Google/Auth.js session; no mocked path or committed auth state |

**Acceptance conclusion:** Phase 1 is fully implemented and its real-authentication acceptance gate passed. The complete regression, real-Mongo, type, lint, production-build, dependency-audit, runtime-security, environment, and Git-secret checks passed. Phase 2 has not started and requires explicit owner approval.

### Residual operational note

Before the adapter was bound to `MONGODB_DB_NAME`, the first diagnostic OAuth attempt wrote an orphaned Auth.js record set to the URI's default database. The active Financial OS configuration cannot read that record set, its browser cookie has been replaced/removed, and current sessions use the configured namespaced collections. It was not deleted because the default database may be shared with the separate port-3000 application; targeted cleanup requires explicit ownership confirmation or expiry. No secret or record identifier is documented here.

### Exact next milestone

Wait for explicit approval before Phase 2 — Core financial data foundation. Do not begin it automatically.

## Phase 0 — Foundation

**Status:** Complete and accepted for the credential-free Phase 0 scope

**Started:** 2026-08-30

**Verified:** 2026-08-30

**Scope boundary:** Phase 0 only. No Phase 1 onboarding, financial profile, financial collection, dashboard, or Safe to Spend implementation was started.

### Workspace inspection

- Confirmed project root: `C:\Users\USER\Projects\financial-os`.
- Initial workspace contained only `FINANCIAL_OS_MASTER_PROMPT.md` (32,759 bytes).
- The complete source text was read before changes and preserved in `MASTER_PLAN.md`; normalized text comparison returned `True`.
- No nested `financial-os` directory was created; final check returned `False`.
- No `AGENTS.md` or other repository instructions were present.
- Git was not initialized; a repository was initialized directly at the root on branch `main`.
- The sandbox process and workspace owner differ, so Git inspection uses a per-command safe-directory override. No global Git trust setting was weakened.

### Implemented

- Next.js 16 App Router application with React 19, strict TypeScript, Tailwind CSS 4, a restrained Phase 0 landing page, a liveness route, and production security headers.
- Exact dependency lockfile and a credential-free CI workflow covering audit, tests, type-check, lint, and production build.
- Server-only Zod environment parsing, placeholder rejection, production HTTPS origin validation, readiness boundaries, and `.env.example`.
- MongoDB 6 client architecture with lazy configuration validation, connection reuse, bounded selection timeout, named application client, and safe dependency errors.
- Auth.js/NextAuth 5 foundation with Google provider, MongoDB adapter, database sessions, secure-cookie selection, server session access, and explicit 503 behavior when credentials are absent. No fake authentication exists.
- Server-derived `Actor`, future household scope shape, ObjectId validation, ownership-enforcing filters, and insert ownership override for the Data Access Layer foundation.
- Canonical money value object using signed int64-range `bigint` minor units, ISO-style currency codes, string JSON transport, same-currency arithmetic, and half-even ratio rounding.
- Strict UTC instant, calendar-date, and IANA-timezone validation.
- Typed safe-error mapping and reusable Zod request validation.
- External-adapter boundary documentation for Claude, Open Banking, notifications, and monitoring without pretending those integrations exist.
- Required planning records: `MASTER_PLAN.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `PROGRESS.md`, and `DECISIONS.md`.

### Important files

- Product/engineering records: `MASTER_PLAN.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`
- Runtime/config: `src/app/`, `next.config.ts`, `src/lib/config/server-env.ts`, `.env.example`
- Authentication/authorization: `src/lib/auth/`, `src/lib/authorization/`, `src/lib/data-access/`
- Database: `src/lib/db/mongodb.ts`
- Domain foundation: `src/lib/domain/money/money.ts`, `src/lib/domain/time/financial-time.ts`
- Safety/error boundaries: `src/lib/errors/`, `src/lib/validation/`, `src/lib/adapters/README.md`
- Verification: `tests/`, `vitest.config.mts`, `.github/workflows/ci.yml`

### Verified results

| Check | Result | Evidence |
| --- | --- | --- |
| Unit/available integration tests | Pass with one explicit external-infrastructure skip | `npm test`: 5 files passed, 1 skipped; 33 tests passed, 1 skipped. |
| MongoDB isolation integration | Blocked, not claimed | `mongodb-isolation.integration.test.ts` skipped because `MONGODB_TEST_URI` is absent. |
| Strict type-check | Pass | `npm run typecheck`: exit 0. |
| Lint | Pass | `npm run lint`: exit 0 with `--max-warnings=0`. |
| Production build | Pass | `npm run build`: exit 0; static root plus dynamic auth/health routes generated. |
| Dependency audit | Pass | Final `npm audit --audit-level=low`: 0 vulnerabilities. |
| Dependency tree | Pass | Patched `@auth/core@0.41.3` resolves through Auth.js beta.32; no invalid required peer dependency. |
| Production runtime smoke | Pass | Root 200, expected page content, `/api/health` 200, unconfigured auth 503. |
| HTTP security baseline | Pass | CSP, frame denial, MIME sniff prevention, strict referrer policy, restrictive permissions policy, and no `X-Powered-By` header verified at runtime. |
| Secret scan | Pass | No API-key, credential-bearing MongoDB URI, or private-key patterns found after removing a test-only false positive. |
| Environment ignore rules | Pass | `.env`, `.env.local`, and `.env.production` ignored; `.env.example` explicitly allowed. |
| Build artifact hygiene | Pass | `node_modules/`, `.next/`, and `tsconfig.tsbuildinfo` ignored. |
| Final Git status | Pass | Branch `main` is clean after two coherent Phase 0 milestone commits; only the expected generated paths above are ignored. |
| Master Plan preservation | Pass | Normalized source and `MASTER_PLAN.md` text are identical. |

### Security review

- The initial dependency audit exposed two critical Auth.js-core advisories in stable NextAuth 4.24.15. It was not accepted or force-fixed. Auth moved to exact beta.32, which resolves patched core 0.41.3 and is compatible with Next 16/React 19; the final audit is clean.
- ESLint 10.9.1 was trialed because ESLint 9 is upstream-deprecated, but the React plugin bundled by the current Next lint config crashes under ESLint 10. The project retains exact ESLint 9.39.5 with a clean audit and full rules enabled.
- Production `AUTH_URL` must be HTTPS; copied angle-bracket placeholders are rejected rather than treated as configured.
- Secrets and database/auth/provider modules are server-only. No `NEXT_PUBLIC_` secret variables exist.
- Auth capability readiness requires the exact origin, secret, Google credentials, MongoDB URI, and database name. Without them the auth endpoint returns 503 and does not create a development user.
- User ownership is derived from the server session and overwrites client-provided ownership at inserts. Owned document filters include both resource ID and owner.
- HSTS is intentionally deferred until an HTTPS deployment is configured so local HTTP is not incorrectly advertised as transport-secure. A nonce-based CSP and full rate limiting remain production-hardening work.

### Credentials and external verification still required

- **MongoDB:** Provide `MONGODB_URI` and `MONGODB_DB_NAME` for a least-privilege development database. Provide isolated `MONGODB_TEST_URI` and `MONGODB_TEST_DB_NAME` to run the real ownership integration test.
- **Google OAuth/Auth.js:** Generate `AUTH_SECRET`, set exact `AUTH_URL`, and provide `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Register `${AUTH_URL}/api/auth/callback/google`, then verify real sign-in, persisted user/account/session records, secure cookies over HTTPS, and sign-out before Phase 1 claims operational authentication.
- **Vercel:** No project or credentials were available. Connect the repository, configure the same server-only variables separately for preview/production, and run the pipeline/deployment smoke checks before claiming a deployment.
- **Anthropic:** `ANTHROPIC_API_KEY` is only a documented future placeholder. Claude is deliberately not integrated in Phase 0.
- **Open Banking:** Provider/client/webhook placeholders exist, but no provider is selected and no tokens or banking credentials exist. Provider selection, legal review, encryption, consent, and sandbox verification are deferred to Phase 9.

### Important decisions

See `DECISIONS.md`, ADR-001 through ADR-015. The central decisions are bigint integer-minor-unit money, explicit currency/conversion boundaries, UTC instants plus local calendar dates, server-derived actors, owner-scoped DAL predicates, separate capability collections, lazy server-only environment validation, deterministic engine truth, and provider adapters.

### Unresolved issues

- Supported currencies and their input precision need product definition before onboarding accepts money.
- Safe to Spend horizon, uncertainty, event-ordering, and safety policies require Phase 3 product/engineering approval and fixtures.
- Audit retention versus complete account deletion requires legal/privacy input.
- Household private/shared semantics are resolved and verified in Phase 11. The licensed Open Banking provider remains undecided and Phase 9 remains blocked.
- Auth.js beta and ESLint 9 compatibility exceptions must be revisited when patched stable/compatible upstream releases exist.

### Deferred work

All user-facing financial functionality, real financial collections/repositories, persistent audit logs, onboarding, complete authentication verification, rate limiting, E2E browser journeys, deterministic Financial Engine/Safe to Spend, Vercel deployment, Claude, Open Banking, notifications, households, monitoring, backups, and production privacy/legal controls remain in their planned phases.

### Phase 0 acceptance review

| Master Plan outcome | Acceptance |
| --- | --- |
| Next.js, TypeScript, Tailwind, clean structure | Accepted and build-verified |
| MongoDB connection architecture and DAL foundation | Accepted; live connection test blocked by missing test URI |
| Authentication foundation | Accepted as a real Google/MongoDB boundary; operational OAuth blocked by missing credentials |
| Server authorization and user isolation pattern | Accepted with unit tests; real MongoDB negative test remains explicitly skipped |
| Zod, money, dates, environment, secrets, errors | Accepted and tested |
| Git hygiene and dependency hygiene | Accepted after ignore/secret/audit review |
| Test, type, lint, production build | Accepted with exact results above |
| Architecture, roadmap, progress, decisions | Accepted |
| No Phase 1 work | Confirmed |

**Acceptance conclusion:** Phase 0 is complete for everything safely verifiable without external credentials. Credential-dependent operational integrations are precisely blocked and are not represented as successful. Work stops here.

### Exact next milestone

Phase 1 — Identity, profile, and manual onboarding. It may begin only after this Phase 0 review and must first verify real Google OAuth/MongoDB persistence in an isolated environment.
