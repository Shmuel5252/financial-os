# Financial OS Architecture

## Purpose and status

This document defines the implemented architecture through the fully verified Phase 6 acceptance gate and the constraints that future phases must preserve. It distinguishes verified code from product capabilities that are only planned. `MASTER_PLAN.md` remains the product source of truth.

| Status | Meaning |
| --- | --- |
| Implemented in Phase 0 | A working, tested code or configuration foundation exists. |
| Implemented in Phase 1 | Working profile/manual-onboarding code exists and is verified at its stated boundary. |
| Verified in Phase 1 | Real Google OAuth, Auth.js MongoDB sessions, server-derived identity, sign-out, onboarding, and two-user isolation passed their operational gate. |
| Implemented and verified in Phase 2 | Normalized manual source records, transactions, recurrence definitions, savings, pagination, idempotency, audit, snapshots, exports, and authenticated Hebrew/RTL management passed their stated gates. |
| Implemented and verified in Phase 3 | The pure deterministic engine, recurrence expansion, conservative event ordering, future balances, Safe to Spend, monthly metrics, and owned versioned result snapshots passed deterministic and real-Mongo gates. |
| Implemented and verified in Phase 4 | The authenticated Hebrew/RTL dashboard, freshness-aware query view, bounded timeline windows, alerts, manual-goal summary, and explicit refresh journey passed reconciliation, isolation, browser, accessibility, and regression gates. |
| Implemented and verified in Phase 5 | Exact confirmed-income monthly allocation, stable customizable categories, explicit deficits, signed rollover, actual-period refunds, immutable corrections, and isolated deterministic scenarios passed unit, real-Mongo, authenticated-browser, and regression gates. |
| Implemented and verified in Phase 6 | Versioned deterministic goal metrics, manual/verified provenance, direction-aware progress, sustained success, immutable milestones/history, and authenticated goal management passed unit, real-Mongo, authenticated-browser, and regression gates. |
| Implemented and verified in Phase 7 | Deterministic purchase classification, exact installments/charges, 90-day safer-date search, separate freshness, and explicitly saved immutable simulations passed unit, real-Mongo, authenticated-browser, integrity, and regression gates. |
| Boundary prepared | An interface, module boundary, convention, or configuration seam exists; no provider capability is claimed. |
| Planned | The product behavior belongs to a later roadmap phase and does not exist yet. |

## System shape

```text
Browser UI
  -> Next.js server components / route handlers
    -> application services
      -> deterministic financial engine (pure calculation)
      -> data-access repositories -> MongoDB

External systems -> server-only adapters -> application services
```

Dependency flow is inward. UI code may call server actions or route handlers, but never the database. Route handlers authenticate, validate, authorize, invoke one application use case, and translate results. They do not contain financial calculations. Application services orchestrate domain rules and repositories. The financial engine is pure and deterministic. Repositories are the only modules that issue MongoDB queries. Provider-specific Claude, banking, notification, and telemetry models terminate at adapter boundaries.

### Phase 0 implementation map

- **Implemented:** App Router shell, strict TypeScript, Tailwind, server/client separation, validated environment access, MongoDB client factory, user-scoped repository helpers, Auth.js-compatible Google configuration, server-side actor/authorization helpers, Zod validation helpers, integer-minor-unit money value object, UTC/calendar-date validation, typed public errors, unit/integration test layout, and build/lint/type-check scripts.
- **Boundary prepared:** repository interfaces, authenticated actor context, future household scope shape, financial-engine directory, external adapter directories, MongoDB health check, Google provider configuration boundary.
- **At Phase 0 acceptance:** onboarding, profile entities, mutation audit, and rate limiting were planned; their current status is recorded in the Phase 1 and Phase 2 maps below. Household membership resolution, financial calculations, provider integrations, calculated snapshots, and observability remain pending or later-phase work.

### Phase 1 implementation map

- **Implemented and tested without fake auth:** profile and onboarding schemas/services/repositories; manual income, account, card, recurring-expense, loan, safety-margin, and goal records; resumable ordered onboarding; review/completion UI; exact money input and BSON mappings; optimistic concurrency; entity-local mutation audit; ordinary-record soft deletion; mutation origin/body/rate controls; protected routes; sign-in/sign-out wiring.
- **Verified against real local MongoDB:** profile/manual persistence, user-prefixed indexes, BSON int64 money, onboarding state transitions, audit events, rate-limit counters, two constructed actors' read/update isolation, one active safety margin, and test-database cleanup.
- **Verified with real authentication:** two distinct Google callbacks; namespaced Auth.js user/account/session persistence in the configured database; real session-to-actor identity; sign-out/session deletion; server-derived profile ownership/audit actors; full authenticated Playwright onboarding; empty second-user reads; and denial of a second user's update against the first user's account.
- **Not started at Phase 1 acceptance:** Phase 2 financial data platform/transactions and all later capabilities. Their current status is recorded below.

### Phase 2 implementation map

- **Implemented:** authenticated Hebrew/RTL financial-data hub; reusable capability schemas/repositories/services/routes/forms; actual transactions; explicit recurring-transaction definitions; savings; bounded cursor pagination; owner-scoped create idempotency; optimistic updates/deletes; account-reference authorization; structured manual source metadata; user-prefixed indexes; immutable source-manifest snapshots; and bounded safe JSON export.
- **Verified against real local MongoDB:** exact BSON int64 money beyond JavaScript's safe-integer range, per-owner idempotency and conflict behavior, deterministic pagination, cross-owner read/write/reference denial, mutation audit, structured source metadata, custom index order, snapshot isolation, export field minimization, and test-database cleanup.
- **Verified with real authentication and browser UI:** a real Google callback and MongoDB database session opened the protected data hub; the session created and reloaded an account and transaction with exact values; MongoDB ownership matched the active session; Hebrew/RTL and LTR value isolation remained active; and a source snapshot was captured.
- **Not started:** dashboard presentation, Claude, Open Banking, households, longer-range forecasting, gamification, and later-phase capabilities. The Phase 3 calculation capabilities are recorded below.

### Phase 3 implementation map

- **Implemented:** pure typed financial-engine input/output; explicit 1–366-calendar-day horizon with a 30-day default; anchored weekly/biweekly/monthly/quarterly/annual recurrence expansion; cards and capped loan installments; conservative event ordering; confirmed and expected future balances; minimum future balance; fixed/percentage Safety Margin; Safe to Spend and shortfall; exact monthly metrics; engine/policy versions; canonical input hashes; and immutable calculated snapshots linked to source manifests.
- **Verified by deterministic tests:** uncertain income never raises core safety; same-day obligations precede income without timestamps; reliable timestamps take precedence; user-timezone calendar months and DST boundaries; half-even percentage rounding; negative balances; missing and duplicate inputs; card/loan obligations; final-installment caps; alternative horizons; int64 overflow; and repeated safety invariants.
- **Verified against real local MongoDB:** owner-only input assembly and snapshot listing for two actors; source-manifest association including Safety Margin; BSON `Long` result persistence; calculation audit; idempotent retry/conflict behavior; identical result/input hash from identical source inputs; and mixed snapshot-kind isolation.
- **At Phase 3 acceptance:** the Phase 4 dashboard/read model had not started. Phase 3 itself added no AI, provider integration, user-facing calculation UI, or UI-side financial arithmetic; the implemented dashboard remains separated in the Phase 4 map below.

### Phase 4 implementation map

- **Implemented:** protected `/dashboard`; real Safe to Spend, current/future balances, margin/shortfall, credit/debt/savings, monthly metrics, limiting-point explanation, 7/14/30-day event windows, snapshot-to-snapshot change, calculation freshness, derived on-screen alerts, stored manual-goal summaries, explicit refresh, empty/loading/error states, and navigation from onboarding/data management.
- **Calculation boundary preserved:** the dashboard receives serialized Phase 3 result values and performs no money arithmetic. Its query service may filter already-calculated events by date window, calculate an exact delta between two engine results, and select the engine-provided minimum-capacity point; it does not reconstruct Safe to Spend or future balances.
- **Freshness:** a result is stale when its owner-scoped source manifest no longer matches current source IDs/versions/timestamps, the profile changed after calculation, the associated manifest is unavailable, or the user's configured timezone has entered a new calendar day. Stale values remain visible but are explicitly labelled and paired with an explicit recalculation action.
- **Payload/accessibility boundary:** client timeline windows are limited to 100 ordered events each and goals to 20 priority-ordered entries with disclosed truncation. The page is dynamic and server-authenticated; no owner or raw Mongo document reaches the client. Hebrew semantic headings/lists/terms/tabs, ARIA relationships/live regions, responsive base layouts, and LTR isolation protect usability without a visual redesign.
- **At Phase 4 acceptance:** Phase 5 budgets/allocation had not started. Its implemented architecture is recorded separately below. Phase 6 goal intelligence/progress policy, proactive notification delivery, and later features remain unimplemented; Phase 4 alerts are snapshot-derived on-screen status only and goals still show persisted current/target values without inventing progress policy.

### Phase 5 implementation map

- **Implemented:** protected Hebrew/RTL `/budgets`; actor-owned system/custom category views with stable internal IDs; mutable labels, visibility, order, and explicit `reset`/`carry` policy; exact monthly periods and category allocations; visible signed unallocated deficits; actual, planned, remaining, and forecast category figures; actual-period refunds linked to owned expenses; append-only category-correction evidence; closed-period snapshots; and a separate non-persisting scenario calculator.
- **Calculation boundary:** the pure budget engine accepts normalized exact-minor-unit inputs and returns deterministic reconciliation. Confirmed monthly income is the only real allocation basis. Uncertain income is exposed separately and can enter only the explicit scenario command. Uncategorized expenses still enter total cash truth and conservative forecast. The scenario engine starts from the latest owned Phase 3 core result, returns hypothetical deltas/target gaps, and cannot write transactions, balances, allocations, or engine snapshots.
- **Persistence and history:** `budgetCategories`, `budgetPeriods`, and `budgetCategoryCorrections` use owner-first indexes and server-derived ownership. Category IDs remain stable across presentation changes. Open-period saves use optimistic concurrency and entity-local audit evidence. Closing freezes exact category results and rollover inputs; a later period prevents retroactive save/close of an earlier period. Reset categories carry zero while carry categories carry the prior signed remainder. Original transactions and closed periods are never silently rewritten.
- **Refund/correction boundary:** a refund is an actual transaction in the calendar period in which it arrives and may reference only an owned expense. Same-period refunds reduce that period's category spending. Later-period refunds affect only their actual period. Transaction category changes are rejected after creation; corrected report classification is projected from immutable correction records retaining original/corrected category, actor, reason, and time.
- **Security and payload boundary:** all budget pages and four API routes derive identity from the Auth.js actor, enforce origin/body/rate limits on mutations/calculations, return no-store responses, serialize exact money as strings, and expose neither owner IDs nor MongoDB documents. Financial-data export includes bounded owned budget records and correction evidence, but excludes internal audit/idempotency/auth data.
- **Not started:** Phase 6 goal strategies/progress history, purchase impact, Claude, Open Banking, notifications, households, gamification, or any later-phase capability.

### Phase 7 implementation map

- **Implemented:** protected Hebrew/RTL `/purchase-simulation`; explicit 210-day Phase 3 baseline refresh; one-time/monthly total-price inputs; separate user-reported interest/fee provenance; exact schedule conservation with earliest-installment remainder allocation; rolling 30-day hypothetical timeline; deterministic `SAFE`/`CAUTION`/`UNSAFE`; 90-day first-`SAFE` search; visible snapshot freshness; and explicit immutable saves.
- **Calculation boundary:** the pure Phase 7 engine consumes only an immutable owned Phase 3 result and typed hypothetical purchase inputs. It reconstructs confirmed/expected balances with Phase 3 ordering and margin boundaries, returns an explicit 30-day evaluation, and never writes. Full installment cost/schedule remains distinct from which installments fall inside a particular rolling evaluation window.
- **Persistence and provenance:** ordinary evaluations are ephemeral. `purchaseSimulations` is append-only and owner-indexed; explicit saves preserve exact input/charges/schedule/timeline/result, source engine/manifest hashes and versions, applicable budget-period reference, freshness reasons, engine/policy versions, user note/name, creation time, and one redacted entity-local save audit event. Export schema version 4 includes bounded public saved-simulation evidence but excludes ownership, audit, and idempotency fields.
- **Freshness/security:** Phase 4 dashboard freshness logic is one shared server-only evaluator reused unchanged by dashboard and simulation. Snapshot and budget references are revalidated with owner predicates at save time. Evaluation/save routes derive Auth.js identity, enforce exact origin/body/rate limits, return no-store responses, and accept no owner identity. A stale result remains mathematically classified but cannot be presented as unqualified current safety.
- **Verified non-mutation:** unit and real-Mongo acceptance prove that evaluation writes nothing and explicit save changes only `purchaseSimulations`; it does not create transactions or mutate accounts, budget periods, engine/source snapshots, Safe to Spend, or goals.
- **Not started:** Claude/AI explanation, bank/card-provider terms, purchase commitment, advanced Phase 12 scenarios, and later-phase behavior.

## Phase 1 profile and onboarding architecture

The profile is the one-per-user root for manual onboarding. It stores locale context, primary currency, IANA timezone, household type, an optimistic `version`, and an ordered state machine:

```text
profile -> income -> accounts -> cards -> expenses -> debts
        -> safety_margin -> goals -> review -> complete
```

Each transition requires the current step, `in_progress` status, owner, and expected version to match atomically. Empty financial sections are allowed only through an explicit completion action. A completed review cannot be replayed. Reloading a page reads the persisted profile step and capability records, so the flow is resumable without client-owned progress state.

Manual onboarding uses separate collections—`incomeSources`, `accounts`, `creditCards`, `recurringExpenses`, `loans`, `safetyMargins`, and `goals`—plus `profiles`. The generic repository implementation is parameterized by a closed section enum, but each section maps to a distinct capability collection and distinct Zod domain schema. This avoids a monolithic user document while keeping Phase 1's repeated ownership/concurrency policy in one implementation.

Every financial document stores MongoDB `ObjectId` ownership derived from the server `Actor`, manual source metadata, `createdAt`, `updatedAt`, `deletedAt`, and `version`. New Phase 2 records use `{ kind: "manual" }`; mapping retains compatibility with Phase 1's stored `source: "manual"`. Reads are bounded and filter by `{ userId, deletedAt: null }`; updates and removal additionally filter by `_id` and expected version. Ordinary removal is soft deletion so onboarding mistakes are recoverable and mutation history remains intact. A future full-account privacy erasure must hard-delete the profile, manual records, and applicable audit data under a separately reviewed policy.

The detected local MongoDB is a standalone deployment, so Phase 1 does not claim multi-document transactions. Each profile/manual mutation atomically updates the record and appends its redacted entity-local audit event in the same document. A future centralized audit/read model may project these events, but financial mutation success never depends on a non-atomic second write in the current topology.

Manual monetary input is a decimal string plus the profile's primary currency. Currency minor-unit precision comes from the runtime's ISO-backed `Intl.NumberFormat` metadata, excess fractional digits are rejected, and parsing uses string/`bigint` arithmetic only. Persistence uses explicit BSON `Long` conversion with int64 checks. Phase 1 does not perform currency conversion or allow records whose money differs from the profile currency.

Mutation routes require an exact configured `Origin`, `application/json`, and an actual UTF-8 body no larger than 16 KB. A MongoDB fixed-window limiter keys counters by a SHA-256 hash of actor ID plus action; raw actor IDs are not stored in the limiter collection. Expected public errors are mapped to stable responses with correlation IDs and `Cache-Control: no-store`.

## Phase 2 source-data architecture

Phase 2 evolves onboarding records into continuing first-class manual source data. Existing collections remain authoritative, avoiding a migration or duplicate truth. Actual movements are stored in `transactions`; expected income remains in `incomeSources`; recurring obligations captured during onboarding remain in `recurringExpenses`; reusable income/expense schedules live in `recurringTransactions`; savings instruments live in `savings`; cards and loans/debts retain their existing capability collections.

Transaction amounts are positive exact-money values with an explicit `income`, `expense`, or `transfer` direction. A transfer requires distinct source and destination account IDs. Application services resolve every account reference through an owner-scoped active-record query before persistence; a syntactically valid foreign ID is rejected. Recurring definitions persist frequency, positive interval, start/end/next calendar dates, active state, account, direction, category, and amount. Phase 2 validates this definition but never expands it into projected events.

Create requests carry UUID idempotency keys. Persistence stores only SHA-256 hashes of the key and canonical validated payload under a unique per-owner index. An exact retry returns the original document; key reuse with a different payload conflicts. Updates and soft deletion use expected versions. Page APIs use descending ObjectId cursors with limits no larger than 50; export/snapshot reads use explicit maximums rather than unbounded queries.

`financialSnapshots` stores two owner-scoped immutable document kinds. Schema-version-1 `source_manifest` documents record capture time, primary currency, and the exact source record IDs, versions, and update timestamps included. Schema-version-1 `engine_result` documents store the engine/policy versions, explicit as-of/horizon result, canonical SHA-256 input hash, exact BSON-int64 output values, calculation audit event, and the associated source-manifest ID. Queries always filter both owner and kind. A manifest detects source drift but is not represented as a full historical ledger; historical source reconstruction remains a separately reviewed future retention/versioning concern.

The owner-only JSON export is built from serialized public view models. It excludes ownership fields, audit entries, idempotency hashes, Auth.js records, tokens, and provider secrets; it is bounded, no-store, attachment-marked, and MIME-sniff protected. Larger report/search/CSV export semantics remain Phase 19 work.

## Project and domain boundaries

```text
src/
  app/                    Next.js pages, layouts, and route handlers
  components/             presentation-only reusable UI
  lib/
    auth/                  authentication configuration and actor derivation
    authorization/         ownership/scope policy
    config/                environment parsing and public capability status
    db/                    MongoDB client and low-level database access
    data-access/           repositories and ownership-enforcing query helpers
    domain/                pure value objects and deterministic domain rules
    errors/                safe error taxonomy and HTTP translation
    validation/            transport-independent Zod schemas/helpers
    services/              application use cases (introduced as features arrive)
    adapters/              external-provider ports/adapters
```

Future financial modules should be introduced by capability (`accounts`, `transactions`, `goals`, `timeline`, `safe-to-spend`, and so on), without turning `lib` into one giant cross-domain service. Collections are created only when their phase needs them.

## Server and client boundaries

- Server components are the default. A file becomes a client component only for browser interaction or browser-only APIs.
- `server-only` guards protect secrets, auth configuration, MongoDB, repositories, and adapters from client bundles.
- Client code receives serialized view models, never MongoDB documents, access tokens, provider payloads, or environment secrets.
- Route handlers and future server actions validate untrusted input and derive identity from the server session. Client-supplied `userId` is never authorization evidence.
- Monetary values cross JSON boundaries as base-10 minor-unit strings plus an ISO 4217 currency code. Dates cross as explicit UTC timestamps or validated calendar dates, never locale-formatted strings.

## Localization and bidirectional text

Financial OS is permanently Hebrew-first and RTL-first. The root document declares `lang="he"` and `dir="rtl"`; Financial OS-controlled navigation, onboarding, forms, validation feedback, empty states, financial labels, review, and error boundaries use natural Hebrew by default. This is a product invariant for every later phase, not deferred production polish.

User-facing copy is centralized under `src/lib/i18n`. Components use the exported active catalog rather than embedding language selection logic, so a future English catalog and locale resolver can be added without rewriting domain components or API contracts. Source code, names, schemas, transport fields, logs, tests, and engineering records remain English. Internal error codes/messages remain stable; the client maps public error codes to localized safe messages rather than displaying arbitrary server text.

The RTL document direction must not reverse inherently LTR data. Email addresses, URLs, currency and country codes, IANA timezones, dates, percentages, technical/account identifiers, and formatted financial values use explicit `dir="ltr"` or `<bdi dir="ltr">` isolation. External Google/provider-controlled screens remain provider-owned and are not treated as Financial OS localization work. Localization changes do not imply a visual redesign.

## Authentication architecture

Financial OS uses a NextAuth/Auth.js-compatible server configuration with Google OAuth and database sessions. Provider credentials and the Auth secret remain optional in the build-time schema so a credential-free checkout can lint, test, and build; runtime capability reporting marks authentication unavailable until all values are supplied. Missing credentials are not substituted with fake values or a fake login.

When configured:

1. Google completes OAuth; the server owns the callback.
2. The MongoDB adapter persists Auth.js data in the configured `MONGODB_DB_NAME` using `authUsers`, `authAccounts`, `authSessions`, and `authVerificationTokens`.
3. Server code calls the central session helper.
4. A session user ID is converted into an `Actor`.
5. Authorization policies and repositories scope every financial operation.

All Auth.js cookies use the `financial-os.authjs` namespace because cookies are hostname-scoped and another application may use Auth.js on a different localhost port. HTTP loopback cookies are unprefixed; HTTPS applies `__Secure-`, with `__Host-` for CSRF, while retaining Auth.js's secure behavior. Google authorization uses `prompt=select_account` so account switching and two-user acceptance do not silently reuse a previous identity.

The real local callback at `http://localhost:3001/api/auth/callback/google`, database sessions, actor derivation, two-user isolation, and sign-out invalidation are verified. Non-loopback production still requires HTTPS, a separate registered callback, `AUTH_SECRET`, and an exact trusted origin. Delete-account, recovery, and email/password auth belong to later phases.

## Authorization and user data isolation

Every user-owned record must contain an immutable owner scope. The Phase 0 convention is:

```ts
type OwnershipScope =
  | { kind: "user"; userId: string }
  | { kind: "household"; householdId: string; userId: string };
```

Only `user` scope is operational now. Household scope is a shape for later policy evaluation, not permission to query household data. Repositories accept a trusted `Actor`/scope from server auth and construct the ownership predicate themselves. Public DTOs do not accept `userId` for ordinary user-owned operations. Reads, updates, and deletes use compound predicates such as `{ _id, userId }`, not `_id` alone. Inserts overwrite ownership from the actor. Bulk and aggregate queries begin with an ownership match. A missing record and an unauthorized record return the same public not-found response where disclosure would leak existence.

Future household access requires a server-side membership lookup, active membership state, role evaluation (`owner`, `member`, `viewer`), resource visibility, and revocation checks. No household query should be enabled by merely adding `householdId` from a request.

Recommended indexes for future user-owned collections include `{ userId: 1, _id: 1 }` and query-specific indexes prefixed by `userId`. Uniqueness that is user-relative must include `userId`.

## MongoDB and Data Access Layer

The server-only MongoDB module provides one cached `MongoClient` promise in development and a stable client in production. It validates `MONGODB_URI` and `MONGODB_DB_NAME` lazily, so builds do not require live infrastructure. Connections use bounded server-selection timeouts. A health operation may ping the database, but ordinary pages do not connect during build.

Repositories:

- own collection names, indexes, persistence mapping, and MongoDB-specific types;
- accept domain/application inputs rather than provider documents;
- enforce ownership on every financial query;
- map BSON `Long` to domain `bigint` for money and never expose BSON types upward;
- attach canonical timestamps and source metadata at persistence boundaries;
- translate duplicate-key and unavailable-database failures into typed application errors without leaking connection details.

Phase 1 created its profile/manual capability collections and the four explicitly namespaced Auth.js collections. Phase 2 added only `transactions`, `recurringTransactions`, `savings`, and `financialSnapshots`. Phase 3 adds no collection; it adds an explicitly discriminated `engine_result` kind and owner-prefixed indexes to `financialSnapshots`. Phase 5 adds budget collections, Phase 6 adds goal definition/progress/receipt collections, and Phase 7 adds only immutable `purchaseSimulations`. Auth.js and financial account documents never share a collection.

## Validation strategy

Zod validates all untrusted boundaries: environment variables, route params, query strings, request bodies, forms, imports, and external-provider responses. Schemas live outside React components and are reused only where the same contract is genuinely shared. Persistence documents are validated/mapped when read. Validation errors produce a stable public error code and field issues; logs may retain safe diagnostic context but must redact values marked as secrets or financial payloads.

## Canonical money representation

Money is `{ amountMinor: bigint, currency: ISO-4217-code }` in the domain. `amountMinor` is an integer number of the currency's minor units (agorot/cents for two-decimal currencies). This avoids JavaScript floating-point arithmetic as financial truth. APIs serialize it as `{ amountMinor: "12345", currency: "ILS" }`. MongoDB persistence will use signed BSON int64 with explicit adapters and range checks.

Rules:

- Addition/subtraction require identical currencies.
- Conversion between major and minor units happens only at validated input/provider adapters.
- Decimal parsing rejects excess fractional precision; it never silently truncates.
- Multiplication/division that creates fractions must name a rounding policy. The default financial allocation policy is round-half-to-even at the minor-unit boundary, with remainders allocated deterministically by stable ID when totals must be conserved.
- Currency conversion is not implemented in Phase 0. A future conversion requires an explicit rate, source, observed timestamp, source and target currency, calculation scale, and rounding event. Amounts in different currencies are never added directly.
- The Phase 0 value object validates safe currency codes, integer values, and int64 persistence range. It does not implement Safe to Spend.

## Dates, time, and calendar policy

- Persist event timestamps as UTC instants and name fields with `At` (`createdAt`, `updatedAt`, `syncedAt`).
- Store user timezone as an IANA timezone identifier on the profile. The browser proposes a default during onboarding, but the persisted value is explicit and editable.
- Store financial business dates that are date-only (`transactionDate`, billing day outcomes, due dates) as validated `YYYY-MM-DD` calendar dates plus the applicable timezone/context; do not coerce them through UTC midnight.
- Month boundaries, recurrence expansion, and forecast horizons are calculated in the user's configured timezone, then materialized to UTC instants when scheduling.
- Provider timestamps retain source metadata and are normalized once at the adapter boundary.
- Phase 0 includes strict UTC-instant and calendar-date validation, not timeline calculations.

## Financial calculation boundary

The deterministic financial engine is a pure domain module: typed snapshot/events in, typed calculated result out. It does not call MongoDB, Auth.js, Claude, clocks, or network providers. A server-only application service loads only actor-owned records, supplies the profile timezone/currency and explicit `asOf`/horizon, creates a source manifest, persists the versioned result, and returns a JSON-safe view. Route handlers authenticate and rate-limit this orchestration; they contain no financial calculations.

Safe to Spend evaluates the minimum projected balance across a typed evaluation horizon and the applicable safety margin; it is never current balance minus total expenses. The default policy is a rolling 30 calendar days, but the horizon is an explicit input. Only 100%-confirmed income increases the core safety value; uncertain income is carried separately. Percentage margins use confirmed income in the applicable user-timezone calendar month with round-half-to-even minor-unit arithmetic. Same-day obligations precede income unless reliable timestamps provide actual ordering. AI may explain a structured engine result but cannot calculate or mutate financial truth.

Phase 3 source mapping is deliberately conservative. `availableCash` is the sum of bank and cash accounts; `accountBalance` is bank accounts; detailed savings records take precedence over the onboarding savings-account fallback to avoid adding the same saving twice. Actual transactions inform realized monthly metrics and are never replayed against current balances. Confirmed scheduled income reaches core cash only when its destination is bank/cash and certainty is exactly 10,000 basis points. Recurring transaction income has no certainty field and therefore remains expected-only. Income directed to savings/investments does not increase available cash. Distinct source records are distinct events—even if their fields look identical—because no approved deduplication identity exists; this conservative behavior is explicit and tested.

## Dashboard read boundary

The Phase 4 dashboard is an owner-scoped read projection assembled on demand; it is not a second financial truth or a persisted cache. The dynamic server page derives its actor from Auth.js, loads the latest two owned engine snapshots for current value/change, loads the linked owned source manifest, compares current owned record revisions, and serializes a bounded view. The browser can request a new default-30-day snapshot only through the existing authenticated, origin-checked, rate-limited Phase 3 mutation route. Next/UI code never accepts `userId`, never queries MongoDB, and never caches one user's view for another.

## Phase 5 approved budget boundaries

Phase 5 must model category identity separately from presentation: stable owner-scoped system/custom identifiers retain references while user labels, visibility, and order may change. Real monthly allocations derive from confirmed income only and conserve exact minor units as `confirmed income - allocations = signed unallocated`; a negative result is a visible deficit, not a validation failure. Expected income and other hypotheticals belong to a separate scenario input/output boundary and never become confirmed allocation or core forecast data.

Budget periods use the profile timezone and currency. Each category stores an explicit rollover policy whose default is `reset`. Reset closes a period without carrying either surplus or deficit while preserving history; rollover carries the prior signed remainder according to stored rules. Refunds are recognized on their actual transaction date. Classification corrections are append-only evidence retaining original category, corrected category, actor, reason, and time; reports may project the corrected classification without mutating the original fact. Uncategorized transactions remain part of balances and conservative forecasts even when omitted from a named category subtotal.

## Phase 6 approved Goal Engine boundaries

The Goal Engine is a pure deterministic layer over actor-owned verified source records, Phase 3 engine snapshots, and finalized Phase 5 budget evidence. Each goal definition has an explicit metric kind, direction, target basis, owner-scoped record scope, sustained-success policy, and immutable version. It never accepts a client-supplied current value as verified truth and never asks AI to interpret success. Debt and account metrics use explicit stored scopes; savings/emergency-fund metrics use explicitly included verified liquid records; monthly-spending metrics use the applicable profile-timezone period and Phase 5 refund/correction policy. Custom metrics that cannot be derived from available data are represented as manual/unverified.

Existing Phase 1 goal values are migration input, not verified truth. The first tracked definition preserves their starting/current amounts as user-reported evidence while a separate engine-derived baseline and current verified value are created when the required source data exists. A disagreement remains visible and explainable. Material success-semantic edits create a new immutable goal-definition version; presentation edits may update the current view but cannot relabel old evidence.

`goalProgress` is an append-only evidence collection, not a page-view cache. Meaningful evaluations store goal/version, calculation and policy versions, exact metric inputs/outputs, evaluation time/date/timezone, source references, and engine/budget evidence when applicable. Milestone, threshold, sustained-success, completion, regression, reopen, and material-version events are immutable. Current status is a projection of that history: historical achievement and present maintenance remain separate facts.

Phase 6 stores immutable financial definitions in `goalDefinitions` and immutable evaluation evidence in `goalProgress`; both use owner-first indexes and exact BSON int64 money. `goalCommandReceipts` contains only technical owner-scoped idempotency aliases for commands that resolve to an existing immutable definition/evidence record. It prevents a no-op retry key from later being reused for different content without mutating the financial record itself. Receipt rows are not financial truth and are excluded from public exports.

Progress is direction-aware and retains raw baseline/current/target amounts, exact remaining gap, normalized basis-point percentage, trend, and provenance. Point-in-time goals may complete at threshold; stability goals model an explicit duration with a 30-calendar-day default and remain `target_reached_pending_confirmation` until continuous qualifying evidence satisfies it. Page reads never create evidence.

Evaluation time is server-derived; the public command cannot backdate progress. The server converts that instant to the profile timezone calendar date. A stable evidence hash covers the definition, date, owned/versioned sources, exact metric facts, target, direction, verification state, and sustained policy. Equivalent same-date evaluations deduplicate, while changed facts or later dates append new immutable evidence. Phase 6 introduced export schema version 3 for goal definitions/progress; Phase 7 advances the public owner-only export to version 4 with saved simulations while still excluding command receipts, ownership fields, Auth.js records, and secrets.

Verified progress and projected goal outcomes are different contracts. Phase 6 may expose the existing deterministic Phase 5 scenario boundary beside a goal, but it does not implement Phase 7 purchase simulation, Phase 12 advanced projections, or any AI/provider feature. Future projections may read an immutable goal version and verified baseline; they cannot mutate verified progress. Dependency direction is financial truth -> Financial Engine -> verified Goal Engine -> scenario/projection -> AI explanation.

## Phase 7 approved Purchase Simulation boundaries

Purchase impact is a pure deterministic projection over an immutable, actor-owned Phase 3 engine snapshot. The core result contains separate `riskClassification` and `dataFreshness` fields. `SAFE` requires every confirmed projected balance in the explicit evaluation horizon to remain at or above the applicable Safety Margin with all confirmed obligations coverable; `CAUTION` remains non-negative but crosses below margin; `UNSAFE` crosses below zero or otherwise proves a confirmed-cash shortfall. Equality with the margin is safe. Equality with zero is caution unless the applicable margin is also zero. AI is outside this calculation boundary.

The Phase 3 rolling 30-calendar-day product default remains an explicit simulation evaluation-horizon input; it is not hard-coded into timeline mechanics. Safer-date search evaluates identical purchase terms on each future calendar date and returns only the first `SAFE` date in the approved 90-day window. A proposed purchase date is bounded to 90 days after the snapshot evaluation point, and the selected 210-day source snapshot covers that input window, every search candidate, and each candidate's full 30-day evaluation. Incomplete coverage fails honestly rather than extrapolating unknown events. Calendar movement uses the profile's IANA timezone and existing date-only policy.

The user-entered amount is total purchase price. One-time or monthly-installment schedules use exact minor units, allocate any division remainder to the earliest installments, and conserve the exact true financed cost. Known interest and fees are separate explicit provenance-bearing inputs added to projected outflows; unknown charges are neither guessed nor estimated. The full schedule remains visible even when only installments inside an applicable rolling evaluation window affect a particular classification.

Freshness reuses Phase 4's owner-scoped manifest/profile/calendar comparison. A stale snapshot remains mathematically usable and keeps its deterministic classification, but the result and Hebrew UI disclose `STALE`; stale `SAFE` is never an unqualified current recommendation. Simulations remain ephemeral until an authenticated user explicitly saves one. Saved records are immutable owner-scoped evidence with input/schedule/charge provenance, snapshot and budget references where applicable, margin/minimum result, classification, freshness, safer date, engine/policy versions, and creation time. Saving never mutates source records, accounts, budgets, Safe to Spend, or verified goals.

Dependency direction remains: confirmed financial data -> deterministic Financial Engine -> deterministic purchase simulation -> classification/projection -> optional AI explanation. Phase 7 does not add Claude, bank/card-provider integration, purchase commitment, or Phase 12 advanced scenarios.

## Error handling and auditability

Typed application errors separate public status/code/message from private causes. Unknown errors return a generic response and are logged server-side with a correlation ID. Secrets, OAuth tokens, raw financial payloads, and MongoDB URIs must be redacted. Expected validation/auth/not-found/conflict errors are not silently swallowed.

Phase 1 and Phase 2 profile/manual mutations append redacted entity-local audit events atomically with the entity mutation: actor, action, timestamp, source, revision, and changed field names. Phase 3 immutable result documents append a calculation audit event containing only actor, timestamp, revision, source, and changed field names. Entries avoid credentials and raw before/after financial payloads. The current standalone MongoDB cannot provide multi-document transactions, so the source manifest and engine result are two immutable writes; an incomplete second write may leave a harmless owner-only manifest, never an unproven result. Future deployments may project a centralized append-only read model from these entity histories, and use cases must continue to state their atomicity requirements.

## Environment and secrets

`src/lib/config/server-env.ts` is the only general entry point for server environment parsing. It is guarded by `server-only`. `.env.example` contains names and non-secret example values only. `.env`, `.env.local`, and environment-specific local files are ignored. Only variables intentionally prefixed `NEXT_PUBLIC_` may enter browser code; Phase 0 requires none.

Required for operational Google sign-in and persistence:

- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `AUTH_URL` in hosted environments and an exact trusted-host policy

Future server-only placeholders are documented for Anthropic and Open Banking, but their adapters are not initialized in Phase 0. Vercel stores production secrets; no `.env` file is committed. Secret rotation and provider token encryption are operational requirements before those providers go live.

## External adapter boundaries

- **Open Banking (planned):** provider consent and tokens stay server-side. A provider adapter maps accounts, balances, cards, and transactions into provider-neutral normalized records. Manual data uses the same domain model and remains first-class. Username/password banking credentials are never collected or stored.
- **Claude (planned):** an AI port accepts a redacted, structured financial snapshot and returns a schema-validated explanation separated into fact, insight, and recommendation. It has no repository or credential access and cannot commit financial mutations.
- **Notifications (planned):** application events are mapped to provider-neutral notification commands; provider delivery identifiers remain in the adapter.
- **Monitoring/analytics (planned):** operational telemetry excludes raw financial details and sensitive identity data by default.

## Testing architecture

- Unit tests exercise pure money, dates, validation, authorization policies, the Phase 3 financial-engine policy/edge-case matrix, and Phase 4 dashboard projection/rendering behavior.
- Integration tests exercise repository ownership filters and real MongoDB/Auth/provider adapters in isolated test infrastructure. Credential-dependent suites must explicitly skip with a documented reason; mocks are permitted only at named adapter boundaries and never reported as real integration success. Phase 4 reuses the real-Mongo Phase 3 fixture to verify two-owner dashboard/read-manifest isolation.
- E2E tests use Playwright against isolated application/database boundaries as their phases arrive. The Phase 1 acceptance journey used the in-app Playwright controller with a real interactive Google/Auth.js session to complete, reload, review, and finish onboarding. Phase 2 reused a fresh real callback/session to create and reload exact manual account/transaction values and capture a source manifest. Phase 4 used the retained real Auth.js session to create/reload an engine snapshot, reconcile displayed values, refresh without change, switch timeline windows, and inspect Hebrew/RTL/ARIA output. Phase 6 used that real session to activate an owned scoped goal, create/deduplicate immutable evidence, inspect provenance, and verify the protected goal-management route. Phase 7 reused the real database session to create a 210-day owned baseline, evaluate exact `SAFE` and `UNSAFE` purchases, explicitly save/reload one synthetic scenario, verify stored owner/snapshot/BSON evidence, and inspect Hebrew/RTL/LTR/responsive output. No mocked auth or reusable authenticated storage state was committed. Later repeatable non-interactive suites require an approved secure test-identity/session strategy.
- Production builds, strict type-checking, ESLint, and tests are separate required checks. No rules or type errors are suppressed to make gates pass.

## Deployment architecture

The target is Vercel running Next.js over HTTPS, with MongoDB Atlas (or a compatible secured MongoDB deployment). Runtime secrets live in Vercel environment settings. Preview and production use separate OAuth callbacks, databases, and secrets. Database network policy, backups, restore drills, indexes, retention, monitoring, rate limiting, CSP/security headers, privacy controls, and observability are verified before production launch. Phase 0 proves a local production build only; it does not claim a Vercel deployment or live database.

## Collection conventions

- IDs are MongoDB `ObjectId` internally and opaque lowercase hex strings at service/API boundaries unless a domain requires a different stable provider ID.
- User-owned documents include `userId`, `createdAt`, and `updatedAt`; household-owned documents additionally include an authorized household scope.
- Financial amounts use the canonical money representation and currency.
- Source metadata distinguishes manual, imported, normalized open-banking, and generated projections without making a provider record the domain source of truth.
- Hard deletion is the default for a future user-requested full privacy erasure. Phase 1 ordinary record removal is an explicitly recoverable soft deletion that preserves the entity-local audit trail; full-account erasure must remove those documents. Audit retention must be reconciled with deletion/privacy policy before launch.
- Optimistic concurrency/version fields are added where concurrent edits or sync reconciliation can lose data.

## Non-negotiable invariants

1. No floating-point financial truth.
2. No client-supplied identity as authorization.
3. No financial query without an ownership scope.
4. No database or provider access from client/UI modules.
5. No AI-generated balances, forecasts, goals, debt values, or Safe to Spend.
6. No secrets in source control, browser bundles, logs, or AI context.
7. No later phase is considered implemented because a folder or interface exists.
