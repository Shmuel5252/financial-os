# Phase 18 — A+B proposal: consistent backups and an independent deletion ledger

2026-09-29. **Proposal only.** No infrastructure, purchase, cluster, bucket, credential, Vercel or Atlas change was made or is authorized by this document. Vendor capabilities marked *(verify)* must be confirmed against current vendor documentation and pricing before a decision. Requirements come from the approved targets (RPO ≤24h, RTO ≤4h, ≥30-day history, isolated restore) and ADR-074/076.

## 0. What already exists (repository)

Strict reviewed adapters for all 46 restorable collections (development archive excluded by ADR-076); signed, encrypted, per-collection BSON packages (`backup-package.ts`, `recovery-envelope.ts`); quarantine transforms (bank control fence, notification replay suppression, household redaction); a signed minimal deletion ledger with bounded retention and provider-subject markers (`deletion-ledger.ts`) and a Mongo-backed receipt store (`deletion-receipt-store.ts`); isolated restore targets. Missing: a capture job, durable storage, the independent ledger store and head/watermark, a release fence, and a global write fence.

## 1. Minimal production architecture

```
 App (Vercel) ──writes──> Main Atlas cluster (replica set)
      │                         │ snapshot session (read-only backup principal)
      │ ledger-first erasure    ▼
      │                   Capture job (scheduled, outside request path)
      ▼                         │ project via reviewed adapters → sign/encrypt package
 Independent ledger            ▼
 (separate store, own        Object storage bucket (EU, versioned, object lock ≥30d+margin)
  principal) ──daily signed export──> ledger mirror prefix/bucket (object lock)
```

- **Capture job**: daily (RPO ≤24h with margin), a scheduled runner outside Vercel functions (e.g. a scheduled CI workflow or small container job *(verify runtime limits/cost)*), using a dedicated read-only database principal. Writes one package per run; alerts on failure or on a missing run.
- **Storage**: one EU bucket in the same region as Atlas (Frankfurt), versioning and object lock for the history window plus margin, lifecycle expiry after that (bounded retention, ADR-074). Capture credentials can write but not delete; restore credentials can read only.
- **Independent ledger**: see §2 options. The app writes receipts there *before* local erasure.
- **Restore**: always into a new isolated target with no ingress, jobs or provider egress; release only through the fence in §4.

## 2. Ledger independence and rollback resistance

Invariants: (a) a restore of the main database can never roll the ledger back; (b) the ledger survives loss of the main cluster; (c) a rollback of the ledger itself is detectable; (d) it holds only minimal signed receipts (ADR-074/076).

Mechanism common to all options:
- **Ledger-first**: accept receipt (majority/durable write) → fence the subject locally → erase → record completion. Partial failure keeps suppression active (already implemented).
- **Monotonic head**: the ledger keeps a head revision incremented on every accepted/completed receipt. Readers get `(receipts, head, readAt)`; `restorationSuppression` already refuses stale reads and mismatched revisions.
- **Watermark**: a restored or running system stores the last head it fully applied. `head < watermark` means ledger rollback → release blocked; `head > watermark` → apply the delta.
- **Mirror**: a daily signed export of the ledger into object-locked storage makes a rollback of the ledger store detectable and repairable (receipts are signed; the export cannot be silently rewritten).

| Option | Independence | Durability | Engineering | Recurring cost |
|---|---|---|---|---|
| **B1 (recommended)** separate Atlas project + cluster, dedicated principal | Separate cluster, separate credentials; never restored with the main DB | Replica set; tier backups *(verify tier)* + object-locked mirror | Lowest: reuses `DeletionReceiptStore`; add head/watermark | One more cluster *(verify price/tier; a free tier may lack backups and SLA)* |
| **B-min (cheapest meeting invariants)** ledger as an append-only signed log in a separate object-locked bucket | Separate service and credentials | Object storage durability + object lock | Higher: new store adapter; head via conditional writes *(verify conditional-write support)* | Storage requests only |
| Rejected: separate database in the same cluster | A cluster-level restore rolls it back with the data it protects | — | — | — |

## 3. Consistent capture across collections

**Proposed mechanism: one snapshot session per capture.** All collections are read inside a single MongoDB snapshot session (`readConcern: "snapshot"`), i.e. at one cluster time; the manifest records that `atClusterTime` as the recovery point.

Local evidence (2026-09-29, synthetic, temporary single-node replica set on loopback, removed afterwards): while 269 concurrent transactional writes maintained `balance = sum(transactions)`, 20 snapshot-session captures had **0** invariant violations; 20 naive per-collection captures had **100** (every capture inconsistent).

Precise guarantee and limits:
- The capture is **crash-consistent**: it equals what a crash at `atClusterTime` would leave. Multi-step application writes that are not in one transaction (e.g. revision appended before a canonical upsert) may be caught mid-way, exactly as after a crash. The recovery inspectors already report such states (missing evidence, sequence gaps, interrupted syncs/commands) as release barriers rather than repairing them.
- Snapshot history is bounded (server snapshot-history window; self-managed default 5 minutes *(verify Atlas setting/tier)*). A capture that exceeds it fails and retries; current data sizes are far below this. If data grows past it, the fallback is §4 quiescence.
- The main cluster tier must support snapshot sessions *(verify for the chosen tier; shared/free tiers may restrict features)*. If it does not, the fallback is quiescence capture, which costs a short write outage.
- Capture also fails closed on any row an adapter rejects (schema drift, legacy shape): the package is never silently partial.

## 4. Write-fence, watermark and quiescence semantics

- **Capture**: no write fence needed with snapshot sessions. Fallback quiescence capture: enable a global server-enforced maintenance mode (all mutating routes and jobs refuse), wait for in-flight requests to drain, capture, disable. Existing kill switches cover only AI, paid refresh and email; a global maintenance switch is new repository work.
- **Release of a restored system** (`releaseFence`):
  1. Restored system is in maintenance mode; no ingress, jobs or provider egress.
  2. Read ledger head `H` and receipts from the independent ledger.
  3. Apply every receipt ≤ `H`: owner suppression across all collections, shared redaction, provider-subject markers, bank/notification quarantine.
  4. Verify by scan: no row of a suppressed subject remains; no binding to a marked subject; bank non-completed commands are fenced; no pending notification sends.
  5. Store watermark `H`; re-read head `H'`; if `H' ≠ H`, repeat from 3.
  6. Operator release (policy gate), then leave maintenance mode. Deletions after release follow ledger-first ordering; a periodic reconciler compares head and watermark.

## 5. Failure modes and restore procedure

| Failure | Detection | Response |
|---|---|---|
| Capture fails / late | job status + missing-run alert | retry; RPO breach escalates to owner |
| Snapshot too old | driver error | retry; if persistent, quiescence capture |
| Adapter rejects a row | capture fails closed | fix via reviewed adapter change; never copy raw |
| Storage unavailable | upload error | retry with backoff; alert |
| Package tampered/corrupt | signature/digest check on open | use previous package; incident |
| Package keys lost | open fails | offline sealed key escrow (§6); otherwise backups are unrecoverable |
| Ledger unavailable/stale at restore | freshness/revision check | **restore blocked** (fail closed) |
| Ledger rolled back | head < watermark or mirror mismatch | block; rebuild ledger from signed mirror |
| Identity key mismatch | binding alias preflight (F) | release barrier until keyring fixed |
| Interrupted provider command / retirement | inspectors | operator review; never retried |

Restore procedure (RTO ≤4h target, to be measured): declare incident → create isolated target → fetch chosen package and keys → open/verify → read ledger → apply quarantine transforms → materialize with recreated indexes → inspectors → release fence (§4) → operator release → post-release reconciler. Record timestamps for RTO/RPO evidence.

## 6. Secret and key management

| Secret | Holder | Notes |
|---|---|---|
| Package signing/encryption key (versioned) | capture job + restore operator | never in packages; manifest records version only |
| Ledger HMAC/signing key (versioned) | app runtime + restore operator | separate from package key and AUTH_SECRET |
| Financy identity keyring (F) | app runtime + restore operator | v1 = current AUTH_SECRET bytes after decoupling |
| Backup DB principal | capture job | read-only on app DB |
| Ledger principal | app runtime | read/write ledger only |
| Storage credentials | capture: write-no-delete; restore: read-only | object lock prevents deletion either way |

All secrets live in the platform/runner secret stores, never in the repository, packages, logs or chat. Package and ledger keys additionally need an owner-held offline sealed copy; losing them makes every backup unusable. Rotation adds a version and keeps old versions for the history window plus margin.

## 7. Cheapest option vs recommended

- **Cheapest meeting all invariants**: snapshot-session capture from the existing cluster (if its tier supports it) by a scheduled runner, one object-locked bucket for packages, and the ledger as a signed append-only log in a second object-locked bucket (B-min). Recurring cost: object storage and runner minutes. More new code (ledger store adapter, conditional-write head).
- **Recommended**: same capture and storage, with the ledger in a separate Atlas project/cluster (B1) reusing the existing receipt store, plus the daily signed mirror to object-locked storage. Recurring cost: one additional cluster at a tier to be chosen *(verify)*. Less new code and simpler operations.
- Both require verifying: snapshot-session support and history window on the chosen Atlas tier; object lock and conditional writes on the chosen storage vendor; runner limits.
- Unrelated to backups but relevant: the main cluster is on a free tier; production availability/SLO may need a paid tier regardless (separate decision).

## 8. Buildable and testable locally before provisioning

Can be built and verified locally (synthetic data; a local single-node replica set is needed only for snapshot tests):
1. Capture function: snapshot session over all restorable collections, adapters, package with `atClusterTime`; concurrency test like §3.
2. Storage adapter interface with an in-memory/filesystem fake that enforces write-once semantics.
3. Ledger head/watermark on the existing Mongo receipt store (B1 path) or a fake object-log store (B-min path).
4. `releaseFence` orchestration and the full ownership scan across all collections.
5. Global server-enforced maintenance/write fence.
6. Runtime refusal (or review requirement) for binding a provider subject marked by a deletion receipt (ADR-076 C3).
7. Failure-injection tests for §5 and a scripted local restore drill with timing.

Cannot be proven locally: vendor features and limits, real RPO/RTO, credentials and IAM, Atlas tier behavior, alerting delivery.

## Decisions requested

1. B1 or B-min for the ledger.
2. Storage vendor/region and whether object lock is required (recommended: yes).
3. Capture runner choice.
4. Approval to build the local items in §8 (repository-only, no provisioning).
5. Afterwards, separate approval for provisioning and credentials.
