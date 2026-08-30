# Financial OS Decision Log

This log records durable product and architecture decisions. Status is `accepted` unless explicitly marked provisional. Verification outcomes and new decisions are added as implementation progresses.

## ADR-001 — Canonical money representation

- **Decision:** Represent domain money as integer minor units in TypeScript `bigint`, always paired with an uppercase ISO 4217 currency code. Serialize minor units as a base-10 string. Persist through an explicit BSON int64 adapter with range checks.
- **Reasoning:** Integers make calculations deterministic and avoid binary floating-point drift. `bigint` prevents accidental unsafe-number arithmetic; a string transport avoids unsupported JSON bigint serialization and precision loss.
- **Alternatives:** JavaScript `number` was rejected for financial truth. Decimal major-unit storage was rejected as the default because it permits inconsistent scales. Decimal libraries remain an option inside explicit exchange-rate/interest calculation boundaries but cannot replace the canonical stored amount.
- **Consequences:** All amount inputs need currency precision validation. Arithmetic APIs reject mixed currencies. Persistence and JSON need mapping. Default fraction rounding is half-even; allocation remainders require deterministic distribution.

## ADR-002 — Currency and conversion boundary

- **Decision:** No implicit currency conversion. Cross-currency calculations require a future explicit conversion record with currencies, rate, rate source, observed time, precision, and rounding result.
- **Reasoning:** Adding nominal amounts across currencies creates incorrect financial truth.
- **Consequences:** Phase 0 supports validated currency-tagged values only. Multi-currency totals must remain grouped until the conversion phase is designed.

## ADR-003 — Authentication foundation

- **Decision:** Use NextAuth/Auth.js-compatible App Router handlers, Google OAuth, MongoDB adapter persistence, and server-derived sessions. The credential-free build exposes authentication as unconfigured rather than using fake auth.
- **Reasoning:** It meets the planned Google sign-in model, keeps credentials server-side, and centralizes session derivation.
- **Alternatives:** Custom OAuth/session code was rejected due to security and maintenance risk. A fake development user was rejected because it would undermine authorization validation.
- **Consequences:** Operational sign-in is blocked until Google OAuth, `AUTH_SECRET`, and MongoDB are configured. Phase 1 must verify the real callback and persisted user before claiming auth complete.

## ADR-004 — Authorization and ownership

- **Decision:** Derive an authenticated `Actor` on the server and pass it to services/repositories. Repositories construct `userId` predicates; normal client DTOs never choose the owner. Updates and reads use compound ID-plus-owner predicates.
- **Reasoning:** UI checks and arbitrary client `userId` values cannot provide data isolation.
- **Consequences:** Repository APIs are intentionally actor-aware. Negative cross-user tests are required for each financial repository. Household access cannot ship until server-side membership/role checks exist.

## ADR-005 — MongoDB modeling strategy

- **Decision:** Use separate capability-owned collections introduced with their phase, explicit document/domain mappers, and user-prefixed indexes. Do not store a user's complete financial life in one document.
- **Reasoning:** Independent domains, sync reconciliation, querying, concurrency, and retention need separable models.
- **Consequences:** Some cross-domain views require application services or snapshots. Collection/index migrations must be versioned with their feature.

## ADR-006 — Data Access Layer

- **Decision:** Only server-only repository modules access the MongoDB driver. Route handlers call application services; domain logic remains database-independent.
- **Reasoning:** This preserves testability, enforces ownership consistently, and prevents database details from leaking into the UI/domain.
- **Consequences:** Direct database calls in pages, components, and route handlers are architecture violations.

## ADR-007 — Validation boundaries

- **Decision:** Use Zod at environment, HTTP/form, external adapter, and persistence mapping boundaries. Treat every value outside the current trusted layer as untrusted.
- **Reasoning:** TypeScript types do not validate runtime data.
- **Consequences:** Schemas and public issue responses are part of each feature's definition of done.

## ADR-008 — Date and timezone policy

- **Decision:** Store instants in UTC and date-only financial events as strict `YYYY-MM-DD` calendar dates with explicit timezone context. Store the user's IANA timezone in their profile. Compute financial periods in that timezone.
- **Reasoning:** Coercing due/billing dates to UTC midnight changes the calendar day in some zones and corrupts timeline behavior.
- **Consequences:** Services require explicit `asOf` and timezone inputs; tests must cover DST and month boundaries before timeline features ship.

## ADR-009 — Error responses

- **Decision:** Map typed application errors to stable public codes/statuses and hide internal causes. Return the same not-found shape for missing and unauthorized owned resources when existence is sensitive.
- **Reasoning:** Raw errors leak infrastructure and resource-existence details.
- **Consequences:** Server logs need correlation IDs and redaction; no route may return a raw thrown error.

## ADR-010 — Environment and secrets

- **Decision:** Parse server configuration lazily in a `server-only` module. Permit missing external credentials at build time, report capabilities as unconfigured, and fail only when the unavailable capability is invoked. Commit placeholders only.
- **Reasoning:** CI and local builds should not need production secrets, while integrations must never pretend to work.
- **Consequences:** Each adapter must declare and validate its runtime requirements. Hosted environments supply secrets through Vercel settings.

## ADR-011 — Testing stack

- **Decision:** Use Vitest for Phase 0 unit/integration suites, strict TypeScript, ESLint, and Next.js production builds as independent gates. Add Playwright E2E infrastructure when the first real browser journey arrives in Phase 1.
- **Reasoning:** Phase 0 primarily contains pure/server foundations. Installing a browser runner with no user journey would add weight without meaningful coverage.
- **Alternatives:** Empty or mocked E2E tests were rejected as misleading.
- **Consequences:** Phase 1 must add the initial authenticated/onboarding E2E harness and isolated test data before its acceptance review.

## ADR-012 — External adapters and deterministic truth

- **Decision:** Open Banking, Claude, notifications, and monitoring integrate only behind server-only ports/adapters. Manual and bank-originated data normalize to the same domain. The financial engine alone produces calculated financial truth.
- **Reasoning:** Provider models and generative output must not dictate core domain behavior.
- **Consequences:** Claude receives structured snapshots without credentials and cannot directly mutate records. Banking credentials are never collected. Provider contract tests are required later.

## ADR-013 — Auditability and deletion

- **Decision:** Meaningful financial mutations will emit append-only, redacted audit events. Privacy deletion is hard deletion unless a documented legal/reconciliation requirement mandates limited retention.
- **Reasoning:** Financial changes need traceability while user privacy and erasure remain product requirements.
- **Consequences:** The audit schema and retention policy must be resolved before Phase 1 financial mutation APIs and revisited before production.

## ADR-014 — Dependency baseline and Auth.js security exception

- **Decision:** Pin exact compatible versions selected at Phase 0: Next.js 16.3.3, React 19.2.8, Tailwind CSS 4.3.3, Auth.js/NextAuth 5.0.0-beta.32, MongoDB driver 6.21.0 (required by the Auth MongoDB adapter), Zod 4.5.4, TypeScript 5.9.3, ESLint 9.39.5, and Vitest 4.1.11. Auth.js beta.32 is a deliberate security exception to the stable-version preference. ESLint 9 is a temporary tooling-compatibility exception.
- **Reasoning:** The npm audit found two critical advisories in current stable NextAuth 4.24.15 through Auth.js core 0.34.3. The audit-designated older fix (NextAuth 4.24.7) declares peer support only through Next 14 and React 18. The official 5.0.0-beta.32 uses patched Auth.js core 0.41.3 and declares Next 16/React 19 compatibility. Security and mutual compatibility outweigh prerelease stability. The MongoDB adapter requires driver major 6. TypeScript 5 is the mature framework-compatible line; TypeScript 7 and MongoDB 7 were not selected merely because their registry tags are newer. Although the Next.js config declares ESLint `>=9`, its bundled React plugin crashes under ESLint 10.9.1; ESLint 9.39.5 is therefore retained with zero known audit findings rather than disabling lint rules.
- **Consequences:** Auth configuration uses the v5 API and is pinned to an exact beta. ESLint 9 emits an upstream support warning during installation and should move to ESLint 10 only after the Next lint plugin is compatible. Renovation is explicit and gated by audit, tests/build, and changelog review. The lockfile is committed. A stable Auth.js 5 release should replace the beta after compatibility/security review. Dependency audit findings are reviewed, never blindly force-fixed.

## ADR-015 — Initial HTTP and deployment security policy

- **Decision:** Apply a conservative global Phase 0 header baseline: content security policy, frame denial, MIME sniff prevention, strict-origin referrer policy, restrictive browser permissions, and removal of the framework-identifying header. Require HTTPS for production `AUTH_URL` and secure cookies. Do not set HSTS until an actual HTTPS host is configured; do not claim rate limiting or a nonce-based CSP in Phase 0.
- **Reasoning:** Useful browser hardening can be verified locally, while HSTS on a local HTTP origin and an untested strict nonce policy could break access or application boot. Transport and dynamic nonce controls depend on deployment infrastructure.
- **Alternatives:** No headers until production hardening was rejected because several low-risk protections are available now. Claiming a fully strict CSP or HTTPS locally was rejected as misleading.
- **Consequences:** The current CSP permits inline framework script/style execution and must be strengthened with nonces after authenticated dynamic rendering is introduced. HSTS, rate limiting, origin/proxy review, and deployment-level TLS validation are mandatory before launch.

## ADR-016 — Phase 1 profile root and manual capability collections

- **Decision:** Store one `profiles` document per user as the onboarding state root. Store manual income, accounts, cards, recurring expenses, loans, safety margins, and goals in separate capability collections, while using one closed-section repository implementation for their shared ownership, audit, and concurrency mechanics.
- **Reasoning:** A single user document would create a growing write hotspot and make later sync/reconciliation difficult. Seven copy-pasted repositories would make security predicates drift. Closed schemas and collection mapping preserve distinct domains without duplicating the invariant-bearing persistence code.
- **Consequences:** Collections are `profiles`, `incomeSources`, `accounts`, `creditCards`, `recurringExpenses`, `loans`, `safetyMargins`, and `goals`. Every collection has user-prefixed indexes. Phase 2 may add richer capability repositories without changing ownership or stored money conventions.

## ADR-017 — Ordered resumable onboarding with optimistic transitions

- **Decision:** Persist onboarding as an ordered state machine from profile through review. A transition atomically requires owner, current step, `in_progress` status, and expected profile version. Empty sections require an explicit completion action, and completed review cannot be replayed.
- **Reasoning:** Client-only progress can be skipped, lost, or tampered with. Optimistic versioning prevents two tabs from silently overwriting progress while allowing a user to resume on another device.
- **Consequences:** Section records may be edited independently, but progress advancement is serialized through the profile. Conflict responses require reload. A zero-record section is meaningful only after the user explicitly completes it.

## ADR-018 — Entity-local atomic audit and recoverable record removal

- **Decision:** Append a redacted audit event to the same profile/manual document in every create/update/delete mutation. Ordinary manual-record deletion is a soft deletion; a future full-account privacy erasure remains hard deletion across owned data.
- **Reasoning:** The verified local MongoDB is standalone and cannot provide multi-document transactions. A separate audit write could succeed or fail independently of the financial mutation. Keeping the event in the entity update makes the current audit guarantee atomic and retains recovery groundwork for onboarding mistakes.
- **Alternatives:** Non-transactional dual writes were rejected as an integrity weakness. Requiring a replica set for all local work was rejected because the entity-local model remains valid on both standalone and transactional deployments.
- **Consequences:** Active queries filter `deletedAt: null`. Audit events store action, actor ID, timestamp, revision, source, and changed field names—not full sensitive snapshots. A later centralized audit view can project entity histories. Before production, legal/privacy review must define retention and full-account erasure behavior.

## ADR-019 — Phase 1 primary-currency input precision

- **Decision:** Accept decimal money as a string and obtain the currency's minor-unit count from runtime ISO-backed `Intl.NumberFormat` metadata. Parse with string/`bigint` arithmetic, persist as BSON int64, and require all Phase 1 manual money to match the profile's primary currency.
- **Reasoning:** This safely supports zero-, two-, and three-decimal currencies without a hand-maintained table or floating-point conversion. A single onboarding currency avoids premature exchange-rate policy.
- **Consequences:** Excess precision is rejected, not rounded. Currency conversion and mixed-currency totals remain unimplemented. A curated user-facing currency list is still a product decision, but unknown/non-runtime-supported codes cannot silently acquire guessed precision.

## ADR-020 — Phase 1 mutation boundary controls

- **Decision:** Require exact configured-origin mutation requests, JSON content, an actual UTF-8 body size of at most 16 KB, optimistic versions for mutable records, and a MongoDB fixed-window per-actor/action limiter. Hash actor IDs before writing limiter keys.
- **Reasoning:** Authenticated cookies require CSRF-conscious origin enforcement; content and size bounds reduce parser abuse; optimistic versions protect integrity; persistent limiter counters work across application processes without exposing raw identity in the limiter collection.
- **Consequences:** Browser mutations must originate from `AUTH_URL`. Proxies and production origin settings need deployment validation. The current 30-per-minute mutation policy is a safe Phase 1 baseline, not a final capacity model, and auth-provider edge rate limiting remains deployment work.

## ADR-021 — Loopback HTTP is a local-only configuration exception

- **Decision:** Permit `http://localhost` and other loopback hosts for `AUTH_URL` even when `NODE_ENV=production`, because `next build`/`next start` use production mode locally. Continue to require HTTPS for every non-loopback production origin.
- **Reasoning:** Rejecting loopback HTTP made a safe local production build impossible, while broadly allowing production HTTP would weaken cookie and OAuth transport expectations.
- **Consequences:** Local production smoke tests can use loopback without TLS. Any preview or deployed hostname must use HTTPS and secure cookies; this exception does not justify non-loopback plaintext deployment.

## Phase 0 verification addendum — 2026-08-30

- Money, rounding, dates/timezones, environment readiness, placeholder rejection, ownership filters, and safe errors are covered by 33 passing tests.
- One real MongoDB ownership test is explicitly skipped because no isolated `MONGODB_TEST_URI` is available; live data isolation is not claimed.
- Strict TypeScript, zero-warning ESLint, and the Next.js production build pass.
- The final npm audit reports zero vulnerabilities after the Auth.js security migration.
- Runtime smoke checks returned 200 for the root and health route, 503 for intentionally unconfigured auth, and the expected security headers.
- Secret-pattern scanning found no committed credentials; local environment files and generated build/dependency artifacts are ignored.

## Phase 1 credential-free verification addendum — 2026-08-30

- The ignored `.env.local` contains empty auth/provider fields and loopback-only MongoDB/origin configuration; no real credentials were added.
- The credential-free suite passes 55 tests with five explicit integration skips. An environment-scoped real-local-Mongo run passes all four integration files and five tests.
- Real MongoDB evidence covers profile/onboarding persistence, manual records and BSON int64 money, audit/soft deletion, rate limiting, and isolation for constructed actors.
- Strict TypeScript, zero-warning ESLint, production build, runtime fail-closed smoke checks, and the registry-backed dependency audit pass.
- Google callback, Auth.js database sessions, real session-to-actor identity, authenticated route ownership, two authenticated users' isolation, and authenticated Playwright E2E remain pending. Phase 1 is not accepted and Phase 2 has not started.

## Open product/engineering questions

- The exact user-facing set of supported currencies and per-currency minor-unit precision needs product definition before onboarding accepts money.
- Audit retention versus full account deletion needs legal/privacy input before production.
- The licensed Open Banking provider, jurisdiction, token-encryption/KMS design, and consent requirements remain undecided.
- Household private/shared resource semantics need product rules before Phase 11.
- Forecast confidence semantics and the precise Safe to Spend horizon/policy need product approval during Phase 3, backed by deterministic fixtures.
