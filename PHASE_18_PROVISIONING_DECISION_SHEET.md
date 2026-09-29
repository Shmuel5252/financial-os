# Phase 18 — Final Provisioning Decision Sheet (A+B)

2026-09-29. Prepared for the owner's decision. **Nothing here is approved or provisioned**: no account, resource, billing, secret, network or deployment change has been made. Execution follows `PHASE_18_PROVISIONING_RUNBOOK.md` stage by stage after each approval. The repository side (C1–C7) is built and tested locally (§5).

Prices are USD, approximate, list prices without free-tier credits or taxes, and must be re-confirmed on the vendor pricing page at approval time. **Verified** = read from vendor documentation on 2026-09-29; everything else is an estimate.

## 1. Resources

"Fixed" = billed whether or not anything runs. "Variable" = at staging scale (daily capture, packages in the low MB, a handful of claims/erasures).

| # | Resource | Provider / tier / region | Fixed / month | Variable / month | Cheapest invariant-preserving alternative | What blocks anything cheaper | Staging cheaper, upgrade before production? |
|---|---|---|---|---|---|---|---|
| R1 | Backup bucket (Object Lock Governance 35 d, versioning, lifecycle 36 d) | AWS S3 Standard, `eu-central-1` | $0 | < $0.10 (≈ $0.0245/GB-month; PUT ≈ $0.0054/1k) | This one | Write-once (Object Lock + `If-None-Match`) is the backup invariant; cold classes (Glacier IR/Deep Archive) have 90/180-day minimums and retrieval fees → not cheaper at this size, slower RTO | Same in both |
| R2 | Bucket encryption key | AWS KMS customer key (D3) | ≈ $1 | ≈ $0 (requests $0.03/10k) | **SSE-S3 ($0)** — template `UseKms=false` | Nothing: packages are already AES-256-GCM encrypted and HMAC-signed by the app with keys that never reach S3. KMS adds only key-policy separation and decrypt audit trail | **Yes**: SSE-S3 in staging; KMS optional in production (cannot switch an existing object, new objects only) |
| R3 | Worker secrets | AWS SSM Parameter Store, standard, SecureString (`aws/ssm` key) | $0 | $0 | This one (Secrets Manager ≈ $0.40/secret is dearer) | — | Same |
| R4 | Backup worker | AWS Lambda arm64, 1024 MB, ≤ 10 min, reserved concurrency 1 | $0 | ≈ $0–0.15 (≈ 9k GB-s) | This one | — | Same |
| R5 | Schedule + dead-letter queue + alarm topic | EventBridge Scheduler, SQS, SNS e-mail | $0 | $0 (free allowances) | This one | — | Same |
| R6 | Metric, 4 alarms, logs (30 d) | CloudWatch | ≈ $0.70 (0 within the first 10 alarms/metrics free allowance) | < $0.10 | This one | Missing-success alarm (26 h, missing = breaching) is the RPO control | Same |
| R7 | Break-glass alert, audit trail | CloudTrail management trail (first copy free) + EventBridge rule | $0 | cents (trail storage) | This one | Governance bypass must be observable (D12) | Same |
| R8 | Cost guardrail | AWS Budgets | $0 | $0 | This one | — | Same |
| R9 | Worker static egress | VPC + NAT Gateway + Elastic IP (D5), `eu-central-1` | ≈ $38 NAT + $3.65 IPv4 ≈ **$42** *(Frankfurt NAT rate unverified; IPv4 $0.005/h verified)* | ≈ $0.05/GB | **NAT instance t4g.nano + EIP ≈ $8** (same static IP; you patch it — template variant not yet written) · **No VPC ($0)** — template `EgressMode=none` | A static IP matters only once Atlas access lists are narrowed (production network decision 18-04). Private endpoints would need M10+ on **both** clusters | **Yes**: staging runs with `EgressMode=none` while staging access lists stay open (the already-accepted staging risk; auth + TLS unchanged). Production adds NAT when lists are narrowed |
| R10 | Independent deletion ledger (B1) | MongoDB Atlas **Flex**, AWS Frankfurt, own project | **≈ $8** (verified: $0.011/h up to 100 ops/s; capped at $30 at 500 ops/s) | $0–22 only if ops/s rise | **M0 Free ($0)** — see §3.2 | M0: no backups/SLA, 100 ops/s, paused after 30 days without activity (verified). Flex meets every ledger requirement (§3) | Possible (M0 in staging with explicit acceptance, §3.2) — **recommended: Flex from the start**, as instructed |
| R11 | Main application cluster (capture source) | Existing Atlas **Free (M0)** staging cluster, AWS Frankfurt | $0 today | — | Keep M0 **if** the S2 snapshot probe passes | If M0 refuses snapshot sessions, capture cannot guarantee cross-collection consistency (fails closed) → Flex ≈ $8 (D7) or an approved quiescence-capture design | Staging decided by the probe; production tier is the separate availability decision (18-04) |
| R12 | App → ledger path | see §4 | $0 (options a/a′) · ≈ $0–2 (d, in production reusing R9) · **$100** (b, cost gate) | — | Option **a** (staging) / **a′ or d** (production) | Static IPs are not required by any invariant; they narrow the list but use a shared pool | **Yes** |
| R13 | Restore drill | Local loopback replica set on an encrypted disk (D10) | $0 | S3 egress cents | This one | Isolation invariant holds locally (no ingress/jobs/provider egress) | Same; an Atlas-hosted drill later costs cents (hourly Flex) |

Not needed: Secrets Manager, Vercel Secure Compute (Enterprise), Atlas private endpoints/peering, Atlas continuous backup, AWS Backup, a second region.

## 2. Totals (per month, before free-tier credits)

| Configuration | What it contains | Estimate |
|---|---|---|
| **Staging minimum (recommended start)** | R1 + SSE-S3 + R3–R8 + Flex ledger + main M0 (probe passes) + `EgressMode=none` + app path a | **≈ $9–10** |
| Staging, if the main-cluster probe fails | same + main cluster to Flex | ≈ $17–18 |
| Production minimum preserving every invariant | Flex ledger + NAT instance + SSE-S3 + app path a′ (or d) + main-cluster tier per 18-04 | ≈ $17–20 + main tier |
| Production with managed NAT + KMS | Flex ledger + NAT Gateway + KMS + app path d | ≈ $52–55 + main tier |
| Adding Vercel Static IPs | cost gate, **not recommended** | + $100 |

**Estimated minimum to close Phase 18's A+B evidence (staging, §4 of the runbook: 7 consecutive daily captures + one drill + forced alarms): ≈ $9–10/month recurring, ≈ $18 if the main cluster must move to Flex** — at least one billed month (usage is prorated hourly). One-time costs are owner time only. Production repetition afterwards adds the production rows above; the remaining non-A+B Phase 18 gates are owner/policy work, not spend.

## 3. Does Atlas Flex satisfy the ledger? (runbook D6)

### 3.1 Requirement check (sources: Atlas Flex limitations and pause/resume docs, verified 2026-09-29)

| Ledger requirement (why) | Flex | Evidence / condition |
|---|---|---|
| Multi-document transaction, majority write concern (receipt + monotonic head written atomically) | Not listed as unsupported; Flex is a replica set | **Must pass** `scripts/ledger-probe.mjs` on the real cluster (S1) |
| Snapshot session pinned by `$documents` (consistent ledger snapshot for mirror/restore) | `$documents` not among the unsupported stages; MongoDB ≥ 8.0 | Same probe |
| TLS always; password (SCRAM) or AWS IAM authentication | Supported | App refuses non-TLS/insecure-TLS URIs (`deletion-ledger-runtime.ts`) |
| Least-privilege users (`readWrite@deletion_ledger`, `read@deletion_ledger`) | Built-in roles and custom roles supported | Created in S1 |
| IP access list | Supported | Private endpoints / VPC peering **not** supported |
| Never paused | Verified: Flex cannot be paused manually or automatically | M0 is paused after 30 days of inactivity |
| Capacity (2 collections, tiny documents, low ops) | 500 ops/s, 500 connections, 5 GB, DB name ≤ 38 bytes, nesting ≤ 50 | App pool capped at 5 connections per instance |
| Durability | One daily snapshot, no point-in-time restore | Ledger integrity is cryptographic (signed receipts, monotonic head, signed Object Lock mirror). Receipts newer than the last mirror depend on cluster replication on **any** tier → synchronous mirror-on-accept is required before erasure is enabled (tier-independent gate) |
| Outage detection | Flex alerts only on Connections / Logical Size / Network / Opscounter | Covered by the worker (mirrors the ledger first → Errors alarm + 26 h missing-success alarm); claims fail closed while unreachable |
| Region | Subset of regions | Confirm AWS Frankfurt is offered at creation |

**Verdict: Flex satisfies every invariant the ledger needs** (conditional on the probe passing on the actual cluster), so Flex is the preferred starting tier for staging and production. **Dedicated (M10+) is required only if you decide you want**: private endpoint / VPC peering for the ledger, database audit logs or access history, point-in-time restore, customer-managed encryption-at-rest keys, or a contractual SLA. None of these is a current Phase 18 invariant. If the probe fails on Flex, the failing capability (transaction or snapshot session) is the exact reason to move to M10.

### 3.2 M0 for staging (cheaper, not recommended)
M0 would also pass the invariants if the probe passes: the daily worker run counts as activity (so no auto-pause while the schedule runs), a ledger lost entirely could be rebuilt from the signed mirror up to the last mirror (rebuild tooling not built), and every failure is fail-closed. It gives up backups, SLA and headroom (100 ops/s), and the recovery evidence gathered on M0 would not transfer to production. Saving: ≈ $8/month.

## 4. App → ledger connectivity (D8)
Every option keeps TLS, a dedicated least-privilege ledger principal and fail-closed claims. They differ in who can reach the ledger's port.

| Option | Network exposure | Credential | Cost | Build work | Trade-off |
|---|---|---|---|---|---|
| **a** Open access list + TLS + `ledger-app` SCRAM user | Internet (like the current staging main cluster) | Static password in Vercel env | $0 | none (built) | Leaked password + URI = direct access; mitigated by least privilege and rotation |
| **a′** Same network, **MONGODB-AWS auth** via Vercel OIDC → AWS role | Internet | No static password; short-lived AWS credentials | $0 | small (credential provider + OIDC wiring; not built) | Removes the long-lived secret; does not narrow the network |
| **b** Vercel Static IPs | Allowlist = shared Vercel pool | as a/a′ | **$100 / project** (verified; Pro) | none | Cost gate; pool shared with other Vercel customers, so not equal to private networking |
| **c** Vercel Secure Compute + private networking | Private | as a/a′ | Enterprise contract; Atlas side needs M10+ | medium | Only fully private option; highest cost |
| **d** AWS ledger gateway: API Gateway (IAM auth) + Lambda in the worker VPC; app signs with Vercel OIDC → AWS role | Ledger allowlist = the NAT Elastic IP only | No static secret in Vercel | ≈ $0–2 on top of R9 | medium (gateway + client; not built) | Extra hop and dependency on claims (latency; fails closed); needs R9 anyway |
| — Atlas Data API | — | — | — | — | Retired by MongoDB; not an option |

Recommendation: **staging a** (no spend). **Production a′ or d**, decided together with the main-cluster network plan (18-04): d when the NAT for the worker is bought anyway and you want the allowlist narrowed; a′ when an internet-reachable, password-less ledger is acceptable. b only if you explicitly approve the $100/month gate.

## 5. Repository work completed (no provisioning)
C1 CloudFormation template `infra/aws/financial-os-backup.template.json` (conditional KMS and VPC/NAT; invariants unit-tested) · C2 Lambda worker `workers/backup/index.ts` + `runBackupWorker` + `npm run workers:build` · C3 S3 and directory object stores (write-once, validated names) · C4 `scripts/ledger-bootstrap.mjs` · C5 runtime ledger configuration (fail-closed, TLS enforced) wired as the default claim guard · C6 restore drill `runRestoreDrill` + CLI · C7 `scripts/ledger-probe.mjs`. Local evidence: worker → create-only store → drill → fence passes on a replica set; fail-closed cases for keys, configuration, non-TLS URIs, ledger outage, capture refusal, a missing mirror and a receipt deleted from the live ledger; 36/36 targeted mutations killed. An independent adversarial review found gaps that are fixed: plain `DeleteObject` and policy/lifecycle changes are now break-glass-only, objects expire at 36 days (D2), CloudWatch may publish to the alarm topic, MFA works with Identity Center, a protection-change alert, restore requires a verified mirror and every mirrored receipt, TLS enforced for worker/drill URIs, loopback ledger refused in production, the probe no longer drops foreign databases.

Still not built (only if chosen): NAT-instance template variant (R9 alternative), a′ / d connectivity clients, synchronous mirror-on-accept (required before erasure is enabled), a mirror-signing key separate from the ledger key (today a compromised worker could upload a forged mirror that makes later restores fail closed until break-glass cleanup — availability, not resurrection).

## 6. Decisions needed, in order
1. D1 AWS account + D9 alarm recipients + D12 break-glass custodian.
2. R2/D3 SSE-S3 (recommended for staging) or KMS.
3. R10/D6 Flex ledger (recommended) or M0 for staging.
4. R9/D5 staging `EgressMode=none`; production NAT Gateway vs NAT instance (later).
5. R12/D8 staging option a; production option later.
6. Explicit ledger opt-out: when no ledger is configured, require `FINANCIAL_OS_DELETION_LEDGER=disabled` (refused in production) instead of treating absence as "no ledger". Recommended before any production ledger exists; not applied yet because the next deployment would make open-banking claims on the current staging deployment fail until you set that variable.
7. Approve S0 → S1 (ledger + probe) → S2 (main-cluster probe) first: both probes cost nothing and settle R10/R11 before any AWS spend.

Sources: [Atlas Flex limitations](https://www.mongodb.com/docs/atlas/reference/flex-limitations/) · [Atlas pause/resume](https://www.mongodb.com/docs/atlas/pause-terminate-cluster/) · [Atlas pricing](https://www.mongodb.com/pricing) · [Vercel Static IPs](https://vercel.com/docs/networking/static-ips) · [Vercel OIDC with AWS](https://vercel.com/docs/oidc/aws) · [S3 conditional writes enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html) · [CloudWatch PutMetricAlarm limits](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html) · [AWS public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)
