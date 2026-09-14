# Phase 18 deletion / recovery implementation — 2026-09-14

Base: `6b1bb3d4c5bb402b52eb0e78d5f5424e34bde89b`. ADR-074 records owner approval before implementation. Earlier inventory statements that policy was unapproved remain historical. Phase 18 is NOT accepted. No Phase 19 or new credential observation.

## Authoritative classification and ordering

Reuse `PHASE_18_DATA_INVENTORY.md`, `PHASE_18_BACKUP_BOUNDARY.md` and `recoveryCollections` (52 application collections). A deletion ledger is separate operational suppression state, not a 53rd financial collection to restore from an old backup. Unknown collections fail closed.

Deletion dependency contract: authenticate the subject server-side; persist independently durable suppression; fence new writes/imports/jobs; revoke sessions and invitations; dissolve owned sharing/detach membership; redact multi-subject derived evidence without deleting other owners' independent truth; erase owned derived/audit/canonical/provider/auth linkage; remove identity last; verify every collection/copy and retain only minimal suppression evidence. Partial failure keeps suppression active and retries scoped to the original subject. Local erasure never asserts remote provider revocation. No production endpoint may be enabled until fencing, durable ledger, full schema coverage and external revocation handling are verified.

Restore contract: validate encrypted envelope, manifest/schema/index compatibility and consistent recovery point; verify CURRENT independent ledger completeness/freshness; filter erased subjects and affected shared data in quarantine; restore canonical IDs/exact BSON; recreate indexes; rebuild authorized survivors; recheck ledger under a final release fence; verify no credentials/jobs/provider/email replay and no orphan/cross-owner references. Never open restored data merely because a checksum passes.

## Work sequence

1. Minimal strict ledger, retention calculation and anti-resurrection decision primitives, synthetic negative tests.
2. Filtered/encrypted artifact and schema coverage; isolated-target executor and safe deletion orchestration only after prerequisite contracts are proven.
3. Real local synthetic multi-user recovery rehearsal and regression. No live/staging data or provider action.
4. External storage/consistency/key/retention setup remains an owner gate; no operational RPO/RTO/history claim from local tests.

## Unit 1 — locally verified primitives (not a full recovery workflow)

`deletion-ledger.ts` strictly projects signed, versioned receipts containing only pseudonymous subject, environment, operation, policy, revision and timestamps. No raw identity/finance/token. A server-derived Actor is a prerequisite; there is deliberately no HTTP endpoint or client-provided target ID. Foreign-actor completion, invalid signatures/environments, duplicate/conflicting receipts, stale/rollback ledger revisions and unsafe clocks fail with fixed errors. Accepted but incomplete requests already suppress restoration. Shared contribution produces a redaction-required decision, NOT an automatically rewritten valid report. Receipt completion means local only, never remote provider revocation.

The freshness/revision expectations MUST come from trusted independent storage, not request parameters or the old backup. This unit does not prove completeness of a ledger supplied by a caller. Retention returns review-required for missing/old inventory or incomplete deletion; otherwise computes max(completion, last restorable expiry, replay end) + configured margin. No TTL, expiry execution or unlimited-retention default. Dedicated versioned keys are injected; only ephemeral synthetic test keys exist. No AUTH_SECRET coupling or deployed key provisioned.

`recovery-envelope.ts` provides authenticated AES-256-GCM and BSON SHA-256 with schema/key/index-manifest binding, randomized nonce, bounded size and fixed errors. It is explicitly synthetic-only and NOT a complete 52-collection exporter: already-filtered content is required, excluded collections are refused, recursive credential fields/known secret signatures and opaque binary/code are rejected before encryption and after decryption. Arbitrary free text cannot be certified secret-free by a denylist. No real financial artifact was produced or saved. Auth linkage uses the existing explicit projection; nested development archives require a separate reviewed adapter.

`isolated-recovery-target.ts` refuses external/SRV/credential/query/application-port endpoints and caller DB names. It creates a fresh random loopback quarantine namespace; no application environment fallback or live target. Cleanup only drops its own newly created namespace, not existing databases. It does not prove all 52 schemas/indexes or release readiness.

Real local primitive rehearsal: three random isolated namespaces (source/current ledger/restore), two synthetic owners, encrypted BSON int64 roundtrip, durable suppression before partial test-only deletion, idempotent retry, no erased-owner restoration, byte-identical surviving finance, token-free linkage, zero restored sessions and explicit shared-redaction requirement. All three synthetic namespaces cleaned up. This is NOT the requested complete application deletion / shared-report / 52-collection restore acceptance; those remain next implementation work.

## Verification — unit 1

New focused coverage: 18 tests across ledger/envelope/target unit tests plus real Mongo primitive integration. Full non-external regression: 88 files / 458 tests passed; one opt-in reconnection skipped and the same six external/destructive files excluded. Only explicit loopback MONGODB_TEST_* were used, without loading private .env.local into the test process; provider flags disabled.

Initial regression exposed four older test dependency leaks: three export fixtures omitted their local debt repository and fell back to runtime configuration; foreign-conversation denial constructed a real provider unnecessarily. Tests now inject their own existing isolated repository and a never-called provider spy; assertions are preserved/strengthened, runtime behavior unchanged. Initial missing-configuration failures are not hidden. New fixture TypeScript errors were corrected before final verification.

Final type-check, zero-warning lint, production build, source index check (90/88/2), diff check and security scan (370 files, zero findings) passed. Registry audit: zero vulnerabilities after read-only network retry. Build uses normal existing local configuration without printing values or changing it. No browser/live provider verification claimed. No live/staging deletion, backup, restore, key/infrastructure change or Phase 19.

Next: filtered package schema/manifest and quarantine restore integration, preserving fail-closed unknown/sensitive data handling. Full application erasure additionally needs independent durable ledger storage, trusted completeness/revision/fencing, all-collection shared/redaction adapters and provider-revocation handling. Do not enable a deletion route from these primitives alone. External key/storage/capture/history and actual RPO/RTO remain separately gated.
