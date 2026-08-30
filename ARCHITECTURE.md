# Financial OS Architecture

## Purpose and status

This document defines the implemented architecture through the fully verified Phase 1 acceptance gate and the constraints that future phases must preserve. It distinguishes verified code from product capabilities that are only planned. `MASTER_PLAN.md` remains the product source of truth.

| Status | Meaning |
| --- | --- |
| Implemented in Phase 0 | A working, tested code or configuration foundation exists. |
| Implemented in Phase 1 | Working profile/manual-onboarding code exists and is verified at its stated boundary. |
| Verified in Phase 1 | Real Google OAuth, Auth.js MongoDB sessions, server-derived identity, sign-out, onboarding, and two-user isolation passed their operational gate. |
| Boundary prepared | An interface, module boundary, convention, or configuration seam exists; no provider capability is claimed. |
| Planned | The product behavior belongs to a later roadmap phase and does not exist yet. |

## System shape

```text
Browser UI
  -> Next.js server components / route handlers
    -> application services
      -> deterministic financial engine
        -> data-access repositories
          -> MongoDB

External systems -> server-only adapters -> application services
```

Dependency flow is inward. UI code may call server actions or route handlers, but never the database. Route handlers authenticate, validate, authorize, invoke one application use case, and translate results. They do not contain financial calculations. Application services orchestrate domain rules and repositories. The financial engine is pure and deterministic. Repositories are the only modules that issue MongoDB queries. Provider-specific Claude, banking, notification, and telemetry models terminate at adapter boundaries.

### Phase 0 implementation map

- **Implemented:** App Router shell, strict TypeScript, Tailwind, server/client separation, validated environment access, MongoDB client factory, user-scoped repository helpers, Auth.js-compatible Google configuration, server-side actor/authorization helpers, Zod validation helpers, integer-minor-unit money value object, UTC/calendar-date validation, typed public errors, unit/integration test layout, and build/lint/type-check scripts.
- **Boundary prepared:** repository interfaces, authenticated actor context, future household scope shape, financial-engine directory, external adapter directories, MongoDB health check, Google provider configuration boundary.
- **At Phase 0 acceptance:** onboarding, profile entities, mutation audit, and rate limiting were planned; their current status is recorded in the Phase 1 map below. Working sign-in against real Google credentials, household membership resolution, financial calculations, provider integrations, snapshots, and observability remain pending or later-phase work.

### Phase 1 implementation map

- **Implemented and tested without fake auth:** profile and onboarding schemas/services/repositories; manual income, account, card, recurring-expense, loan, safety-margin, and goal records; resumable ordered onboarding; review/completion UI; exact money input and BSON mappings; optimistic concurrency; entity-local mutation audit; ordinary-record soft deletion; mutation origin/body/rate controls; protected routes; sign-in/sign-out wiring.
- **Verified against real local MongoDB:** profile/manual persistence, user-prefixed indexes, BSON int64 money, onboarding state transitions, audit events, rate-limit counters, two constructed actors' read/update isolation, one active safety margin, and test-database cleanup.
- **Verified with real authentication:** two distinct Google callbacks; namespaced Auth.js user/account/session persistence in the configured database; real session-to-actor identity; sign-out/session deletion; server-derived profile ownership/audit actors; full authenticated Playwright onboarding; empty second-user reads; and denial of a second user's update against the first user's account.
- **Not started:** Phase 2 financial data platform/transactions, Financial Engine, Safe to Spend, Claude, Open Banking, households, forecasting, gamification, and later-phase capabilities.

## Phase 1 profile and onboarding architecture

The profile is the one-per-user root for manual onboarding. It stores locale context, primary currency, IANA timezone, household type, an optimistic `version`, and an ordered state machine:

```text
profile -> income -> accounts -> cards -> expenses -> debts
        -> safety_margin -> goals -> review -> complete
```

Each transition requires the current step, `in_progress` status, owner, and expected version to match atomically. Empty financial sections are allowed only through an explicit completion action. A completed review cannot be replayed. Reloading a page reads the persisted profile step and capability records, so the flow is resumable without client-owned progress state.

Manual onboarding uses separate collections—`incomeSources`, `accounts`, `creditCards`, `recurringExpenses`, `loans`, `safetyMargins`, and `goals`—plus `profiles`. The generic repository implementation is parameterized by a closed section enum, but each section maps to a distinct capability collection and distinct Zod domain schema. This avoids a monolithic user document while keeping Phase 1's repeated ownership/concurrency policy in one implementation.

Every financial document stores MongoDB `ObjectId` ownership derived from the server `Actor`, `source: "manual"`, `createdAt`, `updatedAt`, `deletedAt`, and `version`. Reads are bounded and filter by `{ userId, deletedAt: null }`; updates and removal additionally filter by `_id` and expected version. Ordinary removal is soft deletion so onboarding mistakes are recoverable and mutation history remains intact. A future full-account privacy erasure must hard-delete the profile, manual records, and applicable audit data under a separately reviewed policy.

The detected local MongoDB is a standalone deployment, so Phase 1 does not claim multi-document transactions. Each profile/manual mutation atomically updates the record and appends its redacted entity-local audit event in the same document. A future centralized audit/read model may project these events, but financial mutation success never depends on a non-atomic second write in the current topology.

Manual monetary input is a decimal string plus the profile's primary currency. Currency minor-unit precision comes from the runtime's ISO-backed `Intl.NumberFormat` metadata, excess fractional digits are rejected, and parsing uses string/`bigint` arithmetic only. Persistence uses explicit BSON `Long` conversion with int64 checks. Phase 1 does not perform currency conversion or allow records whose money differs from the profile currency.

Mutation routes require an exact configured `Origin`, `application/json`, and an actual UTF-8 body no larger than 16 KB. A MongoDB fixed-window limiter keys counters by a SHA-256 hash of actor ID plus action; raw actor IDs are not stored in the limiter collection. Expected public errors are mapped to stable responses with correlation IDs and `Cache-Control: no-store`.

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

Phase 1 creates only its profile/manual capability collections and the four explicitly namespaced Auth.js collections. Domain collections and indexes continue to arrive only with their owning feature phase. Auth.js and financial account documents never share a collection.

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

The deterministic financial engine will be a pure domain module: typed snapshot/events in, typed calculated result out. It does not call MongoDB, Auth.js, Claude, clocks, or network providers. Application services assemble authorized inputs, pass an explicit `asOf` instant/timezone and policy configuration, persist the resulting snapshot, and return a view model.

Safe to Spend will evaluate minimum projected balance across a timeline and the safety margin; it will not be implemented as current balance minus expenses. The final algorithm is deliberately deferred to Phase 3. AI may explain a structured engine result but cannot calculate or mutate financial truth.

## Error handling and auditability

Typed application errors separate public status/code/message from private causes. Unknown errors return a generic response and are logged server-side with a correlation ID. Secrets, OAuth tokens, raw financial payloads, and MongoDB URIs must be redacted. Expected validation/auth/not-found/conflict errors are not silently swallowed.

Phase 1 profile/manual mutations append redacted entity-local audit events atomically with the entity mutation: actor, action, timestamp, source, revision, and changed field names. Entries avoid credentials and full before/after financial snapshots. The current standalone MongoDB cannot provide multi-document transactions, so a centralized audit collection is not written as a second non-atomic operation. Future deployments may project a centralized append-only read model from these entity histories, and use cases must continue to state their atomicity requirements.

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

- Unit tests exercise pure money, dates, validation, authorization policies, and later every financial engine edge case.
- Integration tests exercise repository ownership filters and real MongoDB/Auth/provider adapters in isolated test infrastructure. Credential-dependent suites must explicitly skip with a documented reason; mocks are permitted only at named adapter boundaries and never reported as real integration success.
- E2E tests use Playwright against isolated application/database boundaries as their phases arrive. The Phase 1 acceptance journey used the in-app Playwright controller with a real interactive Google/Auth.js session to complete, reload, review, and finish onboarding. No mocked auth or reusable authenticated storage state was committed. Later repeatable non-interactive suites require an approved secure test-identity/session strategy.
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
