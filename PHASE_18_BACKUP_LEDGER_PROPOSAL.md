# Phase 18 — A+B proposal: consistent backups and an independent deletion ledger

2026-09-29. **Proposal, owner decisions (§9) and local build (§10).** No infrastructure, purchase, cluster, bucket, credential, Vercel or Atlas change was made or is authorized by this document. Vendor capabilities marked *(verify)* must be confirmed against current vendor documentation and pricing before a decision. Requirements come from the approved targets (RPO ≤24h, RTO ≤4h, ≥30-day history, isolated restore) and ADR-074/076.

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

## 9. Owner decisions (2026-09-29)

B1 is the target ledger architecture (separate MongoDB project/cluster, separate principal); B-min remains a documented fallback only. A target: filtered, encrypted logical BSON packages in object storage with immutability/Object Lock, never full Atlas snapshots containing sessions/provider/OAuth credentials. One snapshot session per capture is approved in principle. Approved now: build and test §8 locally. **Not approved:** provisioning, purchase, cluster/bucket creation, credentials, Vercel/Atlas changes or staging actions. Region and runtime: recommendation only (§11).

## 10. Built and proven locally (synthetic data, temporary loopback replica set)

| Component | Code | Proof |
|---|---|---|
| Independent ledger with monotonic head | `deletion-receipt-store.ts` (majority transactions; head advances once per accept/completion; idempotent retries; `snapshot()`; `isProviderSubjectErased`; versioned keyring) | head counts under concurrent and timed-out retries; aborted transaction never advances head; tamper and outage fail closed; erasures under an older ledger key stay effective after rotation, and dropping the old key fails closed |
| Signed ledger mirror | `ledger-mirror.ts` (`mirrorLedger`, `highestMirroredHead`) | a ledger rolled back behind its newest signed export is refused even when not behind the backup; corrupted or forged exports fail closed |
| Ledger-first erasure protocol | `erasure-protocol.ts` | accept before any local step; completion only after verification; crash/verify-failure and lost-operation-ID retries resume the stored operation; a binding claimed between alias read and fence blocks erasure; ledger unavailable ⇒ nothing local |
| Capture coordinator | `backup-capture.ts` (snapshot pinned by a namespace-independent read before any collection read — a read of a missing collection returns no cluster time —, unknown-collection refusal, excluded collections never read, duration bound, write-once upload, signed `recoveryPoint`) | 3 captures during continuous transactional writes: no split account/transaction pair; standalone server, adapter rejection, over-long capture, unknown collection and upload failure all fail closed with nothing stored |
| Restore orchestration | `restore-orchestration.ts` `restoreIntoQuarantine` (fresh target only, existing quarantines composed, state `restoring → restored`) | backup older than a deletion restores without the erased owner, survivor BSON exact; interrupted restore can never be fenced; retry into the same target refused; retry into a fresh target succeeds |
| Release fence + restore watermark | `releaseFence`, `verifyReleaseWatermark` (release state signed with the operator ledger key) | fails closed on ledger unavailable, stale, older than backup or its mirror, advanced since restore or during fence, rolled back after release; on residual erased references, unfenced provider commands, changed counts, missing or forged watermark/state |
| Anti-resurrection | claim guard (`erasedProviderSubject`, checked before and after the claim with compensation) + fence marker scan | erased subject cannot be rebound while its receipt is retained, including when an erasure completes mid-claim; guard outage fails closed; control shows rebinding without the guard |
| Owner probe | `scripts/snapshot-session-probe.mjs` | supported on the local replica set, unsupported (NotAReplicaSet) on a standalone |
| Key/secret interface | `recovery-keys.ts` | versioned base64 keys, active version, no value echo |
| Package format | manifest v2 with signed recovery point | ledger-behind-backup detection |

Independent review (no Critical; six Important: ledger rollback after capture, unsigned release state, fail-open markers after ledger-key rotation, alias-capture race, claim race, CI skipping replica suites) — all fixed as above, plus CI now starts a single-node replica set; my own probe found that a snapshot read of a missing collection does not pin the snapshot, fixed by pinning first. Adversarial mutation run: 29 guard removals; 28 caught by a test; the survivor ("watermark requires fenced state") is redundant by construction because the signed state cannot carry a watermark unless fenced. Remaining documented limits: the claim guard and release tooling are wired to the ledger only when it is provisioned (no runtime ledger exists yet); the fence scan matches ObjectIds and whole 24-hex strings, not composite strings or binary IDs (none persisted today); ledger collections and head should be created at provisioning; collections created during a capture that are not in the inventory are refused only if present at listing time.

## 11. Vendor verification and recommendations

Verified from vendor documentation on 2026-09-29 (re-check at provisioning):
- **Vercel** ([duration](https://vercel.com/docs/functions/configuring-functions/duration), [cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs)): function duration 300 s (Hobby), 800 s (Pro/Enterprise; 1800 s beta); cron failures are not retried; delivery is best effort and can be missed or duplicated; overlapping runs need a lock.
- **AWS S3 Object Lock** ([docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)): requires versioning; per-version retention or bucket default retention; *compliance* mode cannot be shortened or bypassed by anyone, *governance* mode can be bypassed with `s3:BypassGovernanceRetention`; a simple DELETE only adds a delete marker, a versioned DELETE of a locked version is refused.
- **MongoDB** ([snapshot read concern](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/), [Flex limits](https://www.mongodb.com/docs/atlas/reference/flex-limitations/), [free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)): snapshot reads outside transactions support find/aggregate/distinct and are bounded by `minSnapshotHistoryWindowInSeconds` (changing it on Atlas requires Atlas Support); free clusters have no backups and no private endpoints; Flex has one daily snapshot, no private endpoints or peering, 500 ops/s. **Snapshot-read support on M0/Flex is not documented** — verify with a read-only probe before relying on it (capture fails closed otherwise).

**Object storage: AWS S3 in eu-central-1 (Frankfurt)**, same provider and region as the documented Atlas cluster (AWS Frankfurt). Reasons: no cross-region/cross-cloud transfer of the full dataset, EU residency, verified Object Lock semantics, IAM roles instead of static keys. Not Vercel's region: Vercel functions run in `iad1` (US), which would move every capture across the Atlantic. Configuration: versioning on, Object Lock with bucket default retention = history window (30 days) + margin, lifecycle removing noncurrent versions after lock expiry (bounded retention), KMS encryption, write-only capture role without delete, read-only restore role, separate break-glass role.
**Mode decision for you:** *compliance* gives the strongest protection against compromised credentials but makes early physical deletion from backups impossible for the whole retention period (erasure is then enforced by ledger suppression at restore, as designed). *Governance* allows an audited break-glass deletion. Recommendation: governance with the bypass permission only on a separate MFA-protected break-glass role, moving to compliance after a legal check that no obligation requires earlier physical deletion.

**Capture runtime: a dedicated managed worker in AWS eu-central-1** (EventBridge Scheduler → Lambda, or a Fargate task if a capture ever approaches Lambda's 15-minute limit — verify), not Vercel Cron.

| Criterion | Vercel Cron + Function | GitHub Actions schedule | AWS scheduled worker (recommended) |
|---|---|---|---|
| Timeout vs snapshot window | 300/800 s; enough today | hours | 15 min (Lambda) or unbounded (Fargate); both exceed the ~5 min default snapshot window, which is the real bound |
| Retries / missed runs | none; best effort; duplicates | delayed/skipped under load | scheduler retry policy + dead-letter + alarm on missing package (verify configuration) |
| Region / data path | `iad1` → cross-Atlantic | runner region not controlled | same region as Atlas and S3 |
| Secret isolation | package keys in the app runtime env, readable by every function | repository secrets | separate account/role; IAM to S3; Secrets Manager/KMS; app never holds backup keys |
| Network to Atlas | dynamic IPs ⇒ keeps `0.0.0.0/0` | dynamic IPs | static egress (NAT) or private endpoint on a dedicated tier |
| Observability | function logs | workflow logs | CloudWatch metrics/alarms, run history |
| Cost | included | minutes | Lambda/Scheduler negligible; NAT gateway or dedicated tier is the main cost (verify pricing) |

Independent of provisioning, the capture design already tolerates missed/duplicate runs (write-once names, every run is a full package) and fails closed on anything it cannot guarantee.

## 12. Minimum external actions to close A+B

1. Decide Object Lock mode (above) and accept AWS eu-central-1 for storage and worker; create the AWS account/project structure and billing.
2. Create the ledger project/cluster (B1) in the same region; dedicated ledger principal; decide its tier (backups needed for the ledger itself).
3. Decide the main cluster tier and network path for capture (static egress IP allowlisted, or dedicated tier with private endpoint); this also retires the known `0.0.0.0/0` exposure.
4. Run a one-time read-only snapshot-session probe on the chosen main-cluster tier (a script from this repository; synthetic database; no data read).
5. Create and store secrets: package keys, ledger keys, identity keyring (F), principals; configure the worker; wire the claim guard and release tooling to the ledger (repository change, separate approval).
6. First real capture, isolated restore drill with measured RPO/RTO (≤24h/≤4h), then retention/lifecycle and alarm verification — the evidence Phase 18 rows 18-10/11 still need.
