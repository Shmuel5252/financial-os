# Financial OS Implementation Plan

## Roadmap rules

`MASTER_PLAN.md` is authoritative. Work advances only after the active phase passes its acceptance review. Security, user isolation, deterministic money handling, data integrity, and Hebrew-first/RTL-first product behavior are cross-phase gates. Every new Financial OS-controlled surface must use the localization boundary, natural Hebrew copy, RTL layout, and explicit LTR isolation for inherently LTR values. A folder, mock, or UI shell is not an implemented capability. Credentials may block live verification, but they do not justify fake integrations.

The original Phase 0 through Phase 20 order is preserved. Internal scope is clarified below; no product dependency is reordered.

## Phase 0 — Production foundation

- **Objective:** Establish a secure, testable Next.js foundation without implementing product features.
- **Scope:** App Router, TypeScript, Tailwind, MongoDB connection/DAL boundary, Auth.js Google boundary, authorization primitives, Zod, money/date/error conventions, environment handling, Git hygiene, documentation, and test/build gates.
- **Dependencies:** Node.js, npm registry for packages; no external credentials required for build-time verification.
- **Major tasks:** Initialize in the repository root; create architecture/roadmap/decision/progress records; implement server-only config, database, auth, ownership, validation, domain primitives, status UI/API, and tests.
- **Data/model implications:** No speculative financial collections. Define IDs, ownership, timestamps, money, source, deletion, and audit conventions.
- **Security:** Ignore `.env*`; no fake user; no client secrets; secure session architecture; safe errors; ownership predicates; dependency audit.
- **Testing:** Unit tests for money, dates, config, errors, and authorization; lint; strict type-check; production build. Real infrastructure tests are documented as blocked if credentials are absent.
- **Acceptance criteria:** Every Phase 0 outcome in the Master Plan is present or precisely blocked; all credential-free gates pass; Git status contains no secret/unintended artifact.
- **Definition of done:** `PROGRESS.md` and `DECISIONS.md` contain actual evidence, acceptance review passes, and work stops before Phase 1.
- **Risks/migration:** Early abstractions becoming speculative; incompatible Auth/Mongo versions; build accidentally requiring secrets. Mitigate with narrow ports, peer checks, and lazy runtime config.

## Phase 1 — Identity, profile, and manual onboarding

- **Objective:** Let a real authenticated user establish a complete manual financial profile.
- **Scope:** Verified Google sign-in/out, user profile, onboarding state, locale/currency/timezone/country/household type, manual income/accounts/cards/loans/expenses/safety margin/goals entry.
- **Dependencies:** Phase 0; Google OAuth and isolated MongoDB environments.
- **Major tasks:** Auth callback verification, profile/onboarding schemas and services, resumable flow, deletion/recovery policy groundwork, initial manual CRUD with ownership enforcement.
- **Data/model implications:** Create only required profile and onboarding-owned collections; add user-prefixed indexes and audit mutations.
- **Security:** Real server sessions; CSRF/cookie/origin checks; object-level authorization; rate limits for auth/mutations; no client owner IDs.
- **Testing:** Auth/database integration, cross-user negatives, onboarding validation, first Playwright journey, delete/sign-out behavior appropriate to scope.
- **Acceptance criteria:** Two test users cannot access each other; a new user can sign in and persist/resume/finish a manual profile; no fake auth path.
- **Definition of done:** Real credentials verified in a non-production environment, migrations/indexes documented, all gates pass.
- **Risks/migration:** OAuth callback mismatch, partial onboarding, unsupported currency precision, privacy retention decisions.

## Phase 2 — Core financial data foundation

**Acceptance status (2026-08-31): Complete and verified.** The implementation reuses Phase 1 source collections, adds transactions/recurrence/savings/source-manifest snapshots, and passed the full real-Mongo, authenticated browser, type, lint, build, audit, security, ownership, precision, and Hebrew/RTL gates recorded in `PROGRESS.md` and `DECISIONS.md`.

- **Objective:** Provide reliable manual financial records as a first-class product source.
- **Scope:** Accounts, transactions, recurring transactions, incomes, expenses, credit cards, loans/debts, savings, and financial snapshot storage (not final calculations).
- **Dependencies:** Phase 1 identity/profile conventions.
- **Major tasks:** Capability repositories/services/routes/forms, pagination, idempotency keys, source metadata, recurring definitions, audit entries, baseline snapshot schema.
- **Data/model implications:** Separate collections; BSON int64 money mapping; immutable ownership; concurrency/version fields and user-prefixed indexes.
- **Security:** Ownership on every operation/aggregate, mutation audit, input size limits, safe exports.
- **Testing:** CRUD/invariant tests, duplicate/idempotency cases, cross-user access, mapping and index integration tests, manual-data E2E.
- **Acceptance criteria:** Authorized users can maintain complete manual source data consistently and reload it without precision loss.
- **Definition of done:** Schemas, indexes, services, audit behavior, and recovery from expected conflicts are verified.
- **Risks/migration:** Duplicate concepts across income/transactions, recurrence ambiguity, giant-document drift, backward-compatible schema evolution.

## Phase 3 — Deterministic financial engine

**Policy gate approved (2026-08-31):** Default rolling 30-calendar-day explicit horizon; only 100%-confirmed income may increase core Safe to Spend; uncertain income remains separate; percentage Safety Margin uses confirmed income in the applicable user-timezone calendar month with exact half-even minor-unit rounding; same-day obligations precede income when no reliable timestamp exists.

**Acceptance status (2026-08-31): Complete and verified.** The versioned pure engine and owner-scoped snapshot orchestration pass 83 unit tests and 13 real-Mongo integration tests as part of the 96-test full suite, plus strict type, lint, production-build, runtime security, and dependency-audit gates recorded in `PROGRESS.md`.

- **Objective:** Produce tested cash flow, timeline, future balance, safety margin, monthly metrics, and Safe to Spend as financial truth.
- **Scope:** Pure engine and snapshot orchestration; no AI calculation.
- **Dependencies:** Phase 2 normalized financial data; the approved horizon, uncertainty, margin-basis, and same-day-order policies recorded above.
- **Major tasks:** Define typed inputs/outputs; recurrence expansion; event ordering; minimum-future-balance algorithm; deterministic rounding; versioned snapshot calculation.
- **Data/model implications:** Persist engine/version/as-of/input-hash outputs; source records remain truth inputs.
- **Security:** Services load only authorized data; snapshots are owned; logs omit raw data.
- **Testing:** Fixture-heavy unit/property tests for negative balances, ordering, cards, installments, uncertain/missing/duplicate data, month/DST/rounding boundaries, and safety violations.
- **Acceptance criteria:** Safe to Spend responds to the full timeline, preserves money invariants, and is reproducible from the same inputs.
- **Definition of done:** Algorithm/policy documented, independently reviewed, versioned, and covered by deterministic edge cases.
- **Risks/migration:** Incorrect event ordering or confidence policy; historic snapshots need engine-version compatibility.

## Phase 4 — Financial dashboard

**Acceptance status (2026-08-31): Complete and verified.** The dashboard reconciles exclusively to Phase 3 snapshots, detects stale source/profile/calendar state, bounds client payloads, and passed the 101-test real-Mongo suite, authenticated browser journey, type, lint, production-build, runtime-security, Hebrew/RTL, accessibility, and dependency gates recorded in `PROGRESS.md`.

- **Objective:** Answer the user's current position, forecast, safe spend, and goal-direction questions within seconds.
- **Scope:** Real Safe to Spend, balances, upcoming events, 7/14/30-day timeline, alerts, goals, and summaries from engine snapshots.
- **Dependencies:** Phase 3 engine outputs and Phase 2 source data.
- **Major tasks:** Dashboard query service, stale-state behavior, accessible responsive presentation, empty/error/loading states, freshness indicators.
- **Data/model implications:** Read models/cache metadata only when justified; never duplicate calculation logic in UI.
- **Security:** Server-render authorized views; minimize client payload; prevent cache sharing between users.
- **Testing:** Query/view-model unit tests, snapshot integration, responsive/accessibility and E2E dashboard journeys.
- **Acceptance criteria:** Values reconcile to engine fixtures and explain why Safe to Spend changed.
- **Definition of done:** Dashboard is useful with manual data, handles stale/missing data honestly, and passes UI/accessibility gates.
- **Risks/migration:** Cached cross-user data, misleading stale snapshots, UI-calculated totals.

## Phase 5 — Budgets and monthly allocation

- **Status (2026-08-31):** Complete and objectively verified; accepted under the authorized autonomous progression rule.
- **Approved product policy (2026-08-31):** Hybrid stable-ID system/custom categories; confirmed-income-only real allocation; uncertain income isolated to scenarios; visible negative unallocated deficits; per-category rollover with `reset` default; actual-period refund recognition; immutable correction evidence; uncategorized cash truth; and deterministic, strictly separated core/scenario forecasts.
- **Objective:** Support category budgets, forecasts, zero-based allocation, and monthly planning.
- **Scope:** Categories, budget/spent/remaining/forecast, income roles, unallocated balance.
- **Dependencies:** Transactions, engine monthly metrics, profile timezone/currency.
- **Major tasks:** Budget services, category rules, month rollover, allocation invariants, dashboard integration.
- **Data/model implications:** User-owned budget periods/items and category mappings; immutable period history where needed.
- **Security:** Ownership on budget/category/transaction aggregates and audit on plan changes.
- **Testing:** Allocation conservation, over-budget/negative/refund/month-boundary cases, E2E monthly plan.
- **Acceptance criteria:** Verified. Budget figures reconcile exactly with source transactions; allocations conserve confirmed income as an explicit signed unallocated amount; refunds, corrections, rollover, uncategorized activity, and scenario separation passed deterministic and real-Mongo checks.
- **Definition of done:** Met. Current and historical months are stable, explainable, owner-isolated, and user-editable within policy; the authenticated Hebrew/RTL production journey passed on port 3001.
- **Risks/migration:** Preserve original transaction/category facts and closed-period evidence while presenting auditable corrected reports; never let rollover, refunds, uncertain income, or scenario values contaminate another period or confirmed financial truth.

## Phase 6 — Goals and measurable progress

- **Approved product policy (2026-08-31):** Versioned deterministic per-type metrics and explicit record scopes; preserved manual versus verified baselines; direction-aware exact progress, regression, over-target values, and immutable milestones; point-in-time versus explicit sustained-success lifecycle with a 30-calendar-day default; material goal versioning; append-only explainable progress evidence; and strict separation of verified progress from scenario/projection outcomes.
- **Objective:** Make goals financial objects with baselines, targets, deadlines, trends, and actions.
- **Scope:** Goal definition activation/versioning, deterministic canonical metrics, milestones, immutable progress history, current goal dashboard and analytics. Phase 7 purchase simulation, Phase 12 advanced goal projection, AI guidance, bank/investment integrations, notifications, and gamification remain out of scope.
- **Dependencies:** Engine metrics, debt/savings/account data, budgets where relevant.
- **Major tasks:** Goal policy strategies, owned-scope validation, Phase 1 goal migration/provenance, direction-aware progress calculation, lifecycle/milestones, material definition versioning, meaningful evaluation orchestration, snapshot/budget linkage, Hebrew/RTL goal management and analytics.
- **Data/model implications:** Preserve Phase 1 `goals`; add immutable owner-scoped goal definitions/versions and append-only progress evidence keyed by goal/version plus engine/budget provenance. Exact money remains BSON int64 and JSON strings.
- **Security:** Authorized goal inputs and outputs; audit edits/deletion; avoid sensitive detail in notifications.
- **Testing:** Each goal strategy, zero/negative targets, deadlines, regressions, completion/reopen semantics.
- **Acceptance criteria:** Verified. Progress is calculated from deterministic owned records rather than self-reported UI totals where measurable; manual/unverified goals are explicit; history explains baselines, versions, milestones, completion, sustained confirmation, regression, and reopen without scenario contamination.
- **Definition of done:** Met. Users can activate/version supported goals, trigger meaningful deduplicated evaluations, and see Hebrew/RTL current and historical explainable verified progress; real-Mongo isolation and authenticated production-browser acceptance passed.
- **Risks/migration:** Goal definitions drifting; historical progress recomputation and baseline changes.

## Phase 7 — Purchase impact simulation

**Approved product policy (2026-09-01):** Deterministic confirmed-cash `SAFE`/`CAUTION`/`UNSAFE` thresholds with exact boundary behavior; entered amount as total price; exact one-time/monthly schedules with earliest-installment remainder allocation; explicit provenance-bearing interest/fees; explicit rolling 30-day evaluation under Phase 3 policy; earliest `SAFE` date only within a 90-calendar-day search; freshness separate from risk; and ephemeral-by-default simulations with immutable owner-scoped persistence only on explicit save. Saving never creates or changes financial truth.

**Acceptance status (2026-09-01): Complete and verified.** The pure simulator, owner-scoped immutable save boundary, shared freshness semantics, Hebrew/RTL journey, and non-mutation guarantees passed 116 unit tests, 25 real-Mongo integration tests, the 141-test full suite, authenticated production-browser verification, strict type/lint/build, offline dependency audit against the unchanged Phase 6 dependency graph, and security/secret/Git gates recorded in `PROGRESS.md`.

- **Objective:** Evaluate a proposed purchase as SAFE, CAUTION, or UNSAFE against the timeline.
- **Scope:** One-time/monthly-installment total-price inputs, explicit interest/fees, recalculated rolling evaluation timeline, deterministic safety-margin impact/classification, source freshness, earliest-safe-date search, ephemeral results, and explicit immutable saves.
- **Dependencies:** Versioned Phase 3 engine and current source snapshot.
- **Major tasks:** Isolated scenario inputs, policy thresholds, explanation codes, persistence only on explicit user choice.
- **Data/model implications:** Immutable owned saved-simulation records reference the Phase 3 snapshot and applicable budget period, preserve exact inputs/schedule/results/versions/freshness, and never mutate truth. Unsaved results create no simulation record.
- **Security:** Authorized snapshot loading, input limits, no cross-user scenario access.
- **Testing:** Boundary thresholds, alternative dates, installments, stale source data, invariant that source records remain unchanged.
- **Acceptance criteria:** Verified. Results reproduce and reconcile with a hypothetical engine timeline; exact schedules conserve true financed cost; boundary classifications and 90-day search obey policy; stale state is separate and explicit; saves remain isolated and non-mutating.
- **Definition of done:** Met. Honest Hebrew/RTL status, explanation, timeline, charge provenance, freshness, and explicit-save evidence are shown with no hardcoded outcomes or simulated values contaminating financial truth.
- **Risks/migration:** Users interpreting estimates as guarantees; policy and stale-data communication.

## Phase 8 — Claude financial copilot

**Approved product/security policy (2026-09-01):** Purpose-specific context minimization; deterministic server-side redaction; strict forbidden-secret/auth/card-data exclusions; identifier minimization; untrusted-text prompt-injection boundaries; owner-scoped and deletable minimal conversation history; metadata-only safe telemetry; redacted failures; server-derived per-user isolation; no hidden financial mutations; and a provider-neutral server-only Anthropic adapter. Deterministic Financial OS services remain the only source of numerical truth.

- **Objective:** Explain structured financial truth conversationally without delegating calculations to AI.
- **Scope:** Anthropic adapter, schema-validated structured context, chat, Safe to Spend explanation, purchase/goal/monthly guidance, FACT/INSIGHT/RECOMMENDATION separation.
- **Dependencies:** Engine/simulation snapshots; Anthropic API key and, for an identity-linked multi-workspace key, explicit server-only workspace selection; privacy/redaction policy.
- **Major tasks:** Prompt contracts, tool calls to deterministic services, context minimization, output schemas, refusal/failure UX, usage controls.
- **Data/model implications:** Owned conversations/messages, snapshot references, retention controls; never credentials.
- **Security:** Server-only key, prompt-injection defenses, authorization before context assembly, redaction, rate/cost limiting.
- **Testing:** Adapter contract and schema failures, hostile prompts, hallucinated-number rejection, privacy and E2E explanations.
- **Acceptance criteria:** Verified. Every displayed financial value traces to cited actor-owned deterministic evidence; provider-generated numerical text and foreign/missing evidence references fail closed.
- **Definition of done:** Met. Real Anthropic and authenticated Hebrew/RTL production-browser paths passed; provider failure cannot create partial history, corrupt canonical records, or replace financial truth, and outputs remain clearly separated into fact, insight, and recommendation.
- **Risks/migration:** Privacy, hallucination, token cost, model changes, retention consent.

## Phase 9 — Open Banking

**Status (2026-09-01): BLOCKED and unaccepted.** No Phase 9 implementation exists. The licensed provider, jurisdiction/legal review, consent policy, token-encryption/KMS design, and official Integration/Sandbox access are unresolved. The approved Phase 10 execution-order exception does not waive, mock, redefine, or partially accept any Phase 9 criterion.

- **Objective:** Synchronize consented bank data through a licensed provider while preserving manual mode.
- **Scope:** Consent, connections, accounts/balances/transactions/cards, normalization, deduplication, pending/modified events, sync status/errors/expiry.
- **Dependencies:** Selected licensed provider, legal/security review, normalized Phase 2 domain, token encryption/key management.
- **Major tasks:** Provider adapter, webhook verification, idempotent sync jobs, reconciliation UX, disconnect/revoke, backoff/recovery.
- **Data/model implications:** Connections, encrypted tokens, sync runs, provider references, normalized source metadata; no bank username/password.
- **Security:** Least-scope consent, encryption, webhook signatures, SSRF/rate protections, credential redaction, revocation/deletion.
- **Testing:** Provider sandbox contracts, replay/duplicate/modified/pending data, expiry/outage, manual-bank merge, isolation.
- **Acceptance criteria:** Repeated sync is idempotent and reconciled data feeds the same engine as manual data.
- **Definition of done:** Sandbox and staged operational run verified with monitoring/runbook.
- **Risks/migration:** Provider lock-in, consent regulation, duplicate truth, downtime and schema drift.

## Phase 10 — Transaction intelligence

**Status (2026-09-01): Complete and verified.** The deterministic engine, immutable runs/reviews, explicit correction path, owner isolation, labelled quality fixture, authenticated Hebrew/RTL review journey, complete regression, production build, and security gates passed. This acceptance does not change Phase 9's blocked status or imply Open Banking provenance.

**Execution-order exception approved (2026-09-01):** Phase 10 may be implemented and accepted over the existing provider-neutral manual transaction history while Phase 9 remains visibly blocked. This is not a roadmap redesign and cannot be represented as Open Banking progress.

**Approved implementation policy (2026-09-01):** A deterministic versioned rules engine is the first prediction implementation. Raw transaction facts remain immutable; normalized merchants, category suggestions, confidence, and recurring/subscription/duplicate/anomaly signals are separate evidence. Nothing is auto-applied. Category confirmation is an explicit authenticated action through existing immutable correction evidence; other review decisions remain append-only. Runs are explicit, bounded, owner-scoped, retry-safe, and do not mutate core financial truth. Quality claims are limited to measured deterministic fixtures and conservative thresholds.

- **Objective:** Normalize merchants, suggest categories, detect recurring/subscriptions and anomalies while preserving user confirmation.
- **Scope:** AI/rule predictions, confirmed categories, recurring detection, subscriptions, duplicate/unusual/increase signals.
- **Dependencies:** Sufficient transaction history and provider-neutral records.
- **Major tasks:** Prediction interfaces, confidence/versioning, correction feedback, deterministic fallbacks, review queue.
- **Data/model implications:** Immutable owner-scoped analysis runs and append-only review evidence remain separate from confirmed transaction facts; engine/rule/policy version, exact input hash, confidence basis points, and bounded evidence are recorded.
- **Security:** Minimize external context, authorize all data, protect merchant details, abuse/cost controls.
- **Testing:** Known merchants, corrections, low confidence, false positives, duplicate signals, model outage.
- **Acceptance criteria:** Suggestions never silently overwrite confirmed user truth, explicit category confirmation appends auditable correction evidence, review decisions are reversible/explainable, and analysis cannot mutate balances, transactions, budgets, engine snapshots, Safe to Spend, goals, or Open Banking state.
- **Definition of done:** Conservative deterministic quality thresholds are measured against labelled fixtures; real-Mongo ownership/isolation and authenticated Hebrew/RTL review behavior pass; failure leaves core finance usable.
- **Risks/migration:** Biased/unstable classifications and feedback-data privacy.

## Phase 11 — Households and permissions

**Status (2026-09-01): Complete and accepted.** Individual ownership remains immutable, all resources are private by default, and sharing is an explicit per-household authorization grant. The initial roles are owner/member only. Invitation, removal/leave, dissolution, audit, derived-data, direct-ID, and Copilot-isolation rules are resolved by ADR-043/044 and verified by unit, real-Mongo, authenticated-browser, security, and regression gates.

**Initial implementation boundary:** Phase 11 implements households, owner/member membership, secure seven-day single-use email-bound invitations, audited lifecycle, and explicit sharing of existing individually owned accounts and verified goal definitions. It provides shared-only exact account totals and verified-goal views. It does not create household-owned financial truth, household Safe to Spend, a second budget/goal engine, Open Banking provenance, or AI-computed household values. Future true household-owned budgets/goals require an explicit lifecycle/versioning policy before introduction.

- **Objective:** Support owner/member collaboration with explicitly shared and private resources. A viewer role remains deferred.
- **Scope:** Household creation/invites/membership/revocation, owner/member roles, explicit shared accounts/verified goals, shared-only derived summary, partner UX.
- **Dependencies:** Product-approved visibility semantics and mature user-scoped repositories.
- **Major tasks:** Central policy evaluator, invitation lifecycle, resource scope migration, access review, revocation propagation.
- **Data/model implications:** `households`, member-only `householdMemberships`, expiring hashed-token `householdInvitations`, and versioned `householdResourceShares`; original resources retain `userId` ownership and private default. Entity-local append-only audit evidence preserves standalone-Mongo atomicity.
- **Security:** Deny-by-default role/resource policies, invite token hygiene, immediate revocation, comprehensive audit.
- **Testing:** Permission matrix, private/shared cases, revoked/expired membership, concurrent role change, anti-enumeration.
- **Acceptance criteria:** Every operation passes a documented permission matrix and cross-household isolation tests.
- **Definition of done:** Sharing is explicit, reversible, audited, and cannot expose pre-existing private data.
- **Risks/migration:** Retrofitting ownership and ambiguous data after a member leaves.
- **Verified result (2026-09-01):** Complete permission-matrix and strict-command unit tests, six real-Mongo lifecycle/isolation tests, actor-only Copilot context verification, retained-session Hebrew/RTL production-browser acceptance, full real-provider regression, type-check, lint, optimized build, and zero-vulnerability registry audit passed. Removal/leave/dissolution revoke immediately, rejoin cannot revive an old share epoch, original records survive, and no Phase 9 collection or provenance was introduced.

## Phase 12 — Advanced forecast and scenarios

- **Approved product policy (2026-09-01):** Deterministic 7/30/60/90-day operational forecasts (30-day default); explicit confirmed/estimated events; categorical versioned confidence without fake probabilities; Phase 10 review/correction precedence; duplicate prevention; exact projected minima/margin/zero crossings; strict actual/forecast/scenario separation; actor-only household privacy; and deterministic AI authority boundaries.
- **Objective:** Provide 7/30/60/90-day operational forecasts, scenario analysis, uncertain income, estimates, and trends.
- **Scope:** Forecast ranges/confidence and separately persisted what-if income, expense, loan, card, and savings changes. Projections beyond 90 days, if needed later, are labelled planning/scenario outputs rather than operational forecasts.
- **Dependencies:** Timeline engine, history, recurrence/intelligence signals.
- **Major tasks:** Versioned assumptions, confidence models, scenario comparison, explicit as-of state, trend detection.
- **Data/model implications:** Immutable owned forecast/scenario snapshots with assumption, confidence-policy, source, engine, and calculation versions; exact BSON int64 money; no duplicated raw history.
- **Security:** Server-derived actor, actor-only source loading despite household membership, safe bounded views, no client owner selection, and no AI-calculated truth.
- **Testing:** Four horizons, confidence thresholds/degradation, confirmed/estimated separation, duplicate prevention, corrected/dismissed Phase 10 evidence, missing/stale history, month/DST boundaries, exact crossings, same currency/BSON int64, scenario non-mutation, household/two-user isolation, reproducibility, and stress fixtures.
- **Acceptance criteria:** Forecasts disclose assumptions/confidence and scenarios cannot mutate actual data.
- **Definition of done:** Results are deterministic for a given assumption set and reconcile to baseline timeline.
- **Risks/migration:** False precision, data sparsity, expensive recomputation.
- **Verified result (2026-09-01):** Accepted under the execution-order exception. The dedicated Phase 12 suite passed 3 files / 19 tests and the complete final-state suite passed 47 files / 203 tests with real MongoDB and the real Anthropic regression gate. Authenticated Hebrew/RTL production acceptance, exact BSON int64 provenance, owner/household isolation, duplicate/confidence/crossing boundaries, scenario non-mutation, type-check, zero-warning lint, optimized build, and zero-vulnerability registry audit passed. Phase 9 remains blocked and no provider provenance exists.

## Phase 13 — Debt strategies

- **Approved product policy (2026-09-01):** Contract/evidence-first debt terms; no APR-only hidden assumptions; explicit day-count/compounding, allocation, minimum, rate schedule, fees, and prepayment terms where material; `verified`/`assumption_based`/`insufficient_information` status; deterministic baseline/Avalanche/Snowball/custom comparisons with an explicit extra-payment budget; exact same-currency money; immutable explicit saves; actor-only household privacy; and AI explanation-only authority.
- **Objective:** Calculate debt-free dates and compare snowball, avalanche, and custom payoff scenarios.
- **Scope:** Explicit verified/assumption-based debt terms, interest/payment schedules, monthly debt load, baseline/Avalanche/Snowball/custom comparisons, extra-payment simulations, completeness disclosure, and immutable explicit saves. No lender sync, payment execution, debt mutation, AI calculation, or Phase 14 capability.
- **Dependencies:** Accurate debt models, timeline engine, rate/fee conventions.
- **Major tasks:** Amortization engine, strategy planner, scenario comparison, payoff milestone integration.
- **Data/model implications:** Existing loans remain canonical. Immutable actor-owned strategy snapshots retain debt revisions, explicit terms/effective dates, provenance, assumptions, extra budget, exact results, and calculation versions.
- **Security:** Owned debt detail, safe exports/logging, clear non-advisory presentation.
- **Testing:** Fixed and effective-dated variable rates, explicit monthly/Actual-365/Actual-360 conventions, incomplete/assumption-based status, allocation/minimum rules, known/unknown fees and prepayment, all four strategies, extra allocation, payoff order/baseline comparisons, rounding/int64/same-currency boundaries, no mutation, reproducibility, actor/household/two-user isolation, AI authority, Hebrew/RTL, and Phases 0–12 regression.
- **Acceptance criteria:** Schedules reconcile at every payment and total conserved amounts are exact to minor units.
- **Definition of done:** Strategies are explainable, reproducible, and do not alter debt truth until explicitly applied.
- **Risks/migration:** Lender-specific rules, regulatory presentation, rate changes.
- **Verified result (2026-09-02):** Accepted under the execution-order exception. The dedicated Phase 13 suite passed 3 files / 23 tests and the complete final-state suite passed 50 files / 226 tests with real MongoDB and the real Anthropic regression gate. Per-payment conservation, global same-day chronology, all explicit rate/application/accrual/allocation/minimum/fee/prepayment boundaries, ISO currency precision, exact BSON int64 persistence, actor/household/two-user isolation, stale-revision/idempotency integrity, canonical non-mutation, authenticated Hebrew/RTL production acceptance, type-check, zero-warning lint, optimized build, and a zero-vulnerability registry audit passed. Phase 9 remains blocked and no provider provenance exists.

## Phase 14 — Savings and net worth

**Approved product policy (2026-09-02):** Reproducible point-in-time assets-minus-liabilities statements; explicit valuation amount/type/time/provenance/freshness; unrealized-value versus cash separation; canonical account/savings/holding/goal/card/debt deduplication; evidence-prioritized liabilities; separate currency totals with no implicit FX; immutable fingerprinted snapshots; daily-at-most automatic history plus explicit snapshots; correction/deletion history preservation; private-by-default household isolation; AI explanation-only authority; and complete provider-neutral operation while Phase 9 remains blocked.

- **Objective:** Track emergency funds, savings goals, assets, liabilities, net worth, and history.
- **Scope:** Cash/savings/investments/other valued assets minus loans/cards/overdraft/other liabilities, exact currency-grouped current statements, explicit freshness/provenance/deduplication, savings-goal references without duplication, and immutable historical charts. No FX conversion, live market/provider values, scenario valuation, payment action, or AI calculation.
- **Dependencies:** Accounts/debts/goals, currency policy, snapshots.
- **Major tasks:** Pure versioned aggregation/freshness engine; standalone/holding/liability-evidence items; canonical source mapper; source/type freshness; exact liability priority; explicit/material snapshot orchestration; goal-link projection; Hebrew/RTL current/history UI.
- **Data/model implications:** Mutable audited/soft-deletable `netWorthItems` for explicit current valuations and append-only fingerprinted `netWorthSnapshots` containing complete point-in-time evidence; exact multi-currency BSON int64 amounts remain separate.
- **Security:** Sensitive holdings and snapshots are actor-owned, direct-ID owner-scoped, bounded/minimized in client/export/logs, and never expanded by household membership alone.
- **Testing:** Sign/classification, market-versus-cash, source/freshness thresholds, missing/stale values, every deduplication boundary, liability priority/fees, currency grouping/no FX, goal non-duplication, snapshot idempotency/immutability, corrections/deletions, bigint/BSON int64, household/two-user isolation, AI separation, Hebrew/RTL, and Phases 0–13 regression.
- **Acceptance criteria:** Net worth reconciles to included records with visible valuation freshness.
- **Definition of done:** Savings and liabilities show accurate present and historical progress.
- **Risks/migration:** Market valuation sources and cross-currency aggregation.
- **Verified result (2026-09-02):** Accepted under the execution-order exception. Dedicated Phase 14 coverage passed 3 files / 19 tests and the complete final-state suite passed 53 files / 245 tests with real MongoDB and the real Anthropic regression gate. Exact currency-grouped reconciliation, market-versus-cash separation, all source/type freshness and deduplication boundaries, liability evidence priority, no implicit FX, immutable/idempotent history, correction/deletion preservation, BSON int64, actor/household/two-user isolation, export safety, canonical non-mutation, authenticated Hebrew/RTL production acceptance, type-check, zero-warning lint, optimized build, and a zero-vulnerability registry audit passed. Phase 9 remains blocked and no provider provenance exists.

## Phase 15 — Notifications

- **Objective:** Deliver actionable, consented alerts for large charges, low Safe to Spend, goals, budgets, bank state, and forecast overdrafts.
- **Scope:** In-app plus selected email/push channels, preferences, deduplication, scheduling, delivery status.
- **Dependencies:** Domain events from engines/features and selected providers.
- **Major tasks:** Notification port/adapters, preference policy, idempotent jobs, quiet hours/timezone, retry/dead-letter behavior.
- **Data/model implications:** Owned notifications/preferences and provider delivery metadata without excess payload.
- **Security:** Opt-in/opt-out, content minimization, signed links, provider secret protection.
- **Testing:** Trigger thresholds, duplicates, timezone/quiet hours, retries/provider failure, preference/revocation.
- **Acceptance criteria:** Alerts trace to a domain fact and are not duplicated or sent after access revocation.
- **Definition of done:** At least one real channel and in-app delivery are operationally verified.
- **Risks/migration:** Notification fatigue, leaked financial details, delivery reliability.

## Phase 16 — Reviews, reports, and search

- **Objective:** Provide monthly/yearly reviews, core financial reports, subscriptions view, and authorized global search.
- **Scope:** Cash flow, categories, income vs expenses, debt, savings, net worth, budget, goals, AI summary, merchant/transaction/category/account/goal search.
- **Dependencies:** Stable snapshots/history and applicable AI boundary.
- **Major tasks:** Versioned report queries, export formats, search indexes, locale/RTL presentation, review finalization.
- **Data/model implications:** Derived report snapshots/indexes; source IDs and periods preserve reconciliation.
- **Security:** Owner-scoped search/indexing, export authorization, CSV injection protection, AI summary traceability.
- **Testing:** Reconciliation, date filters/timezones, pagination/search isolation, export safety, review fixtures.
- **Acceptance criteria:** Every report total traces to owned source data and search never crosses scope.
- **Definition of done:** Reports/reviews/export/search are accurate, accessible, and performant at target data volumes.
- **Risks/migration:** Stale derived data, index privacy, large export cost.

## Phase 17 — Progress journeys

- **Objective:** Add restrained milestones, streaks, and achievements that reinforce healthy progress without trivializing finances.
- **Scope:** Under-budget, no-overdraft, debt-reduction, emergency-fund, and goal milestones.
- **Dependencies:** Verified goals/budgets/snapshots and product/ethics review.
- **Major tasks:** Deterministic achievement policies, historical backfill, accessible celebration/preferences.
- **Data/model implications:** Versioned achievement definitions and earned events; no duplicated financial truth.
- **Security:** Owned progress, privacy-safe sharing only if explicitly introduced.
- **Testing:** Thresholds, reversals, corrected history, timezone streaks, deduplication.
- **Acceptance criteria:** Achievements derive from verified data and cannot pressure unsafe behavior.
- **Definition of done:** Product review confirms tone and users can disable nonessential gamification.
- **Risks/migration:** Harmful incentives and backfill changes after policy updates.

## Phase 18 — Production hardening and operations

- **Objective:** Harden security, reliability, performance, observability, privacy, accessibility, mobile/RTL, and operations.
- **Scope:** Rate limiting, CSP/headers, error/API/bank/AI/calculation logging, metrics, backups/restores, privacy controls, basic admin health, feature flags.
- **Dependencies:** Feature-complete candidate and chosen production infrastructure.
- **Major tasks:** Threat model/security audit, load tests, failure drills, runbooks, admin least privilege, backup restore, dependency/container checks, accessibility review.
- **Data/model implications:** Operational events and feature flags separated from private finance; retention/redaction enforced.
- **Security:** Penetration/isolation review, token rotation, encryption, least privilege, incident response, admin cannot browse private finance by default.
- **Testing:** SAST/dependency audit, load/resilience, rate limits, backup restore, accessibility, mobile, RTL/LTR, failure injection.
- **Acceptance criteria:** No unresolved critical/high security issues; SLOs/runbooks/backups/restore and privacy controls are verified.
- **Definition of done:** Signed hardening checklist with evidence and rollback paths.
- **Risks/migration:** Late performance/index changes, telemetry privacy, operational gaps.

## Phase 19 — Persona validation and complete E2E

- **Objective:** Validate the complete product across required personas and workflows.
- **Scope:** New/existing, single/couple, debt/no-debt, fixed/variable income, bank/manual users; full critical journeys.
- **Dependencies:** Hardened release candidate and stable test environments/provider sandboxes.
- **Major tasks:** Persona fixtures, end-to-end matrix, exploratory/financial review, migration/upgrade paths, support readiness.
- **Data/model implications:** Synthetic isolated fixtures only; production-like scale without real user data.
- **Security:** Cross-persona/tenant isolation, role revocation, deletion/export, session/account recovery checks.
- **Testing:** Full E2E plus regression, concurrency, interruption/retry, browser/device, accessibility, provider failure.
- **Acceptance criteria:** Every Master Plan completion journey succeeds with correct reconciled values for applicable personas.
- **Definition of done:** No release-blocking defects and documented evidence maps tests to requirements.
- **Risks/migration:** Coverage gaps hidden by happy paths and nondeterministic provider sandboxes.

## Phase 20 — Production launch

- **Objective:** Deploy a legally and operationally ready Financial OS with controlled rollout.
- **Scope:** Production database/domain/Vercel, monitoring/backups, legal/privacy/terms/support, analytics, rollout/rollback.
- **Dependencies:** Phases 18–19 acceptance, legal approval, production credentials/providers, support ownership.
- **Major tasks:** Provision isolated production resources, secrets/callbacks/DNS, migrations/indexes, smoke tests, alerting/on-call, feature-flagged rollout.
- **Data/model implications:** Versioned production migrations, backup/retention/deletion operations, no test data contamination.
- **Security:** HTTPS/HSTS, production OAuth/provider allowlists, least-privilege access, secret rotation, launch threat review.
- **Testing:** Deployment smoke, migration rehearsal, restore/rollback, synthetic monitoring, staged user verification.
- **Acceptance criteria:** Production journeys work, alerts/backups/support/legal controls are live, and rollback is proven.
- **Definition of done:** Controlled launch approved with monitoring and incident ownership; the Master Plan's complete definition is demonstrably met.
- **Risks/migration:** Environment drift, irreversible migrations, launch load, regulatory/support failures.

## Cross-phase acceptance record

Each phase appends to `PROGRESS.md`:

1. implemented behavior and important files;
2. exact test, type-check, lint, build, security, and migration commands/results;
3. real credential/provider verification versus explicit blockers;
4. decisions and unresolved product questions;
5. deferred work and the exact next milestone.
