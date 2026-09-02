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

## ADR-029 — Phase 3 Safe to Spend policy package

- **Decision:** Use an explicit horizon input with a rolling 30-calendar-day default. Only 100%-confirmed income may increase core Safe to Spend; uncertain income remains separately visible. Calculate percentage Safety Margin from confirmed income in the applicable calendar month in the user's configured timezone with integer-minor-unit, round-half-to-even arithmetic. When an obligation and income share a calendar date without reliable timestamps, order the obligation first; actual timestamps may supersede this fallback later.
- **Reasoning:** Safe to Spend is a safety value, so uncertain income cannot fund present spending. A typed horizon prevents the 30-day product default from constraining future 7/14/60/90-day views. Calendar-month margin basis must follow the user's timezone. Conservative same-day ordering prevents an unknown intraday sequence from hiding a temporary safety violation.
- **Alternatives:** Probability-weighting uncertain income into core Safe to Spend was rejected because an expected value is not guaranteed liquidity. Hard-coding 30 days inside the algorithm was rejected because horizon is policy. Income-first same-day ordering was rejected because it assumes unavailable timing evidence. Floating-point percentage multiplication was rejected under the canonical money invariant.
- **Consequences:** Engine inputs and outputs explicitly distinguish confirmed and uncertain events. Tests must prove that uncertain income never raises core Safe to Spend, horizon changes do not require engine changes, half-even margin rounding is deterministic, month/timezone selection is correct, and obligations win same-day fallback ties. Phase 4 may present additional horizons but must not reimplement these calculations.

## ADR-030 — Conservative Phase 2 source-to-engine mapping

- **Decision:** Define Phase 3 available cash as bank-plus-cash account balances and the displayed account balance as bank accounts. Use detailed `savings` records when present, otherwise fall back to onboarding accounts typed as savings; never add both without a shared identity. Treat actual transactions as realized monthly metrics, not future balance movements. Only 10,000-basis-point scheduled income directed to bank/cash becomes confirmed engine income. Preserve lower-certainty income and recurring-transaction income without a certainty field as uncertain. Exclude savings/investment-destination income from available-cash events. Treat separate source records as separate events even when their visible fields match.
- **Reasoning:** Current balances already incorporate realized transactions, so replay would double-count. Savings records and savings-typed accounts have no approved linkage, so adding both could duplicate assets. Income without explicit 100% certainty cannot satisfy ADR-029. Field-similarity deduplication could silently erase real obligations; counting separately is the conservative and auditable choice until source identity/linking exists.
- **Alternatives:** Replaying actual transactions, assuming recurring income is confirmed, including restricted-destination income in liquidity, adding both savings representations, and heuristic deduplication were rejected as unsafe or untraceable.
- **Consequences:** Phase 4 must label these metrics consistently and must not recalculate them. A future source-linking/migration policy may refine deduplication or savings precedence, but must version the engine/policy and preserve existing snapshot interpretation.

## ADR-031 — Versioned calculated snapshots share the manifest collection

- **Decision:** Extend `financialSnapshots` with an immutable, discriminated schema-version-1 `engine_result` document rather than create another truth collection. Store owner, calculation audit metadata, source-manifest ID, engine/policy versions, canonical input hash, and exact BSON-int64 result. Source and result queries always include both owner and `kind`; idempotency hashes are derived separately for the paired manifest and result writes.
- **Reasoning:** ADR-028 intentionally reserved this extension. Co-locating immutable snapshot kinds preserves one snapshot boundary while explicit discriminators prevent mapping confusion. Linking the result to exact source record revisions and hashing canonical input makes provenance and deterministic comparison testable.
- **Alternatives:** Mutating a Phase 2 source manifest in place was rejected because manifests are immutable. Persisting only a computed value was rejected because it loses timeline, policy, and provenance. A UI-only calculation was rejected because it violates engine truth, ownership, and auditability.
- **Consequences:** The standalone MongoDB deployment cannot atomically write both documents; a failed result write may leave an owner-only source manifest but never a false result. Historical reconstruction still requires future source-version retention; Phase 3 proves reproducibility when the same typed input is available and records its hash/version honestly.

## ADR-032 — Dashboard is a bounded freshness-aware snapshot projection

- **Decision:** Build Phase 4 as a dynamic, server-authenticated view of the latest owned Phase 3 engine snapshot, not a cached/persisted dashboard model. Mark it stale when the linked owned manifest differs from current source revisions, the profile changed after calculation, the manifest cannot be loaded for that actor, or the user's timezone has entered another calendar day. Keep stale values visible with a clear reason and require an explicit authenticated refresh. Filter the already-calculated timeline into 7/14/30-day windows; do not recalculate money in React. Limit each client window to 100 events and the goal list to 20 priority-ordered records with visible truncation notices.
- **Reasoning:** Persisting or calculating dashboard totals would create a competing financial truth and cross-user cache risk. Exact source/profile/day freshness makes staleness explainable without an arbitrary wall-clock threshold. Explicit refresh avoids hidden writes during GET rendering. Bounded serialized views minimize financial payload exposure and rendering risk.
- **Alternatives:** UI-side Safe to Spend calculations, automatic snapshot writes during page reads, shared response caching, silently showing stale values, and unbounded event/goal payloads were rejected. Advanced goal progress was deferred to Phase 6 rather than guessed in Phase 4.
- **Consequences:** Phase 4 adds no collection and no new financial formula. On-screen alerts are deterministic status derived from the snapshot and are not Phase 17 notifications. A future cache/read model must preserve owner keys, engine provenance, freshness semantics, and the no-UI-calculation invariant.

## ADR-033 — Budget truth, rollover, corrections, and scenarios remain explicit

- **Decision:** Use a hybrid budget taxonomy with stable internal system/custom category IDs and mutable user labels, visibility, and order. Real zero-based allocations use confirmed income only. Over-allocation is permitted and represented as exact negative unallocated money. Rollover is stored per category and defaults to `reset`; reset periods preserve their historical surplus/deficit without carrying it, while rollover categories carry signed balances under their configured rule. Refunds reduce spending in the period received, linking to the original transaction where possible. Category corrections append immutable evidence rather than silently rewriting facts. Uncategorized transactions remain fully present in cash truth. Core conservative forecasts and hypothetical scenario/goal forecasts are distinct deterministic calculations.
- **Reasoning:** Stable IDs protect references while letting users own their taxonomy. Confirmed-only allocation and isolated scenarios preserve the conservative truth established in Phase 3. Signed deficits, actual-period refunds, explicit rollover, and append-only corrections make monthly plans reconcilable and explainable.
- **Alternatives:** Label-as-identity categories, uncertain-income allocation, blocking over-allocation, implicit universal rollover, backdating later refunds, destructive category rewrites, excluding uncategorized cash activity, and mixing scenario values into core forecasts were rejected.
- **Consequences:** Budget documents, indexes, services, APIs, UI, exports, and tests must preserve owner scope and stable IDs; exact allocation conservation must include a signed unallocated result. Historical reports may render corrected classifications but must retain original category, actor, time, and reason. Scenario values may never persist as confirmed transactions, allocations, balances, or engine inputs without a separate confirmation event. AI is outside this calculation boundary.

## ADR-034 — Freeze closed budget evidence and project corrections separately

- **Decision:** Persist one owner-scoped budget-period document per profile-timezone calendar month with optimistic versions, exact allocation items, and entity-local audit evidence. Closing a completed month freezes its calculated category results and next-period signed carry inputs; creating a later period prevents retroactive save or close of an earlier period. Store category corrections in a separate append-only collection and project the latest correction when reporting, without mutating the source transaction or closed-period evidence. Base scenarios on the latest owned Phase 3 conservative engine result and return them without persistence.
- **Reasoning:** A frozen close and forward-only rollover chain make historical results reproducible. Separate correction evidence permits truthful corrected reporting while retaining what the transaction originally said. Reusing the owned core snapshot gives scenarios a provenance-bearing confirmed baseline without creating a second forecast truth or allowing hypothetical values into real records.
- **Alternatives:** Recomputing closed periods after later edits, mutating transaction categories, overwriting prior corrections, deriving carry from mutable current data, accepting client-provided scenario baselines, and persisting what-if results as real financial records were rejected.
- **Consequences:** Corrections after close can change the current reporting projection but cannot rewrite the frozen close; the UI and export can explain both. Month-close is limited to completed profile-timezone months. The current standalone MongoDB topology relies on atomic single-document period updates and append-only correction inserts rather than claiming multi-document transactions.

## ADR-035 — Goal types use versioned deterministic metric strategies

- **Decision:** Represent every tracked goal as an immutable versioned definition with an explicit canonical metric strategy, direction, target, record scope, target basis, and sustained-success duration. Debt freedom sums explicitly scoped liability balances toward zero; overdraft uses explicitly scoped actual account balances toward non-negative; credit independence requires deterministic coverage without increasing overdraft/revolving/debt dependence; emergency funds and savings count explicitly scoped verified funds; monthly spending evaluates actual qualifying spending against a ceiling under Phase 5 rules; custom goals are engine-verified only when their metric is explicitly supported, otherwise manual/unverified. Preserve Phase 1 starting/current amounts as user-reported evidence and create a separate verified baseline when data permits.
- **Reasoning:** Goal labels and user-entered values cannot establish financial truth. Explicit strategies and scopes keep unrelated records from silently redefining historical progress, while separate manual and verified baselines preserve provenance during migration.
- **Alternatives:** One generic percentage formula, implicit all-record scope, treating manual values as verified, AI interpretation of custom goals, and point-in-time positive cash as proof of credit independence were rejected.
- **Consequences:** Goal creation/activation validates owned scope records and same-currency values. Strategy calculation stays pure and versioned. Presentation-only edits may remain on the current goal view; changes to success semantics create a new definition version and retain the prior one. Unsupported custom goals remain clearly manual and cannot receive engine-verified completion.

## ADR-036 — Goal progress is append-only evidence with explicit lifecycle semantics

- **Decision:** Persist progress only for meaningful deterministic evaluation events in append-only `goalProgress` records linked to the owner, goal ID/version, evaluation time, metric inputs/outputs, policy version, and applicable Financial Engine snapshot or budget period. Progress is direction-aware and retains raw values beyond target plus remaining gap, normalized basis-point percentage, trend, provenance, and milestone events. Point-in-time goals may complete at threshold. Stability goals default to an explicit 30-calendar-day sustained-success window, pass through `target_reached_pending_confirmation`, and may later append regression/reopen evidence without erasing completion history. Page reads never create progress evidence.
- **Reasoning:** An immutable evidence trail is required to answer why a past percentage/status existed and to distinguish historical achievement from current maintenance. Explicit duration/state prevents a transient balance from proving behavioral stability.
- **Alternatives:** Mutable current-progress fields, snapshots on every read, clamping raw values, erasing regressions/completions, recomputing old history against edited goals, and persisting scenario results as verified evidence were rejected.
- **Consequences:** Material goal changes create a new version-change evidence boundary. Deterministic 25/50/75/100 milestones are stored when first crossed, while the threshold model remains extensible. Verified progress and scenario/projected outcomes use separate contracts; hypothetical income, investment gains, or expense changes cannot alter verified progress. The standalone MongoDB design must not claim cross-document atomicity: idempotency and immutable event keys make retries safe, and a failed evaluation may leave no new evidence rather than a partially rewritten history.

## ADR-037 — Goal evaluation time and no-op idempotency are server-owned

- **Decision:** Derive every verified goal evaluation instant from the server clock and convert it through the authenticated owner's profile timezone; the public command cannot supply or backdate `evaluatedAt`. Hash the immutable evaluation inputs—not transient UI state—to deduplicate equivalent same-date/source results. Keep financial definition/progress documents immutable and store technical no-op idempotency aliases in the separate owner-scoped `goalCommandReceipts` collection, so an alias cannot later authorize different content.
- **Reasoning:** Client-controlled timestamps could make future source state appear historically available. Recalculating a retry against its own newly stored result can also change trend/lifecycle context and accidentally produce a second snapshot. Server time, stable input evidence, and separate receipts close both integrity gaps without mutating historical financial evidence.
- **Alternatives:** Trusting browser timestamps, hashing the previous-dependent rendered result, appending a snapshot for every explicit click, mutating immutable evidence with extra retry keys, or allowing a no-op idempotency key to be reused for changed content were rejected.
- **Consequences:** Automated sustained-success tests move a server dependency clock rather than sending timestamps through production commands. Equivalent evaluations return the existing evidence and create only a technical receipt when needed; changed sources, dates, metrics, targets, or policies create new evidence. Receipts use owner-first unique indexes, contain no financial payload, are excluded from public export, and do not weaken append-only goal history.

## ADR-038 — Purchase simulations are deterministic, freshness-aware, and hypothetical

- **Decision:** Classify purchase impact from confirmed Phase 3 snapshot cash only. `SAFE` requires the minimum confirmed balance throughout the explicit rolling 30-day evaluation window to remain at or above the applicable Safety Margin with no uncovered obligation/shortfall; `CAUTION` remains non-negative but falls below margin; `UNSAFE` becomes negative or proves another confirmed-cash shortfall. Equality with margin is safe, while zero is caution unless margin is zero. Search identical terms for the first `SAFE` date within 90 calendar days only. Risk and existing snapshot freshness remain separate outputs.
- **Decision:** Treat the entered amount as total purchase price. Generate one-time or monthly schedules in exact minor units, distribute remainders to earliest installments, and conserve total true financed cost. Explicit known interest/fees with user-reported provenance are included; unknown charges are never inferred. Unsaved simulations are ephemeral. Explicit saves append immutable owner-scoped evidence that references the owned source engine snapshot and applicable budget period when present and retains enough exact input, schedule, result, provenance, version, and freshness data to reproduce the evaluation.
- **Reasoning:** Purchase safety is a timeline property, not a comparison with current balance or an AI judgment. An explicit rolling window preserves the approved Phase 3 safety policy while a separate 90-day search answers when the same terms first become safe. Separating freshness prevents stale data from silently changing mathematics while preventing stale `SAFE` from being presented as current certainty. Exact schedule conservation and immutable explicit saves preserve financial explainability without turning a hypothetical into an obligation.
- **Alternatives:** UI/AI classification, treating `CAUTION` as safe, pro-rating with floating point, putting remainders in an arbitrary final installment, estimating unknown financing charges, extrapolating past an insufficient source horizon, persisting every calculation, or creating transactions/budget effects from a save were rejected.
- **Consequences:** Phase 7 requires an owned Phase 3 snapshot that covers every evaluated candidate window and fails honestly when coverage is insufficient. The UI displays full financed cost/schedule and the 30-day classification horizon separately. Stale results remain visibly stale. The `purchaseSimulations` collection is append-only and owner-indexed; saves cannot mutate accounts, transactions, budgets, engine snapshots, Safe to Spend, or goals. AI, provider financing terms, and purchase-commitment workflows remain later phases.

## ADR-039 — AI context is minimized, redacted, owner-scoped, and non-authoritative

- **Decision:** Assemble a purpose-specific structured context from the smallest relevant actor-owned deterministic outputs, then apply deterministic server-side minimization and forbidden-field validation before a provider-neutral server-only AI port is invoked. Omit credentials, authentication artifacts, secret-bearing headers, full card data, private keys, `.env` content, raw provider payloads, and unnecessary internal identifiers. Treat all user/import/provider text as untrusted data. Persist only owner-scoped, deletable user-visible conversation content, schema-validated structured results, safe metadata, and deterministic evidence references—never hidden prompts or raw internal context dumps. Logs and telemetry contain metadata only and never complete prompts/responses or raw financial payloads.
- **Reasoning:** Financial explanation needs selected financial facts, but provider convenience must not expand disclosure, cross user boundaries, or turn generated text into accounting truth. Deterministic pre-invocation controls are enforceable and testable; asking a model to redact itself is not a security boundary.
- **Alternatives:** Sending complete profiles/history, relying on prompt instructions for redaction, storing raw provider requests/responses indefinitely, logging prompts for debugging, accepting client ownership/context, and letting generated actions mutate financial records were rejected as privacy, isolation, injection, audit, and correctness failures.
- **Consequences:** Every request derives the actor server-side, authorizes and aliases evidence references, and separates trusted instructions from untrusted content. The adapter returns a closed schema with `FACT`, `INSIGHT`, and `RECOMMENDATION`; every significant numerical fact must cite supplied deterministic evidence, and unsupported/hallucinated numerical output fails closed. Conversation deletion cannot touch financial truth. Anthropic-specific transport types terminate at the adapter. Real-provider, two-user, redaction, hostile-input, failure-leakage, telemetry, and Hebrew/RTL acceptance are required for Phase 8.

## ADR-040 — Anthropic multi-workspace selection is explicit server-only configuration

- **Decision:** Keep `ANTHROPIC_WORKSPACE_ID` optional at the application boundary. When configured, the Anthropic adapter sends it only in the `anthropic-workspace-id` transport header. Missing selection for an identity-linked multi-workspace key and rejected workspace selection fail with safe configuration errors; the application never guesses a workspace. Keys scoped to one workspace remain valid without this setting.
- **Reasoning:** The real Phase 8 provider preflight proved that the configured identity-linked key reaches Anthropic but requires an explicit workspace. Workspace selection affects authorization and billing scope and therefore cannot be inferred from user financial data or silently defaulted by Financial OS.
- **Alternatives:** Logging the provider error, hard-coding a workspace identifier, treating the identifier as client input, or requiring it for every Anthropic key were rejected because they would leak provider detail, weaken server-side authority, or break correctly scoped keys.
- **Consequences:** Local and hosted environments using a multi-workspace key must set the intended workspace ID privately. The value is not committed, logged, returned to clients, persisted with conversations, or placed in model context. The configured private workspace passed the real Anthropic and authenticated server-path Phase 8 acceptance gates.

## Phase 8 verification addendum — 2026-09-01

- Real Anthropic structured-output acceptance and the authenticated `/api/ai/conversations` server path passed with the privately configured workspace; safe telemetry contained only approved request/model/duration/token/status/version metadata.
- Unit, full regression, and isolated real-Mongo suites passed, including deterministic redaction/minimization, prompt-injection boundaries, evidence-only numerical authority, two-owner isolation, bounded opt-in history, safe failure without partial persistence, and deletion without canonical financial mutation.
- The production Hebrew/RTL browser journey passed with LTR financial/date evidence isolation and no internal identifiers or error alert. Type-check, zero-warning lint, optimized production build, and high-severity dependency audit passed.

## ADR-041 — Phase 10 may execute while Phase 9 remains blocked

- **Decision:** Permit a one-time execution-order exception for Phase 10 over the existing provider-neutral manual transaction history. Phase 9 remains explicitly blocked, unimplemented, and unaccepted until a licensed provider, jurisdiction/legal boundary, consent policy, token-encryption/KMS design, and official Integration/Sandbox access are resolved and verified.
- **Reasoning:** Transaction intelligence depends on sufficient normalized transaction history, not on Open Banking transport. Phase 2 manual transactions are first-class production-domain records and already satisfy ownership, precision, source, and audit boundaries. Waiting for provider transport would not improve the correctness of a provider-neutral intelligence engine.
- **Alternatives:** Mocking a banking provider, fabricating bank provenance, partially accepting Phase 9, or redefining Phase 10 as a banking feature were rejected. Reordering the roadmap permanently was also rejected.
- **Consequences:** Phase 10 may be accepted independently, but documentation must keep Phase 9 visibly blocked. No later claim of complete bank-user, Phase 18, Phase 19, Phase 20, or production readiness may rely on this exception.

## ADR-042 — Transaction intelligence is immutable review evidence over confirmed facts

- **Decision:** Implement Phase 10 first as a pure deterministic, versioned rules engine over a bounded actor-owned transaction history. Preserve raw merchant, source category, exact amount/date, and provenance. Store normalized merchant labels, category suggestions, integer-basis-point confidence, explanation codes, bounded evidence references, input hash, and engine/rule/policy versions in immutable owner-scoped analysis runs. Store user review actions as append-only evidence. Never auto-apply a prediction. An explicit category confirmation appends the existing Phase 5 immutable category-correction evidence; other signals are only confirmed/dismissed/reopened review states and never mutate financial truth.
- **Reasoning:** Deterministic rules keep the initial classifier reproducible, offline-capable, testable, and independent of an external AI/provider. Separate immutable evidence prevents a model/rule upgrade from relabelling historical facts and preserves user authority. Reusing category-correction evidence avoids a second confirmed-category truth.
- **Alternatives:** Rewriting transaction category/merchant fields, auto-categorizing above a confidence threshold, treating detection as fact, storing one mutable prediction state, sending full history to Anthropic, or creating recurring transactions from a signal were rejected as audit, privacy, reversibility, and authority violations.
- **Consequences:** Analysis is an explicit authenticated command and page reads never write. Runs and decisions are retry-safe and owner-isolated. Exact money comparisons remain same-currency integer operations. The initial review threshold and rule set are policy-versioned; low-confidence candidates are not presented as facts. Quality is claimed only for labelled deterministic fixtures, not as population accuracy. Future statistical or AI implementations must satisfy the same provider-neutral contract, minimization, evidence, ownership, and no-mutation rules.

## Phase 10 verification addendum — 2026-09-01

- The deterministic rules engine, strict owner-free client contracts, and Hebrew/RTL review UI passed 29 unit files / 134 tests. The bounded labelled known-merchant fixture measured 100% precision and recall; this is evidence for that fixture only, not a population-accuracy claim.
- The dedicated real-Mongo suite passed 1 file / 6 tests, including BSON int64/version provenance, two-user isolation, immutable source transaction fields, correction linkage, idempotency/conflict behavior, append-only dismiss/reopen evidence, owner-first indexes, and analyzer failure without partial persistence or canonical mutation.
- The complete regression with real Anthropic acceptance enabled passed 41 files / 172 tests. Strict TypeScript, zero-warning lint, optimized production build, high-severity dependency audit with zero vulnerabilities, and repository integrity/secret-boundary checks passed.
- An authenticated production-browser journey on port 3001 passed in Hebrew/RTL. Explicit analysis produced and persisted a known-merchant category suggestion, explicit confirmation appended review and category-correction evidence, reload preserved it, and read-only Mongo verification confirmed active-session ownership, BSON int64 money, unchanged source category/version, and no Phase 9 collection.
- Phase 10 is accepted independently under ADR-041. Phase 9 remains blocked, unimplemented, and unaccepted. Phase 11 has not started because household private/shared semantics remain an unresolved product-policy gate rather than a routine implementation detail.

## ADR-043 — Household sharing preserves individual ownership and defaults to private

- **Decision:** Keep every financial source owned by its original authenticated `userId`. Household membership adds no implicit visibility. Represent account and verified-goal sharing as an explicit, versioned per-household authorization grant owned by the resource owner. Require an active household, active viewer membership, active share, current resource-owner membership epoch, and owner-scoped resource lookup for every shared read. Shared records remain read-only to other members. The initial roles are only `owner` and `member`; the Master Plan's possible viewer role is deferred rather than silently introduced.
- **Reasoning:** Ownership transfer, copied records, or membership-wide visibility would expose pre-existing/private data, create duplicate financial truth, and make removal ambiguous. A separate grant preserves source ownership and lets current authorization revoke access without rewriting facts.
- **Alternatives:** Household-owned copies, automatic sharing on join, household IDs on existing records as ownership, client visibility claims, shared cached full-user snapshots, and another member mutating a shared source were rejected.
- **Consequences:** Private is the absence of an active grant. Phase 11 shares only existing accounts and latest verified goal definitions, and derives exact currency-grouped account totals plus verified-goal views from currently authorized sources. It does not expose full owner snapshots, budgets, Safe to Spend, forecasts, provider records, or AI history. True household-owned financial resources require a later explicit lifecycle policy.

## ADR-044 — Household membership, invitations, and revocation fail closed

- **Decision:** The authenticated creator is the lifetime household owner; Phase 11 has no ownership transfer and owners dissolve rather than leave. Non-owner memberships have versioned activation epochs. Invitations use 256-bit server randomness, persist only a SHA-256 token hash and intended-email hash, expire after a versioned seven-day UTC duration, and are single-use. Entity-local append-only audit trails atomically record creation, invite create/accept/revoke/expiry, member remove/leave, share/unshare, settings change, and dissolution. Household status and current membership are checked on every direct-ID path. Dissolution first makes the household inactive, immediately denying all access while retaining minimal immutable evidence and individually owned records.
- **Reasoning:** Hash-only tokens limit secret exposure; email binding prevents forwarded tokens from authorizing the wrong account; unique active invite/member indexes and atomic conditional updates prevent replay. Membership epochs make stale grants unusable after a member leaves and rejoins. Entity-local audit is the strongest atomic evidence boundary available on the verified standalone MongoDB deployment.
- **Alternatives:** Stored plaintext tokens, bearer-only acceptance, non-expiring or reusable links, client role/household claims, owner departure without successor policy, deleting shared resources on removal, or relying on best-effort share deletion for authorization were rejected.
- **Consequences:** Multi-document acceptance/removal workflows are convergent and retry-safe, but authorization never depends on cleanup completion. Former members and dissolved households have no interactive shared-data access. Copilot remains actor-owned only in Phase 11; tests must prove that even explicitly shared data from another owner cannot enter its provider context until a dedicated authorized household-context feature is designed.

## Phase 11 verification addendum — 2026-09-01

- The complete owner/member matrix and strict owner-free commands passed unit verification. The dedicated real-Mongo suite passed six lifecycle tests covering private defaults, secure invitation states, direct-ID/cross-household denial, exact shared projections, optimistic concurrency, immutable audit, removal/leave/dissolution, source preservation, and membership-epoch rejoin behavior.
- Invitation acceptance records the intended authenticated identity on the conditional single-use invitation before activating membership. If activation is interrupted, a retry by that same intended identity can converge; once membership is active, sequential token replay is rejected. No plaintext token or raw intended email is stored.
- Household sharing does not enter Phase 8 provider context. The actor-only context gate excluded both internal actors, the household identifier, and another owner's unique financial amount even while a real MongoDB share existed.
- The complete regression with the real Anthropic provider gate passed 44 files / 184 tests using one worker after a parallel run saturated shared MongoDB setup and timed out seven hooks without producing product-test failures. Authenticated production-browser acceptance created a real private household, displayed existing accounts/goals only as explicit share candidates, kept shared summaries empty, and verified Hebrew/RTL/LTR semantics without browser or server errors.
- Type-check, zero-warning lint, optimized production build, tracked-secret/configuration review, `git diff --check`, and the registry-backed high-severity audit passed with zero vulnerabilities. Phase 11 is accepted; Phase 9 remains blocked and unaccepted, and Phase 12 is not started pending its forecast-range/confidence product gate.

## ADR-045 — Operational forecasts preserve truth classes and use categorical evidence confidence

- **Decision:** Limit authoritative operational forecasts to explicit 7/30/60/90 user-timezone calendar-day horizons (30 default). Project one confirmed balance from Phase 3 confirmed events and one operational balance that additionally includes explicitly estimated events. Treat uncertain Phase 3 income and Phase 10 recurrence inference as estimated, never confirmed. Preserve exact same-currency money, source provenance, calculation/policy versions, current Safe to Spend as a separate Phase 3 fact, and suppress a recurring estimate when a same-date/direction/currency/amount confirmed event already exists.
- **Confidence policy:** `forecast-confidence-v1` emits only `HIGH`, `MEDIUM`, or `LOW`. Recurrence is `LOW` below three observations, after material staleness (`max(45, 2 * periodDays + 14)` days), above seven-day cadence deviation, or above ten-percent amount deviation. It is `HIGH` with at least five observations, recency within `periodDays + 7`, timing deviation at most three days, amount deviation at most five percent, and either a confirmed review or at least six observations. Other eligible evidence is `MEDIUM`. Dismissed evidence is excluded; reopened is unreviewed. Stale source/intelligence, no usable prediction history, or any included `LOW` estimate makes overall confidence `LOW`; all included estimates must be `HIGH` for overall `HIGH`; otherwise it is `MEDIUM`.
- **Reasoning:** Categorical, reproducible evidence rules communicate data sufficiency without inventing probabilities. Separate balances and event classes let users inspect confirmed truth versus inference, while exact duplicate suppression and Phase 10 review precedence avoid misleading double-counting.
- **Alternatives:** Numeric likelihoods, AI-assigned confidence, promoting predicted recurrence to confirmed obligations, extending operational forecasts beyond 90 days, implicit FX, and changing Phase 3 Safe to Spend from forecast estimates were rejected as false precision or authority violations.
- **Consequences:** Low confidence does not invalidate confirmed events; it qualifies prediction coverage. Every boundary is versioned and fixture-tested. Phase 9 is not required because manual/provider-neutral history is first-class.

## ADR-046 — Phase 12 snapshots and scenarios are immutable, actor-only derived evidence

- **Decision:** Persist operational forecast snapshots and explicit scenario comparisons only after authenticated commands. Each forecast references one owned Phase 3 snapshot and optional owned Phase 10 run; each scenario references one owned forecast and explicit exact adjustments. Reads never write. Household membership or shares do not authorize private forecasts because Phase 11 grants expose only explicitly shared account/goal views, not full timelines or intelligence.
- **Reasoning:** Immutable references make results reproducible without copying raw transaction history. Actor-only derivation prevents private household-member data from leaking into forecasts, AI context, logs, or telemetry. Scenario evidence can be audited without becoming financial truth.
- **Alternatives:** Mutable forecast caches, calculation on page load, household-wide aggregation, storing raw history inside forecasts, or applying scenario adjustments to canonical records were rejected.
- **Consequences:** Scenario income/expenses/loan/card/savings changes remain hypothetical and cannot mutate accounts, transactions, budgets, Safe to Spend, goals, operational forecasts, or provider state. AI may later explain minimized cited outputs only.

## Phase 12 verification addendum — 2026-09-01

- The dedicated unit/UI/real-Mongo Phase 12 run passed 3 files / 19 tests, and the complete final-state regression with the real Anthropic gate enabled passed 47 files / 203 tests. Exact BSON int64 money, source ownership, idempotency, concurrency, two-user/household denial, duplicate prevention, confidence thresholds, corrected intelligence precedence, crossings, scenario non-mutation, and deterministic reproduction passed.
- Durable Phase 10 decisions are resolved by stable signal ID across subsequent identical intelligence runs. The latest append-only decision is applied to the new projection; current-run evidence still takes precedence. This avoids silently discarding confirmed/dismissed user review while leaving source transactions and intelligence runs immutable.
- Scenario evidence references its immutable operational forecast instead of duplicating the forecast-confidence version. Production acceptance caught and removed that redundant required field so an already valid saved scenario remained readable without migration or historical rewrite; the referenced forecast still provides the exact confidence-policy provenance.
- A retained real Auth.js session drove the protected Hebrew/RTL production journey on port 3001. A 90-day confirmed timeline, honest `LOW` predictive confidence, one separate exact saved scenario, no visible internal IDs, no overflow, and clean fresh browser logs passed. Read-only Mongo evidence confirmed one owner chain, BSON `Long`, zero canonical financial writes, and no Phase 9 collection.
- Type-check, zero-warning lint, optimized build, synchronized Master Plan hashes, `git diff --check`, ignored/untracked `.env.local`, port isolation, and the registry-backed high-severity audit passed with zero vulnerabilities. Phase 12 is accepted; Phase 9 remains blocked and unaccepted.

## ADR-047 — Debt calculations require explicit terms and completeness provenance

- **Decision:** Treat the existing owned loan/debt record as canonical identity/current balance only, not as a complete amortization contract. A Phase 13 calculation must receive explicit provenance-bearing interest/accrual, day-count/compounding, allocation order, minimum-payment, known-fee, variable-rate, and prepayment terms whenever material. Emit one of `verified`, `assumption_based`, or `insufficient_information`; never upgrade an assumption or incomplete APR-only record into contractual truth.
- **Reasoning:** Lenders differ in accrual, allocation, fee, rate-change, and settlement behavior. A precise-looking schedule from guessed conventions is financially less honest than an explicit incomplete result. Keeping calculation terms beside immutable scenario evidence avoids corrupting the existing manually entered debt fact.
- **Alternatives:** Universal monthly APR amortization, common credit-card minimum formulas, hidden Actual/365, automatically free prepayment, estimated future benchmark rates, and silently ignoring fees were rejected.
- **Consequences:** Supported conventions are closed, versioned engine inputs. Unknown material terms remain user-visible. Known effective-dated changes may be projected; unknown future changes remain scenarios. Exact money, half-even rounding where fractions arise, explicit calendars, same-currency enforcement, and evidence-version tests are mandatory.

## ADR-048 — Debt strategies are explicit non-mutating comparisons with actor-only evidence

- **Decision:** Compare contractual/minimum baseline, Avalanche, Snowball, and explicit custom priority only over eligible actor-owned debts and one explicit same-currency extra-payment budget. Preserve required minimum payments first. Avalanche requires comparable verified borrowing-cost evidence; Snowball ranks exact eligible balances; custom priority is user intent, not canonical debt truth. Evaluations are ephemeral and explicit saves append immutable `debtStrategyScenarios` evidence.
- **Reasoning:** Strategy usefulness does not authorize spending Safety Margin, rewriting debts, or claiming a behavior preference is mathematically optimal. Immutable references and exact inputs make a past comparison reproducible without duplicating canonical debt history.
- **Alternatives:** Automatic extra-payment amounts, cross-currency ranking, AI-selected truth, mutable strategy records, applying simulated payments to debts, and household-wide private debt aggregation were rejected.
- **Consequences:** Saved evidence includes debt revisions, terms/provenance, assumptions, extra budget, strategy, results, versions, and creation time. It cannot create payments or mutate accounts, balances, budgets, Safe to Spend, goals, forecasts, or providers. Phase 11 exposes no shared-debt grant, so strategy data is actor-only. AI may explain only minimized cited deterministic outputs.

## Phase 13 verification addendum — 2026-09-02

- The implementation uses one globally chronological deterministic event stream, exact bigint/BSON int64 money, half-even fractional rounding, and per-component payment evidence. Dedicated tests reconcile every payment and total, cover all approved accrual/rate/minimum/allocation/fee/prepayment/completeness boundaries, and reject implicit FX.
- The existing `loans` document remains canonical identity/current balance. Evaluation derives balance, label, owner, and version server-side; only an explicit save appends `debtStrategyScenarios`, after revalidating every current owned revision. Stale and foreign revisions fail closed, idempotent retries reproduce one immutable record, and actor export includes only owned serialized evidence.
- Phase 11 household membership was established in real MongoDB during isolation testing and still did not authorize either member's private loan or scenario to the other. No debt share kind exists. Production acceptance tied the saved evidence to an active Auth.js database session and the exact owned loan revision.
- The protected Hebrew/RTL production journey, complete 50-file / 226-test regression, real MongoDB, real Anthropic regression, type-check, zero-warning lint, optimized build, and zero-vulnerability dependency audit passed. Phase 13 is accepted; Phase 9 remains blocked and unaccepted.

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
- Phase 2 is accepted. At its acceptance boundary, Phase 3 remained blocked on the documented product decisions for confidence semantics and the exact Safe to Spend horizon/policy; the owner subsequently resolved that gate in ADR-029 before engine implementation began.

## Phase 7 verification addendum — 2026-09-01

- The final real-Mongo suite passed 9 integration files and 25 tests; the unit/UI suite passed 23 files and 116 tests; the complete environment-loaded suite passed all 32 files and 141 tests without skips.
- Boundary tests prove margin equality is `SAFE`, zero is `CAUTION` unless the margin is zero, negative/uncovered obligations are `UNSAFE`, uncertain income cannot help, same-day conservative ordering applies, the first later date must itself be `SAFE`, and no date is invented after 90 days.
- Exact schedules conserve purchase price plus explicit interest/fees and allocate remainders to earliest installments (`103` minor units across three browser-tested installments persisted as `35 + 34 + 34`). BSON `Long`, owner-first indexes, idempotent saves/conflicts, actor-only source/budget references, bounded schema-4 export, and two-user denial passed against real MongoDB.
- Real-Mongo non-mutation evidence compared source records before/after: ephemeral evaluation wrote no simulation, and explicit save changed only the append-only simulation collection—never transactions, accounts, budget periods, engine/source snapshots, Safe to Spend, or goals.
- A retained real Google/Auth.js MongoDB session drove the protected production browser journey on port 3001. It created an owned 210-day baseline, evaluated/saved/reloaded a synthetic exact `SAFE` scenario, and separately produced an unsaved `UNSAFE` result with no fabricated safe date. Stored ownership matched the active session and source snapshot without exposing identifiers or tokens.
- The production DOM remained `lang="he"`, `dir="rtl"`, used explicit LTR isolation, had no error/warning logs, and had no horizontal overflow at a reported 375-pixel narrow viewport. Strict type-check, zero-warning lint, production build, runtime no-store/auth boundaries, and secret/Git hygiene passed.
- The current offline npm audit found zero vulnerabilities. `package.json` and `package-lock.json` are unchanged from the Phase 6 registry-backed zero-vulnerability audit; a new registry submission was denied by the execution safety boundary and is not misreported as having run.
- Phase 7 is accepted. Claude, provider integrations, purchase commitment, and advanced scenarios remain unimplemented.

## Open product/engineering questions

- The exact user-facing set of supported currencies and per-currency minor-unit precision needs product definition before onboarding accepts money.
- Audit retention versus full account deletion needs legal/privacy input before production.
- The licensed Open Banking provider, jurisdiction, token-encryption/KMS design, and consent requirements remain undecided.
- Household private/shared resource semantics are resolved by ADR-043/044 and verified in Phase 11.
- Phase 3 core income-confidence, horizon, margin-basis, and same-day-order policies are resolved by ADR-029. Phase 12 forecast-range/confidence policy is resolved by ADR-045/046.
