# Phase 18 — A+B provisioning runbook (prepared, NOT executed)

2026-09-29. Owner-approved direction: AWS S3 `eu-central-1` for filtered/encrypted backup packages, Object Lock in **Governance** mode first, a managed backup worker in AWS `eu-central-1` (not Vercel Cron), and B1 (separate MongoDB project/cluster) for the independent deletion ledger. **No provisioning, resource creation, billing, credential, networking, staging or production change is authorized by this document.** Each stage starts only after the owner records its approval.

Design and local evidence: `PHASE_18_BACKUP_LEDGER_PROPOSAL.md` (§10 local build, §11 vendor verification). Costs, cheaper equivalents, the Flex assessment and app→ledger options: **`PHASE_18_PROVISIONING_DECISION_SHEET.md`** (it supersedes the cost estimates below). Repository items C1–C7 are implemented and tested locally (2026-09-29); every stage below still needs your approval. Prices below are approximations to be confirmed on the vendor pricing pages at decision time; the only price verified from vendor documentation today is Vercel Static IPs.

## 0. Conventions

| Tag | Meaning |
|---|---|
| **[OWNER]** | You perform it in a provider console/CLI. Claude never sees credentials, keys or connection strings. |
| **[CLAUDE]** | Repository-only work Claude can do after your approval: code, templates, scripts, tests, docs. Never touches providers or secrets. |
| **[SECRET]** | You generate it and enter it directly into the named store. Never paste into chat, Git, tickets or screenshots. |
| **[DECISION]** | Tier/cost/policy choice listed in §1. |
| **Verify** | Evidence to record (non-secret results only) before the next stage. |
| **Rollback** | What to undo if the stage fails. |

Names (proposed): environment `staging` first, `production` later with the same runbook. AWS account `financial-os-backup`; region `eu-central-1`; bucket `financial-os-<env>-backups-<random-suffix>`; prefixes `packages/`, `ledger-mirror/`; Atlas project `financial-os-ledger-<env>`; ledger database `deletion_ledger`. The application database is the existing one (`financial_os_staging` for staging).

Never reversible without waiting: an Object Lock bucket cannot disable Object Lock; a locked object version (Governance) can only be removed early with the break-glass permission. Test objects written during verification therefore stay until their retention ends (tiny cost).

## 1. Owner decisions required

| # | Decision | Options (approx. monthly cost) | Recommendation | Cheaper option with identical invariants? |
|---|---|---|---|---|
| D1 | AWS account | new dedicated account under your organization / existing account | New dedicated account: blast-radius and billing isolation from anything else | — |
| D2 | Retention | Object Lock default retention = backup history 30 days + margin; noncurrent-version expiry after lock | 35-day Governance default retention; objects expire at 36 days (the day after their lock ends), noncurrent versions 1 day later; abort incomplete uploads after 1 day | — (policy, not cost) |
| D3 | Storage encryption | SSE-KMS customer key (~$1 + requests) / SSE-S3 (free) | SSE-KMS: separate key policy and CloudTrail record of every decrypt | **SSE-S3 keeps the same confidentiality invariant** because packages are already AES-256-GCM encrypted and HMAC-signed by the application with keys that never live in S3; KMS adds auditing/separation only. Savings ≈ $1/month. |
| D4 | Worker secrets store | SSM Parameter Store SecureString, standard tier (free) / Secrets Manager (~$0.40 per secret) | **SSM Parameter Store** | Yes — same KMS-encrypted, IAM-scoped, CloudTrail-audited storage; we do not use automatic rotation. |
| D5 | Worker static egress (needed for Atlas IP allowlists) | NAT Gateway (~$35–45 + data) / NAT instance t4g.nano + Elastic IP (~$7–8) / Atlas private endpoint (needs M10+) | NAT Gateway (managed, nothing to patch) | NAT instance gives the same static-IP invariant but adds an internet-facing instance to patch (Amazon Linux + automatic patching via SSM Patch Manager). Equal only if you accept that maintenance duty. |
| D6 | Ledger cluster tier (B1) | Flex ($8–30, usage based; daily snapshot; **never paused** — Atlas cannot pause Flex manually or automatically) / M0 free / M10 (from ~$57; backups, private endpoints) | **Flex** in AWS Frankfurt, subject to the S1 probes (see `PHASE_18_PROVISIONING_DECISION_SHEET.md` §3) | M0 keeps durability only if the ledger is mirrored to Object Lock *synchronously on every receipt* (C5); **M0 (Free) is automatically paused after 30 days of inactivity**, has no backups or SLA, and its snapshot/transaction support must pass the probe. Lower availability ⇒ claims/erasures fail closed more often. Not equal on availability. The pause risk applies to M0 only, not to Flex. |
| D7 | Main cluster tier for capture | keep current tier if the probe passes / upgrade | Decide after the probe (S2) | — |
| D8 | App → ledger network path | a) open access list + TLS + least-privilege `ledger-app` user (free) · a′) same with MONGODB-AWS auth via Vercel OIDC (free, no static password) · b) Vercel Static IPs ($100/month per project — cost gate) · c) Secure Compute (Enterprise) · d) AWS ledger gateway behind the worker NAT (≈ $0–2 + NAT) — decision sheet §4 | Staging a; production a′ or d with 18-04 | Static IPs are not required by any invariant; b is not auto-approved. |
| D9 | Alarm recipients / on-call | email address(es) | Your email + a second contact | — |
| D10 | Restore-drill location | local loopback replica set on an encrypted disk (existing tooling) / temporary isolated Atlas project | **Local first** (cheaper, already built and tested), cloud drill later for realistic RTO | Local preserves isolation (no ingress, jobs or provider egress) if the disk is encrypted and the data destroyed afterwards. |
| D11 | Capture schedule | daily at a fixed time | Daily 03:00 Asia/Jerusalem (RPO ≤ 24h) | — |
| D12 | Break-glass custodian | who can bypass Governance retention (legal deletion) | You only, MFA-protected, every use alarmed | — |
| D13 | Identity keyring (design F, Step 1) | before production restore / later | Before any `AUTH_SECRET` rotation and before a production restore drill | — |

Estimated recurring totals: see the decision sheet §2 (staging minimum ≈ $9–10/month with SSE-S3, a Flex ledger, `EgressMode=none` and app path a; production adds static egress). Confirm every figure before approving.

## 2. Secrets [SECRET] — you create and store them; Claude never sees them

| Secret | Stored in | Used by | Escrow |
|---|---|---|---|
| Package key v1 (32 random bytes, base64) + active version | SSM `/financial-os/<env>/backup/package-key-v1`, `/…/package-key-active-version` | worker (encrypt/sign packages), restore operator at drill time | Offline sealed copy (password manager vault + printed copy in a safe). Losing it makes every backup unusable. |
| Ledger key v1 (32 bytes, base64) + active version | Vercel env `FINANCIAL_OS_DELETION_LEDGER_KEY_V1` / `FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION` (app, ledger writes/markers); SSM `/financial-os/<env>/ledger/key-v1`, `/…/ledger/key-active-version` (worker, mirror signing) | app, worker, restore operator | Offline sealed copy |
| Atlas `backup-reader` user (read-only on the application DB) connection string | SSM `/financial-os/<env>/backup/app-db-uri` | worker | — (regenerable) |
| Atlas `ledger-mirror` user (read on `deletion_ledger`) connection string | SSM `/financial-os/<env>/ledger/read-uri` | worker; restore operator (`FINANCIAL_OS_LEDGER_READ_URI` in the drill shell) | — |
| Atlas `ledger-app` user (readWrite on `deletion_ledger` only) connection string (`mongodb+srv://`, TLS) | Vercel env `FINANCIAL_OS_LEDGER_MONGODB_URI` + `FINANCIAL_OS_LEDGER_DATABASE` + `FINANCIAL_OS_ENVIRONMENT` | app | — |
| AWS human access | IAM Identity Center users with MFA; **no long-lived access keys** anywhere | you | root account MFA; root credentials offline |

Generating a key without displaying it (Windows PowerShell 5.1, cryptographic RNG), writing it straight into SSM, then clearing it:

```powershell
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = [Convert]::ToBase64String($bytes)
aws ssm put-parameter --region eu-central-1 --name "/financial-os/staging/backup/package-key-v1" --type SecureString --value $key --no-overwrite
Remove-Variable key, bytes
```

For Vercel, pipe the variable into `vercel env add <NAME> production` in the same session instead of typing the value. The command history records `$key`, not the value. Generate Atlas passwords with Atlas's own generator and paste them only into the connection-string parameter.

## 3. Stages

### S0 — Accounts, guardrails, repository preparation
- [OWNER] D1: create/choose the AWS account; root MFA; IAM Identity Center with **MFA required at every sign-in** (the template's `OperatorSignIn=identity-center` relies on it; Identity Center sessions carry no `aws:MultiFactorAuthPresent`); AWS Budgets alert at your chosen monthly limit; enable CloudTrail management events plus **S3 data events (write) for the backup bucket** in `eu-central-1` (the protection-change alert needs them); use regional STS endpoints (global-endpoint AssumeRole events are logged in us-east-1); check the Lambda concurrency quota is at least 11 (reserved concurrency 1 needs 10 unreserved; the increase request is free).
- [OWNER] Atlas: confirm organization access and billing for a new project (D6).
- [CLAUDE] Repository changes — **implemented 2026-09-29** (tested locally, no credentials; file names in the decision sheet §5):
  - C1 CloudFormation template for S3 bucket/policy/lifecycle, KMS key (if D3 = KMS), IAM roles, VPC/NAT/EIP, Lambda, EventBridge Scheduler, SQS dead-letter queue, SNS topic, CloudWatch alarms — deployed by you.
  - C2 Lambda worker entry (reads SSM, runs `mirrorLedger` then `captureBackup`, emits a success metric) and a bundling script.
  - C3 S3 `BackupObjectStore` adapter: `PutObject` with `If-None-Match: *` (a 412 on an identical content-hashed name counts as already stored), SSE header, no Get/Delete in the worker.
  - C4 ledger bootstrap script (creates `deletionReceipts`, `deletionLedgerHead` and the head document) and a ledger smoke test against a throwaway `ledger_probe` database.
  - C5 app wiring behind configuration: `FINANCIAL_OS_LEDGER_MONGODB_URI`, `FINANCIAL_OS_LEDGER_DATABASE`, ledger keyring `FINANCIAL_OS_DELETION_LEDGER_KEY_*`; nothing set = no ledger (refused in production), partial/invalid/non-TLS = configuration error; the claim guard uses the configured ledger by default. **Not built yet:** synchronous mirror-on-accept (required before enabling erasure; if the app writes to S3 it must use Vercel OIDC federation to an AWS role, never static keys).
  - C6 restore-drill CLI (downloads with your operator session, restores into a local loopback replica set, runs the fence, prints only counts and timings).
  - C7 ledger transaction probe (in addition to the existing snapshot probe).
- Verify: CloudTrail on; budget alert exists; templates reviewed.
- Rollback: nothing provisioned yet.

### S1 — Ledger cluster (B1) [OWNER]
1. Create Atlas project `financial-os-ledger-<env>`; cluster tier per D6 in AWS Frankfurt (`eu-central-1`).
2. Database users: `ledger-app` → custom role with only `find`, `insert`, `update` on `deletion_ledger` (no `remove`/`dropCollection`: the ledger never deletes receipts); `ledger-mirror` → `read@deletion_ledger`; a temporary `ledger-probe` user → `readWrite@ledger_probe` for step 5 only, deleted afterwards. No other roles. (Restore also refuses a live ledger missing any mirrored receipt.)
3. Network: add the worker's Elastic IP after S4; app path per D8. Enable TLS-only (default).
4. Atlas alerts → D9 recipients. Flex offers only Connections, Logical Size, Network and Opscounter conditions; ledger outages are caught by the worker's Errors and missing-success alarms (it mirrors the ledger first) and claims fail closed.
5. [CLAUDE-prepared, OWNER-run] Temporarily allowlist your current IP (one hour), then in your shell: `$env:PROBE_MONGODB_URI='<ledger-probe uri>'; node scripts/ledger-probe.mjs` (refuses a non-empty database; drops only what it created) (must print two `supported` lines, exit 0) and `$env:LEDGER_BOOTSTRAP_URI='<ledger-app uri>'; $env:LEDGER_BOOTSTRAP_DATABASE='deletion_ledger'; node scripts/ledger-bootstrap.mjs` (idempotent). Remove the temporary IP. Neither script prints a URI or document.
- Verify: both probes print `supported`; bootstrap created two collections and head revision 0; users have only the listed roles.
- Rollback: delete the project (no data yet).

### S2 — Snapshot probe on the main cluster [OWNER, early and cheap]
1. Create Atlas user `backup-reader` with the built-in `read` role on the application database only.
2. Temporarily allowlist your current IP; run `scripts/snapshot-session-probe.mjs` with `PROBE_MONGODB_URI`/`PROBE_DATABASE` set in your shell; remove the temporary IP.
- Verify: `supported` → capture can run on this tier. `unsupported` → D7: upgrade the main cluster tier, or approve building a quiescence capture (maintenance-mode write fence) before continuing.
- Rollback: delete the `backup-reader` user; remove the temporary IP.

### S3 — Encryption and storage [OWNER, template from C1]
1. D3: create the KMS key (alias `financial-os-<env>-backups`) with key policy allowing only the worker role (Encrypt/GenerateDataKey) and restore-operator role (Decrypt); key administrators separate from users. Skip if SSE-S3.
2. Create the bucket in `eu-central-1` **with Object Lock enabled at creation** (versioning is enabled with it); Block Public Access on; default retention **GOVERNANCE, 35 days** (D2); default encryption per D3 with bucket key.
3. Bucket policy: deny non-TLS; deny `PutObject` without the chosen encryption; deny `s3:BypassGovernanceRetention`, `s3:DeleteObjectVersion` and `s3:PutObjectRetention` to everyone except the break-glass role; allow worker `PutObject` only on `packages/*` and `ledger-mirror/*`; allow restore-operator `GetObject`/`ListBucket` only.
4. Lifecycle: expire noncurrent versions after 36 days; abort incomplete multipart uploads after 1 day. No rule may shorten locked retention.
- Verify: `aws s3api get-object-lock-configuration` shows Governance/35d; put a 1-byte test object with `--if-none-match "*"` twice (second → 412); a versioned delete of it with a non-break-glass identity → AccessDenied; `get-object-retention` shows the retain-until date.
- Changing the bucket policy, lifecycle, versioning or Object Lock settings later is denied to everyone but the break-glass role (by design, so stack updates touching them fail); the account root user can still remove a bucket policy as the lockout escape.
- Rollback: the bucket cannot lose Object Lock; if configuration is wrong, create a new bucket and leave the old one empty except the test object until it expires. KMS: schedule deletion (7–30 days) only if no object was ever encrypted with it.

### S4 — Network path for the worker [OWNER, template from C1]
1. VPC in `eu-central-1` with one private subnet for Lambda and one public subnet for egress; D5: NAT Gateway with an Elastic IP (or NAT instance with EIP, automatic patching, security group accepting only the Lambda security group).
2. Add the Elastic IP to both Atlas access lists (main cluster and ledger).
- Verify: a test invocation reports its egress IP equals the Elastic IP; Atlas connection from the worker succeeds; from any other IP (except the D8 app path) it is refused.
- Rollback: remove the IP from Atlas lists; delete NAT and release the EIP (both bill hourly).

### S5 — IAM and principals [OWNER, template from C1]
- **Worker role** (Lambda): `s3:PutObject` on the two prefixes; `kms:GenerateDataKey`/`kms:Encrypt` on the backup key (if KMS); `ssm:GetParameter(s)` on `/financial-os/<env>/backup/*` and `/financial-os/<env>/ledger/*` plus `kms:Decrypt` for the SSM key; `cloudwatch:PutMetricData` restricted to namespace `FinancialOS/Backup`; logs. **No** Get/List/Delete on the bucket.
- **Restore-operator role**: `s3:GetObject`, `s3:ListBucket` on the bucket; `kms:Decrypt`; MFA required; assumed only for drills/incidents.
- **Break-glass role**: `s3:BypassGovernanceRetention`, `s3:DeleteObjectVersion`, `s3:PutObjectRetention`; MFA; an EventBridge rule on CloudTrail alerts D9 whenever it is assumed.
- Atlas principals from S1/S2 (`ledger-app`, `ledger-mirror`, `backup-reader`) — nothing broader; the existing application user is unchanged.
- Verify: IAM Access Analyzer shows no external access; policy simulator denies Get/Delete for the worker and Bypass for everyone but break-glass.
- Rollback: delete roles/policies (no data impact).

### S6 — Secrets [OWNER / SECRET]
Create the secrets of §2 in SSM and Vercel as shown; record escrow. Add the ledger key and `LEDGER_MONGODB_URI` to Vercel **only when C5 is deployed**.
- Verify (non-secret): `aws ssm describe-parameters` lists the names with type SecureString; Vercel lists the variable names; escrow copies confirmed by a second person or a sealed-envelope check.
- Rollback: `delete-parameter` / remove Vercel variables; generate new values (no package exists yet).

### S7 — Backup worker [OWNER deploys C1/C2]
1. `npm run workers:build`; zip `.build/backup-worker/index.mjs` as `index.mjs` and upload it to an artifact bucket; deploy the C1 template with `WorkerCodeBucket`/`WorkerCodeKey`. Lambda `nodejs22.x` arm64 (verify still supported), 1024 MB, timeout 10 minutes, **reserved concurrency 1**; `FINANCIAL_OS_CAPTURE_MAX_MS` 240 s (below the 300 s snapshot window).
2. EventBridge Scheduler: D11 schedule in `Asia/Jerusalem`, retry policy (2 retries, 1-hour maximum age), SQS dead-letter queue.
3. Order inside a run: `mirrorLedger` then `captureBackup` (the capture reads the ledger head before its snapshot).
- Verify: manual invoke (this also proves the bundle's dynamic import of the runtime-provided AWS SDK) → one `ledger-mirror/…` and one `packages/…` object, each with Governance retention; manifest `source: snapshot-capture`, `recoveryPoint` present; success metric emitted; duration well under the snapshot window; logs contain no values.
- Rollback: disable the schedule; delete the function (objects stay until retention ends, as designed).

### S8 — Monitoring and alarms [OWNER, template from C1]
- `FinancialOS/Backup` success metric: alarm when **no data for 26 hours** (missing data = breaching) → SNS → D9.
- Lambda `Errors` > 0, dead-letter queue depth > 0, duration > 80 % of timeout → SNS.
- Break-glass assumption and any `DeleteObjectVersion`/`BypassGovernanceRetention` CloudTrail event → SNS.
- Budget alert; Atlas alerts from S1.
- Verify: temporarily disable the schedule → missing-data alarm fires within the window; force an error (wrong parameter name in a test alias) → error alarm; re-enable.
- Rollback: delete alarms/topic.

### S9 — App wiring to the ledger [CLAUDE C5 → OWNER deploys to staging]
- Deploy C5 to staging with ledger configuration present. Full-account erasure stays disabled (separate gate). Set `FINANCIAL_OS_ENVIRONMENT` in **every** Vercel scope; Preview deployments must never use a database that has a ledger. Owner decision (decision sheet §6): require an explicit `ledger disabled` opt-out whenever no ledger is configured — deferred because it would make claims fail on the current staging deployment until the variable is set.
- Verify: a normal claim still works; a synthetic erased subject on the staging ledger is refused (use a throwaway staging account, owner-approved); with the ledger unreachable, claims fail closed with the generic unavailable message.
- Rollback: remove the ledger variables and redeploy the previous revision (claims return to current behavior; no erasures exist yet).

### S10 — First capture [OWNER triggers]
- Invoke the worker manually once, then let the schedule run for 7 consecutive days.
- Verify: 7 packages with increasing recovery points; each opens and verifies in the drill tooling; object sizes plausible; alarms quiet.
- Rollback: disable the schedule; investigate; no data changes in the application.

### S11 — Isolated restore drill (D10 local first) [OWNER runs C6]
1. On an encrypted disk, start a local loopback single-node replica set (as in `DEVELOPER_HANDOFF.md` §8).
2. Assume the restore-operator role in your shell; `aws s3 sync s3://<bucket> <encrypted-dir>`; set `FINANCIAL_OS_ENVIRONMENT`, `RESTORE_TARGET_URI` (loopback), `FINANCIAL_OS_LEDGER_READ_URI`, `FINANCIAL_OS_LEDGER_DATABASE` and the package/ledger keyring variables in that shell only; run `node .build/restore-drill/index.mjs --store <encrypted-dir>`. It checks the mirror, restores the newest package into a fresh target, applies quarantines, runs `releaseFence`, and prints counts, inspector barriers and timings only.
3. Measure: RPO = drill time − package `capturedAt`; RTO = incident declaration → fence passed.
4. Destroy the local data directory; drop the operator session.
- Verify: fence `technicalChecksPassed: true`; barriers reviewed; RTO ≤ 4h; RPO ≤ 24h; record evidence (no data) in `PHASE_18_RECOVERY_IMPLEMENTATION.md`.
- Rollback: nothing external; if the fence fails, record the reason and fix before any further drill.

## 4. What closes A+B (Phase 18 rows 18-10/18-11 evidence)
All stages verified; 7 consecutive daily captures; one successful isolated drill within RPO/RTO; alarms proven by forced failure; secrets escrowed; the break-glass path tested with a test object; documentation updated. Production repeats S1–S11 with production values after staging acceptance. Phase 19 does not start until the whole of Phase 18 is accepted.

## 5. Sources (verified 2026-09-29)
[S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) · [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) · [Vercel Static IPs](https://vercel.com/docs/networking/static-ips) · [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration) · [Vercel cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs) · [MongoDB snapshot read concern](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/) · [Atlas Flex limits](https://www.mongodb.com/docs/atlas/reference/flex-limitations/) · [Atlas free-cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) · [Atlas pause/resume (free clusters paused after 30 days of inactivity)](https://www.mongodb.com/docs/atlas/pause-terminate-cluster/)
