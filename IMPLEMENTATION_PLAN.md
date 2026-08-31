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

- **Objective:** Support category budgets, forecasts, zero-based allocation, and monthly planning.
- **Scope:** Categories, budget/spent/remaining/forecast, income roles, unallocated balance.
- **Dependencies:** Transactions, engine monthly metrics, profile timezone/currency.
- **Major tasks:** Budget services, category rules, month rollover, allocation invariants, dashboard integration.
- **Data/model implications:** User-owned budget periods/items and category mappings; immutable period history where needed.
- **Security:** Ownership on budget/category/transaction aggregates and audit on plan changes.
- **Testing:** Allocation conservation, over-budget/negative/refund/month-boundary cases, E2E monthly plan.
- **Acceptance criteria:** Budget figures reconcile exactly with source transactions and allocations sum deterministically.
- **Definition of done:** Current and historical months are stable, explainable, and user-editable within policy.
- **Risks/migration:** Category corrections rewriting history; rollover policy ambiguity.

## Phase 6 — Goals and measurable progress

- **Objective:** Make goals financial objects with baselines, targets, deadlines, trends, and actions.
- **Scope:** Goal types, milestones, progress history, goal dashboard and analytics.
- **Dependencies:** Engine metrics, debt/savings/account data, budgets where relevant.
- **Major tasks:** Goal policy strategies, validation, progress calculation, snapshot linkage, manual/custom goal rules.
- **Data/model implications:** Goals and append-only progress points keyed by owner and engine version.
- **Security:** Authorized goal inputs and outputs; audit edits/deletion; avoid sensitive detail in notifications.
- **Testing:** Each goal strategy, zero/negative targets, deadlines, regressions, completion/reopen semantics.
- **Acceptance criteria:** Progress is calculated from deterministic records rather than self-reported UI totals where measurable.
- **Definition of done:** Users can create supported goals and see explainable verified progress.
- **Risks/migration:** Goal definitions drifting; historical progress recomputation and baseline changes.

## Phase 7 — Purchase impact simulation

- **Objective:** Evaluate a proposed purchase as SAFE, CAUTION, or UNSAFE against the timeline.
- **Scope:** One-time/installment purchase inputs, recalculated timeline, safety-margin impact, alternative date suggestions.
- **Dependencies:** Versioned Phase 3 engine and current source snapshot.
- **Major tasks:** Isolated scenario inputs, policy thresholds, explanation codes, persistence only on explicit user choice.
- **Data/model implications:** Owned simulation records reference input snapshot/engine version; simulations never mutate truth.
- **Security:** Authorized snapshot loading, input limits, no cross-user scenario access.
- **Testing:** Boundary thresholds, alternative dates, installments, stale source data, invariant that source records remain unchanged.
- **Acceptance criteria:** Results reproduce and reconcile with a hypothetical engine timeline.
- **Definition of done:** Honest status/explanation and freshness are shown; no hardcoded outcomes.
- **Risks/migration:** Users interpreting estimates as guarantees; policy and stale-data communication.

## Phase 8 — Claude financial copilot

- **Objective:** Explain structured financial truth conversationally without delegating calculations to AI.
- **Scope:** Anthropic adapter, schema-validated structured context, chat, Safe to Spend explanation, purchase/goal/monthly guidance, FACT/INSIGHT/RECOMMENDATION separation.
- **Dependencies:** Engine/simulation snapshots; Anthropic credentials; privacy/redaction policy.
- **Major tasks:** Prompt contracts, tool calls to deterministic services, context minimization, output schemas, refusal/failure UX, usage controls.
- **Data/model implications:** Owned conversations/messages, snapshot references, retention controls; never credentials.
- **Security:** Server-only key, prompt-injection defenses, authorization before context assembly, redaction, rate/cost limiting.
- **Testing:** Adapter contract and schema failures, hostile prompts, hallucinated-number rejection, privacy and E2E explanations.
- **Acceptance criteria:** Every significant number traces to a structured snapshot/tool result.
- **Definition of done:** AI failure cannot corrupt or replace financial truth and outputs are clearly classified.
- **Risks/migration:** Privacy, hallucination, token cost, model changes, retention consent.

## Phase 9 — Open Banking

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

- **Objective:** Normalize merchants, suggest categories, detect recurring/subscriptions and anomalies while preserving user confirmation.
- **Scope:** AI/rule predictions, confirmed categories, recurring detection, subscriptions, duplicate/unusual/increase signals.
- **Dependencies:** Sufficient transaction history and provider-neutral records.
- **Major tasks:** Prediction interfaces, confidence/versioning, correction feedback, deterministic fallbacks, review queue.
- **Data/model implications:** Predictions remain separate from confirmed facts; model/rule version and evidence recorded.
- **Security:** Minimize external context, authorize all data, protect merchant details, abuse/cost controls.
- **Testing:** Known merchants, corrections, low confidence, false positives, duplicate signals, model outage.
- **Acceptance criteria:** Suggestions never silently overwrite confirmed user truth and are reversible/explainable.
- **Definition of done:** Quality thresholds measured and failure leaves core finance usable.
- **Risks/migration:** Biased/unstable classifications and feedback-data privacy.

## Phase 11 — Households and permissions

- **Objective:** Support owner/member/viewer collaboration with explicitly shared and private resources.
- **Scope:** Household creation/invites/membership/revocation, roles, shared accounts/goals, partner UX.
- **Dependencies:** Product-approved visibility semantics and mature user-scoped repositories.
- **Major tasks:** Central policy evaluator, invitation lifecycle, resource scope migration, access review, revocation propagation.
- **Data/model implications:** Households/memberships and scoped ownership; uniqueness/indexes include household where relevant.
- **Security:** Deny-by-default role/resource policies, invite token hygiene, immediate revocation, comprehensive audit.
- **Testing:** Permission matrix, private/shared cases, revoked/expired membership, concurrent role change, anti-enumeration.
- **Acceptance criteria:** Every operation passes a documented permission matrix and cross-household isolation tests.
- **Definition of done:** Sharing is explicit, reversible, audited, and cannot expose pre-existing private data.
- **Risks/migration:** Retrofitting ownership and ambiguous data after a member leaves.

## Phase 12 — Advanced forecast and scenarios

- **Objective:** Provide 30/60/90-day forecasts, scenario analysis, uncertain income, estimates, and trends.
- **Scope:** Forecast ranges/confidence and what-if income, expense, loan, card, and savings changes.
- **Dependencies:** Timeline engine, history, recurrence/intelligence signals.
- **Major tasks:** Versioned assumptions, confidence models, scenario comparison, explicit as-of state, trend detection.
- **Data/model implications:** Owned forecast/scenario snapshots with assumption and engine versions.
- **Security:** Authorized inputs, safe cached views, no AI-calculated truth.
- **Testing:** Uncertainty bounds, missing history, seasonal/month/DST boundaries, reproducibility, stress fixtures.
- **Acceptance criteria:** Forecasts disclose assumptions/confidence and scenarios cannot mutate actual data.
- **Definition of done:** Results are deterministic for a given assumption set and reconcile to baseline timeline.
- **Risks/migration:** False precision, data sparsity, expensive recomputation.

## Phase 13 — Debt strategies

- **Objective:** Calculate debt-free dates and compare snowball, avalanche, and custom payoff scenarios.
- **Scope:** Interest/payment schedules, monthly debt load, progress, extra-payment simulations.
- **Dependencies:** Accurate debt models, timeline engine, rate/fee conventions.
- **Major tasks:** Amortization engine, strategy planner, scenario comparison, payoff milestone integration.
- **Data/model implications:** Debt terms and strategy snapshots retain effective dates and calculation versions.
- **Security:** Owned debt detail, safe exports/logging, clear non-advisory presentation.
- **Testing:** Interest/rounding, zero/negative rates, fees, early payoff, multiple debts, minimum-payment changes.
- **Acceptance criteria:** Schedules reconcile at every payment and total conserved amounts are exact to minor units.
- **Definition of done:** Strategies are explainable, reproducible, and do not alter debt truth until explicitly applied.
- **Risks/migration:** Lender-specific rules, regulatory presentation, rate changes.

## Phase 14 — Savings and net worth

- **Objective:** Track emergency funds, savings goals, assets, liabilities, net worth, and history.
- **Scope:** Cash/savings/investments/other assets minus loans/credit/debts, progress and historical charts.
- **Dependencies:** Accounts/debts/goals, currency policy, snapshots.
- **Major tasks:** Asset/liability classification, valuation-date/source rules, net-worth snapshot service, goal links.
- **Data/model implications:** Asset records and versioned net-worth snapshots; multi-currency amounts remain explicit.
- **Security:** Sensitive holdings are owner-scoped and minimized in client/logs.
- **Testing:** Sign/classification, missing/stale valuations, history, currency grouping, deletions.
- **Acceptance criteria:** Net worth reconciles to included records with visible valuation freshness.
- **Definition of done:** Savings and liabilities show accurate present and historical progress.
- **Risks/migration:** Market valuation sources and cross-currency aggregation.

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
