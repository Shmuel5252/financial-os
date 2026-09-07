# Open Banking Operations Runbook

This runbook covers the Phase 9 Financy / Open-Finance.ai adapter. It does not authorize payment initiation, implicit currency conversion, or direct collection of bank credentials.

## Latest accepted checkpoint — 2026-09-07

Phase 9 passes at its real staged boundary and ADR-066 development-only baseline exception. The one separately authorized 20-credit refresh has been consumed: real authenticated `completed/accepted` at 04:25:59.621 UTC, provider data date advanced to 2026-09-07, and two ordinary syncs passed with zero repeat changes and identical financial/observation digests. No additional refresh, disconnect or billing action is authorized. Current provider observations are 8 products/1,140 transactions; canonical provider totals are 5 accounts/462 transactions. Archive hashes remain valid and unrelated/manual finance remains unchanged. The earlier checkpoint and handoff paragraphs below are historical; `PHASE_9_ACCEPTANCE_REPORT.md` is the final evidence record.

Only local port-3001 infrastructure is verified. Phase 18 may begin after the clean accepted Git checkpoint, but needs the documented production resources/access and operational/privacy policy gates. Do not treat this staged acceptance as hosted multi-user or launch readiness.

## Current development checkpoint (ADR-066, 2026-09-06)

The owner explicitly replaced obsolete pre-reconnect Financy **test** ingestion with the current ACTIVE connection. The exact 1,653-document legacy set is archived and retired; 101 protected originals are unchanged. The new baseline has 8 distinct products and 1,139 transaction observations; repeat real sync and authenticated UI sync are idempotent. No production reconciliation policy was weakened. Earlier manual handoffs below describe the retained future-production workflow, not a current requirement to match retired test accounts.

Phase 9 is still unaccepted because the original paid refresh produced provider `accepted` but an application `failed/schema` receipt. The fixed real success path requires a separately approved additional 20-credit refresh. Do not repeat disconnect, alter historical receipts, infer successful data refresh from reconnect, or begin Phase 18. See `PHASE_9_ACCEPTANCE_REPORT.md`.

### Development archive and recovery boundary

`bankDevelopmentMigrations` records exact target/protected digests, old/current aliased connections, explicit dated policy and state. `bankDevelopmentArchive` retains verified per-document BSON with original collection/ID. Both have owner-first unique indexes and no public endpoint or engine/AI consumer. Exact completed retired aliases are excluded from ordinary sync, preventing old observations from reappearing. Other users' aliases and incomplete/unrecognized manifests cannot suppress ingestion.

The opt-in `phase-nine-development-cutover.operations.test.ts` is **not routine regression**. Read-only preflight uses `RUN_PHASE9_DEVELOPMENT_BASELINE_PREFLIGHT=1`; destructive execution additionally requires the exact dated `RUN_APPROVED_PHASE9_DEVELOPMENT_BASELINE` approval value, local AUTH_URL/Mongo, stopped port-3001 writers, explicit binding and exact pre-reviewed counts. Its provider transport allowlist permits token acquisition and documented data reads only. Do not rerun the mutating mode now that the cutover is complete.

Recovery is possible from the stored BSON, but restoring old records beside the current live baseline would duplicate truth. A rollback therefore needs a new explicitly scoped owner-approved recovery plan: stop writers, verify archive hashes and ownership, inventory every new-baseline dependency, and restore only collision-free exact original IDs after safely retiring the replacement scope. Do not automatically restore on an error or overwrite a current record. A process interrupted during retirement can resume the recorded targets after operator verification; never steal an existing operator lock without proving its process is stopped. Keep the archive until the owner separately authorizes its disposal.

## Configuration and ownership

- Configure `OPEN_FINANCE_USER_ID`, `OPEN_FINANCE_CLIENT_ID`, and `OPEN_FINANCE_CLIENT_SECRET` only in the server environment. Never expose them to client bundles, logs, support exports, or source control.
- Financy's hosted application owns bank selection, consent, and credential entry. Financial OS never renders or stores bank usernames or passwords.
- The configured Financy subject must be explicitly claimed by exactly one authenticated Auth.js actor. Provider identifiers never grant application authorization.
- One configured subject per deployment is the verified staged boundary. General multi-user production onboarding requires a separately verified provider-side B2B/programmatic connection workflow.

## Ordinary synchronization

1. Confirm the user has completed Financy's hosted consent flow.
2. Open the authenticated Hebrew/RTL Open Banking center and claim the configured subject once.
3. Run ordinary synchronization. It reads existing provider state and does not invoke the paid refresh endpoint.
4. Confirm the durable run is `completed`. A `partial` or `failed` run is not a complete snapshot.
5. Repeat the command with a new idempotency key when reconciliation needs verification. Unchanged observations must not create new revisions or canonical records.

Synchronization is cursor-bounded to 20 pages of 500 records per resource. Tokens remain in process memory. GET reads may renew once after a `401` and use bounded transient retries; permanent authentication, consent, schema, and credit failures fail closed. POST refresh and DELETE never automatically retry, including on uncertain network outcomes or `401` (ADR-067).

## Truth and reconciliation

- Immutable minimized revisions preserve connection, account/balance, and transaction observations through HMAC aliases; raw provider payloads and raw identifiers are not stored.
- Only literal `BOOKED`, non-duplicate, primary-currency transactions with a usable amount, date, and canonical account become confirmed canonical transactions.
- `PENDING`, unknown-status, missing-amount, duplicate, foreign-currency, and unsupported-account observations remain evidence and never become confirmed cash truth by inference.
- Manual records remain first-class and are never overwritten. Provider-backed canonical records are read-only through manual mutation paths.
- Freshness is based on the provider's last fetched data date in the profile's IANA calendar. Phase 9 policy marks up to two calendar days old as `FRESH`; older, future-dated, or absent evidence is `STALE`/`UNKNOWN`.

## Paid refresh

The documented Financy refresh is asynchronous and currently costs 20 credits. Invoke it only after the user selects the cost disclosure and explicitly confirms the action. Treat `accepted` and `already_running` as provider lifecycle results, not proof that new data has arrived. The live `accepted` body may contain only `status`; the adapter supplies the documented 20-credit policy value without inventing connection counts. Poll through ordinary synchronization; do not loop paid refresh calls.

Exactly one authorization permits exactly one provider mutation attempt. The adapter does not automatically retry the paid POST after transport/401/transient errors. Failed command keys remain failed and cannot be replayed. On an ambiguous result inspect the durable receipt and ordinary provider reads, preserve the uncertainty, and obtain fresh explicit authorization before any additional paid command. The successful acceptance run did not inspect an actual billing debit and must not be described as doing so.

## Disconnect and revocation

Disconnect deletes the provider connection and is destructive. Invoke it only after a separate exact user confirmation. A provider lock can temporarily reject deletion; report the safe error category and do not automatically retry. Reassess the actual provider state and applicable user authorization before a later attempt. After a successful provider deletion, retain historical minimized/auditable observations and mark the local connection disconnected; do not erase or rewrite canonical financial history. Reconnection must occur through a fresh hosted provider-consent workflow. No new disconnect is authorized at the current checkpoint.

The opt-in `phase-nine-reconnection.integration.test.ts` with private environment loading and `RUN_REAL_OPEN_FINANCE_RECONNECTION_TESTS=1` reads existing canonical aliases and current provider state without writes, database drops, refresh or deletion. It originally failed on changed legacy IDs. After the approved development cutover it passes for the new baseline (5 accounts/455 transactions), not as proof of old-to-new continuity. For future production reconnects, ADR-064 still requires a real verified reconciliation map preserving canonical IDs and external lineage; a protective rejection or fixture alone is not acceptance.

If the real API returns only `TERMINATED_BY_USER` and empty data, check the hosted connection in the same Financy account as the local private API configuration. If the hosted UI is readable but the API is not, resolve the discrepancy with the provider. Do not guess a different user ID, repeat paid refresh/deletion, or erase local financial history. The 2026-09-06 resumption stopped at exactly this gate.

The later 2026-09-06 check resolves that access failure but exposes changed IDs relative to every retained canonical account/transaction alias. The pre-write server gate rejects a readable connection when another ended connection for the same actor/institution retains canonical records. `RECONCILIATION_REQUIRED` is an intentional HTTP 409 safety stop, not a transient error to bypass. The old connection's documented data filters, including duplicates, currently return no bridging data. ADR-064 now supplies the approved reconciliation policy, but actual identity evidence or explicit authenticated auditable owner mapping remains required; never delete legacy history or deduplicate by equal amounts/dates alone.

### Approved-policy evidence preflight

Run `phase-nine-identity-evidence.integration.test.ts` only with `RUN_REAL_OPEN_FINANCE_IDENTITY_EVIDENCE_TESTS=1`, private environment loading, and `--silent=false --reporter=verbose` for count-only output. This is a read-only evidence inventory, not a passing acceptance substitute. It does not run synchronization, mutate finance, refresh, disconnect, or contact billing. The diagnostic permits documented account list/detail reads and verifies unchanged owner financial/provider checkpoints.

The verified 2026-09-06 result: current `accountNumber` on 8/8 records; parsed bank/branch/number on 2/8; no such retained historical fields on any of eight old account observation identities or five canonical accounts. Five name/type/currency/institution candidates are unique, but are not identity proof. No raw identifiers are emitted. Historical missing data cannot be backfilled by assuming today's number belonged to an old record. Stop for authoritative bridging evidence or explicit owner review through the approved immutable/manual workflow. That workflow is not yet implemented; the guard must stay active. Do not ask the user to paste credentials, tokens, full account numbers, or raw financial history into chat. Only after safe account mapping may transaction fingerprints, duplicate prevention, historical preservation, repeated sync, and the remaining full acceptance suite be exercised.

## Manual account confirmation handoff (ADR-065)

1. Open `http://localhost:3001/open-banking/reconciliation` in the authenticated Financial OS owner's session. Use the comparison-loading button if rows are not loaded. This reads current Financy data; it is not paid refresh.
2. For each legacy account, compare the institution, name, type, currency, masked number and available bank/branch fields against your own knowledge. Missing historical number evidence is explicitly labelled. Candidate compatibility is not a recommendation or automatic match.
3. Only when certain, select the new account, explicitly tick the same-real-world-account attestation, and press the confirmation button. The agent must not do this for the real user's records.
4. If wrong or uncertain, use not-the-same/cannot-determine. This records that decision without forcing a match or clearing the import gate. Previous decisions remain immutable; a new decision appends evidence.
5. A successful confirmation attaches the new HMAC identity to the unchanged canonical ID through `bankAccountReconciliations`. It does not import transactions, alter balances, erase old aliases, or activate synchronization. Database uniqueness/version checks reject conflicting/stale/double claims; refresh the review after a conflict and inspect current state.
6. Tell the agent when your confirmations are complete. Then inspect ledger evidence, establish safe deterministic transaction continuity under ADR-064, and verify duplicates/history/repeated sync plus every original Phase 9 regression/provider/security/browser gate. Never simply disable the existing continuity guard after account confirmation.

The UI-ready checkpoint passed real read-only Financy/Mongo and authenticated production Hebrew/RTL checks. Actual owner-confirmed POST acceptance and transaction reconciliation are still pending. Do not commit/push/accept Phase 9 at this handoff or begin Phase 18.

## Monitoring and incident response

Safe telemetry may record opaque request/run IDs, provider name, operation, duration, page/record counts, status, retry count, error category, and policy/normalization version. Never record credentials, bearer tokens, authorization headers, provider IDs, raw payloads, account names, transaction text, or financial amounts.

Alert operationally on repeated authentication/consent failures, schema drift, pagination-limit exhaustion, sustained provider unavailability, expired consent, stale data, long-running leases, or partial runs. For schema drift or uncertain status/amount semantics, stop canonical projection, preserve the categorized failure, inspect official provider documentation, add contract fixtures, and deploy a versioned normalizer before retrying.

## Recovery and verification

- A failed/partial run with the same idempotency key may restart only after its lease expires or the prior run has ended; the audit revision must advance monotonically.
- Re-run synchronization after provider recovery and verify completion plus idempotent reconciliation.
- Verify owner-first indexes, exact BSON `int64` money, unchanged manual records, no stored credentials/raw IDs, and two-user denial in an isolated real MongoDB database.
- Browser acceptance must use an authenticated database session and verify Hebrew/RTL, LTR isolation, visible consent/freshness/status, safe confirmation gates, no overflow, and no console errors.
- No financial-data webhook is configured because the current provider documentation does not define a sufficient signature/authentication/replay contract. Do not accept unsolicited webhook data.
