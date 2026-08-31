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

## ADR-022 — Auth.js cookies require an application-specific namespace

- **Decision:** Name every Auth.js cookie with the `financial-os.authjs` namespace. Preserve Auth.js's secure-cookie behavior by applying `__Secure-` to HTTPS cookies and `__Host-` to the HTTPS CSRF cookie.
- **Reasoning:** Browser cookies are scoped by hostname/path, not TCP port. A second Auth.js application on `localhost:3000` used the same default PKCE cookie name as Financial OS on port 3001, so the Financial OS callback received the other application's verifier and Auth.js rejected it with `InvalidCheck`.
- **Alternatives:** Stopping the other application or relying on login order was rejected because neither creates isolation. A different local hostname remains possible but would add OAuth and host configuration without removing the need for safe application cookie names.
- **Consequences:** PKCE, state, nonce, CSRF, callback, WebAuthn challenge, and session cookies do not collide with other localhost Auth.js apps. Production HTTPS retains secure prefixes. Cookie-name coverage is unit-tested.

## ADR-023 — Auth.js persistence is database- and collection-namespaced

- **Decision:** Pass `MONGODB_DB_NAME` explicitly to the Auth.js MongoDB adapter and use `authUsers`, `authAccounts`, `authSessions`, and `authVerificationTokens` instead of the adapter defaults.
- **Reasoning:** The application repositories already select `MONGODB_DB_NAME`, while the adapter otherwise selects the URI's default database. The default adapter collection `accounts` also conflicts with Financial OS's manual financial `accounts` collection and caused financial document mapping to encounter an Auth.js account document.
- **Alternatives:** Embedding the database in the URI alone was rejected because it duplicates configuration and permits drift. Sharing one `accounts` collection between unrelated schemas is invalid. Renaming the financial capability was rejected because the adapter's generic names are the collision source and all auth collections benefit from an explicit namespace.
- **Consequences:** Auth.js and financial records share the configured database without schema collisions, and session-to-profile ownership can be verified in one authoritative database. The adapter mapping is unit-tested. Existing records were migrated only after the configured database was verified to contain the known Auth.js records and no manual account documents.

## ADR-024 — Local Google sign-in always offers account selection

- **Decision:** Send Google's `prompt=select_account` authorization parameter from the sign-in action.
- **Reasoning:** Reusing Google's previously selected account made a second login appear distinct while Auth.js correctly linked it to the first identity. Explicit selection makes multi-user isolation acceptance and normal account switching deterministic without introducing another auth path.
- **Consequences:** Users see Google's account chooser on sign-in. Authentication still uses only the Google provider and the same Auth.js callback/session architecture.

## ADR-025 — Hebrew-first, RTL-first product localization

- **Decision:** Financial OS-controlled UI uses Hebrew and `dir="rtl"` by default. All user-facing copy is selected through `src/lib/i18n`; inherently LTR values are explicitly isolated with `dir="ltr"` or `<bdi dir="ltr">`. Internal implementation and engineering artifacts remain English. Provider-controlled UI is excluded.
- **Reasoning:** Hebrew/RTL is a permanent product requirement and must shape every surface as it is built. Treating it as late visual polish would create inconsistent onboarding, unsafe bidirectional rendering of financial identifiers, and expensive rewrites when later phases add dense financial UI.
- **Alternatives:** Scattered Hebrew literals were rejected because they make future locale support and completeness checks brittle. Globally forcing every value to RTL was rejected because currency codes, URLs, email addresses, technical identifiers, dates, and numbers become ambiguous. Introducing a full third-party localization framework now was rejected as unnecessary for one active locale.
- **Consequences:** The root document is Hebrew/RTL; Phase 1 navigation, forms, buttons, validation feedback, empty states, labels, review, and error boundaries are localized without a visual redesign. New phases must add their copy to the catalog and extend localization/directionality tests. A future English catalog can reuse the same component boundary. Internal API/error codes remain English, while clients map them to safe Hebrew messages.

## ADR-026 — Phase 2 evolves Phase 1 source collections without duplication

- **Decision:** Treat the Phase 1 manual collections as the first version of the Phase 2 source-data platform. Keep `accounts`, `incomeSources`, `creditCards`, `recurringExpenses`, and `loans` authoritative, and add only `transactions`, `recurringTransactions`, `savings`, and `financialSnapshots`. Actual income/expense movements live in `transactions`; expected income remains in `incomeSources`; planned recurring expenses remain in `recurringExpenses`; explicit recurring movement definitions live in `recurringTransactions`; loans remain the shared loan/debt capability.
- **Reasoning:** Creating parallel Phase 2 collections for concepts already captured during onboarding would create two conflicting sources of truth and require an unnecessary destructive migration. The distinctions above separate expected/planned data from actual movements while retaining the completed onboarding data.
- **Alternatives:** Copying onboarding documents into new collections was rejected because dual writes and reconciliation would immediately become financial-integrity risks. Collapsing every concept into `transactions` was rejected because expected income, obligations, cards, debts, and savings have different invariants and lifecycles.
- **Consequences:** Existing Phase 1 documents remain readable. New documents use schema version 2 and structured manual source metadata; repository mapping accepts the legacy `source: "manual"` representation without rewriting user data. Future provider normalization may extend the source union but must feed the same capability model.

## ADR-027 — Owner-scoped idempotency, cursors, and references

- **Decision:** Phase 2 create mutations require a UUID idempotency key. The repository stores only SHA-256 key and canonical-payload hashes under a unique `{ userId, idempotencyKeyHash }` index. An identical retry returns the original record; a changed payload with the same key conflicts. Lists use bounded ObjectId cursors and owner-prefixed indexes. Transaction account references are resolved server-side and must point to active records owned by the same actor.
- **Reasoning:** Retried financial writes must not silently duplicate records, cursor pagination must remain stable and bounded, and client-provided object IDs cannot establish ownership. Per-owner hashing prevents raw retry tokens from becoming stored identifiers and allows different users to use the same client key safely.
- **Alternatives:** Unbounded lists and offset pagination were rejected for growth and consistency reasons. Global idempotency uniqueness was rejected because keys are client-generated and user-relative. Returning an existing record for a changed payload was rejected because it hides an integrity conflict.
- **Consequences:** New browser forms retain a key across an uncertain retry and clear it after success or a user edit. Optimistic versions remain the update/delete conflict mechanism. Every custom Phase 2 index begins with `userId`; `_id` remains MongoDB's built-in global primary index.

## ADR-028 — Phase 2 snapshots are immutable source manifests, not calculations

- **Decision:** Store Phase 2 financial snapshots as versioned, immutable `source_manifest` documents containing the profile currency and the owned source record IDs, versions, and update timestamps included at capture time. Do not store calculated balances, cash flow, forecast, timeline, net worth, or Safe to Spend until the deterministic Phase 3 engine and its policies are approved. Exports are separate bounded owner-only JSON views and exclude internal ownership, audit, idempotency, authentication, and provider fields.
- **Reasoning:** Phase 2 requires snapshot storage and auditability but explicitly excludes final calculations. A source manifest establishes provenance and staleness checks without inventing engine outputs. Keeping exports on public view models avoids exposing server-only fields.
- **Alternatives:** Persisting guessed calculated fields was rejected as Phase 3 work and false financial truth. Storing one unbounded copy of every full financial record in a snapshot was rejected because it recreates giant-document drift and MongoDB document-size risk. A non-versioned count-only snapshot was rejected because it cannot identify which record revisions were represented.
- **Consequences:** Phase 3 may add versioned calculated outputs associated with a source manifest and input hash after policy approval. Reproducing historical values after source mutation will require a reviewed event/version retention design; the Phase 2 manifest detects version drift but does not pretend to preserve a full historical ledger.

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

## Phase 1 real-authentication verification addendum — 2026-08-30

- Two distinct interactive Google OAuth callbacks completed at `http://localhost:3001/api/auth/callback/google`; no provider, session, or browser state was mocked.
- The first callback failure was traced to a cross-port localhost PKCE-cookie collision. ADR-022's namespace fix passed a real retry. A separate `accounts` schema collision was then traced to the Auth.js adapter defaults and resolved by ADR-023.
- The configured database persisted exactly two Google-linked auth users/accounts. Each active session resolved to its linked MongoDB user and was removed by real Auth.js sign-out; protected navigation then redirected to `/sign-in`.
- The first authenticated Playwright browser journey created, reloaded, reviewed, and completed a profile containing one record in every Phase 1 manual section. MongoDB ownership and audit actors matched the real session user, and money persisted as BSON `Long`.
- The second real Google user began with empty income/accounts views. An authenticated direct update against the first user's account was rejected with `409 CONFLICT`, the first record was unchanged, and the two profiles retained distinct owners.
- Final regression evidence: 59 tests passed with five declared infrastructure skips; the real-Mongo suite passed 5/5; strict type-check, zero-warning lint, production build, dependency audit with zero vulnerabilities, and port-3001 runtime/security smoke passed.
- `.env.local` remained ignored and untracked; secrets were not printed, logged, committed, or pushed. The tracked secret-pattern review found no real credentials.
- The accepted browser journey used the app's Playwright browser controller with the real interactive session. No reusable authenticated storage state was committed because it would be sensitive. A repository-owned non-interactive E2E suite remains a later operational-hardening task, not a substitute for this completed real-auth gate.
- Phase 1 is accepted. Phase 2 has not started and requires explicit project-owner approval.

## Hebrew/RTL localization verification addendum — 2026-08-31

- The root production document reports `lang="he"` and `dir="rtl"`; the landing, sign-in, navigation, onboarding catalog, review, not-found, and error surfaces use Hebrew.
- Product copy and public error-code localization are centralized under `src/lib/i18n`. Domain/API identifiers and internal errors remain English, and clients no longer display arbitrary server messages.
- Explicit LTR isolation covers currency/country codes, IANA timezones, financial values, dates, percentages, and numeric inputs. Provider-controlled Google UI remains unchanged.
- The localization suite passed 5/5 tests; the complete suite passed 64 tests with five explicit infrastructure skips; real MongoDB passed 5/5. Type-check, lint, production build, dependency audit, and rendered browser inspection passed.
- The existing design was preserved. Phase 2 has not started.

## Phase 2 verification addendum — 2026-08-31

- Phase 2 reuses the Phase 1 source collections and adds `transactions`, `recurringTransactions`, `savings`, and `financialSnapshots`; no destructive migration or parallel source of truth was introduced.
- The real-Mongo full suite passed all 78 tests in 17 files with no skips. Evidence covers owner-scoped CRUD and references, idempotency/conflicts, pagination, BSON int64 mapping, indexes, audit, snapshot isolation, safe export views, and prior Phase 0/1 regressions.
- A real Google callback and MongoDB-backed Auth.js session drove the protected Playwright journey. The Hebrew/RTL UI created and reloaded exact manual account and transaction amounts, then captured an immutable source manifest. A database read-only check matched both record owners to the active session without printing identifiers or tokens.
- The initial callback retry failure was operational: the local server process lacked outbound HTTPS permission and Google discovery failed with `EACCES`. Restarting only port 3001 with outbound access restored the unchanged OAuth security architecture. The acceptance journey then exposed and fixed an async form-reference lifecycle defect.
- Strict type-check, zero-warning lint, production build, security-header/unauthenticated-route smoke checks, and the registry-backed audit with zero vulnerabilities passed. `.env.local` remained ignored and untracked.
- Phase 2 is accepted. Phase 3 remains blocked on the documented product decisions for forecast-confidence semantics and the exact Safe to Spend horizon/policy; no engine implementation may encode guesses for them.

## Open product/engineering questions

- The exact user-facing set of supported currencies and per-currency minor-unit precision needs product definition before onboarding accepts money.
- Audit retention versus full account deletion needs legal/privacy input before production.
- The licensed Open Banking provider, jurisdiction, token-encryption/KMS design, and consent requirements remain undecided.
- Household private/shared resource semantics need product rules before Phase 11.
- Forecast confidence semantics and the precise Safe to Spend horizon/policy need product approval during Phase 3, backed by deterministic fixtures.
