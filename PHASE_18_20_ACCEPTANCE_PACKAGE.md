# Phases 18–20 acceptance package — for independent adversarial review

Prepared 2026-09-29 by the successor Primary Builder. This is a builder self-report, **not** an acceptance decision. It is written so an independent reviewer can reproduce and challenge every claim from the repository alone.

## 1. Verdict

| Phase | Status | Why |
|---|---|---|
| 18 — Security/privacy/operations/recovery hardening | **NOT ACCEPTED — blocked on owner/external gates** | All repository-only recovery work defined by the recovery ledger is complete (47/47 restorable collections have strict reviewed adapters). The remaining acceptance rows need deployed/external evidence or owner policy decisions (§5, §6) that the builder is not authorized to produce or decide. |
| 19 — Persona validation and complete E2E | **NOT STARTED** | Depends on Phase 18 acceptance (MASTER_PLAN / IMPLEMENTATION_PLAN; handoff §9). |
| 20 — Production launch | **NOT STARTED** | Depends on Phases 18–19 acceptance and on production infrastructure, legal/support and rollback decisions. |

No Phase 21+ work was done. No provider call, live/staging change, credential or `.env.local` access, deletion of real data, or infrastructure action occurred.

## 2. Repository state

- Repository: `https://github.com/Shmuel5252/financial-os`, branch `main`. Work was done in a worktree on the handoff HEAD and pushed fast-forward to `origin/main`; each push was followed by fetch and `origin/main == HEAD`, ahead/behind 0/0, clean tree.
- Handoff baseline: `2337bf28d435c2b968e88783a202f372d0f9e1e0`. Commits since (oldest first):

| Commit | Unit |
|---|---|
| `d42a2b8` | test: recovered-index comparisons independent of creation order (pre-existing flaky failure found by the required regression) |
| `046a51e` | AI-history source links (the handed-off WIP) — verified, reviewed, checkpointed; adds `DEVELOPER_HANDOFF.md` |
| `159044e` | Bank control-plane recovery (bindings, connections, sync runs, lifecycle commands) + no-replay fence |
| `e5d30a5` | Bank records/reconciliation recovery + bank-sourced canonical variant; fixes a Phase 9 writer defect |
| `36736c9` | Development-baseline manifests/archive recovery; completes 47/47 |
| (this document) | Phases 18–20 acceptance package |

- `.env.local`: ignored and untracked; never read. Port 3000 service untouched; no dev server was started.
- The original checkout `C:\dev\financial-os` was **not modified**: it still holds the handed-off WIP as uncommitted changes on local `main` at `2337bf2` (the seven files, fingerprints verified at start). That content is now committed upstream (with review follow-ups), so a plain `git pull` there will refuse to overwrite the untracked copies. Reconciling that checkout is an owner action (e.g. after confirming nothing else is pending there, discard those seven WIP files and fast-forward); the builder did not perform it because it is destructive to that working tree.

## 3. Units delivered in this session

Common verification for every unit (commands in §7): focused tests with real local MongoDB (isolated random namespaces, synthetic data), full non-external regression, `typecheck`, zero-warning `lint`, production `build`, `security:check`, `operations:index-check`, `security:audit` (registry), `git diff --check`, an independent read-only review agent, fixes, re-review where findings were Important+, and mutation checks (each guard removed → a test fails; restored file hash verified).

### 3.1 AI-history source links (`046a51e`, with `d42a2b8`)
- Scope: read-only inspector for conversation source references (budget period, engine snapshot, goal progress, purchase simulation) and report-summary fingerprints; owner checked before metadata; `releaseAllowed: false`.
- Review: no Critical/Important. Added budget/purchase foreign-owner cases; removing the owner check fails 4 tests.
- Found by required regression: six older recovery integration tests compared `listIndexes` in creation order (repositories create indexes concurrently) — intermittent failure observed in net-worth. Fixed by order-independent comparison of the identical index definitions; no runtime change.
- Final: 643 tests / 135 files passed, 1 opt-in skip.

### 3.2 Bank control plane (`159044e`)
- Strict adapters mirroring `OpenBankingRepository` for `bankProviderBindings`, `bankConnections`, `bankSyncRuns`, `bankLifecycleCommands`; inspector reports key continuity, consent, interrupted syncs, unknown external outcomes, missing bindings.
- Review Important #1 (fixed): restoring rows as-is blocked same-key replays only while a 120 s lease was fresh; after a real restore the repository would resume an interrupted lease, restart failed/partial syncs and **re-send a failed disconnect**, violating offline-preparation step 5. Fix: `quarantineBankControl` stamps `recoveryQuarantinedAt` on surviving non-completed runs/commands; `OpenBankingRepository.startSync/startLifecycle` refuse, and `finishSync/finishLifecycle` cannot complete, a stamped row under its old key. Completed commands still return recorded outcomes; unstamped Phase 9 behavior unchanged.
- Review Important #2 (fixed): failed commands after a possible provider call (internal/unknown/provider_unavailable/schema, ambiguous 403/409 consent) now count as unknown outcomes.
- Rehearsal: real repository with injected advancing clock through every writer path; package → open → quarantine (9 excluded, 5 fenced) → restore with +1 day clock; same-key refresh/disconnect/sync refused or recorded with zero writes; **unfenced control namespace proves the repository would otherwise restart**.
- Final: 659 tests / 137 files.

### 3.3 Bank records and reconciliation (`e5d30a5`)
- Strict adapters for `bankRecordRevisions`, `bankAccountReconciliations`, and bank-sourced canonical `accounts`/`transactions` (dispatch on source kind under `manual-v2-open-banking-v1`; manual rows unchanged); link inspector fails closed on foreign/manual targets.
- Review **Critical** (fixed): the first version required `source.observedAt == updatedAt`, but the writer takes them from separate `now()` calls, so every production bank row would have been rejected; a frozen test clock hid it. RED reproduced with an advancing clock in the real-service rehearsal, then GREEN.
- **Phase 9 writer defect found and fixed**: `canonicalAccountFields` wrote provider labels up to 120 characters while the account domain limit is 100 — rows the application's own reader rejects. Now cut at 100 and trimmed (re-review caught a trailing-space cut). RED→GREEN with a 110-character label containing a space at index 99. Fingerprints/idempotency unchanged.
- Rehearsal: real service (claim, two syncs with a changed amount) and real `recordDecision` for two owners; whole database packaged; readers accept restored rows; later sync of unchanged data writes nothing.
- Final: 679 tests / 139 files.

### 3.4 Development-baseline manifests and archive (`36736c9`)
- Strict adapters for `bankDevelopmentMigrations` and `bankDevelopmentArchive` (47/47 now asserted by test). Archive payloads are digest-verified, deserialized and checked by the reviewed adapter for their collection; the artifact carries the inspected nested document because the encryption envelope rejects opaque Binary by design, and `materializeBankDevelopmentArchive` restores the exact bytes (digest re-verified; fails closed if not byte-identical).
- Rehearsal: real service data for two owners, real `planDevelopmentBaseline`/`retireDevelopmentBaseline` on an isolated namespace, full package/open/restore; after restore a sync where the provider still lists the retired connection imports nothing from it; **a control restore without the manifest reimports the retired data** and the inspector reports it; the retired manifest demonstrably contains digests of the erased owner's records.
- Review: no Critical. Important fixed: a stored payload that does not re-serialize byte-identically (integral double, reordered integer keys) would have produced a package that could never be opened — now rejected at capture (RED with an integral `Double`, GREEN after); materialization re-verifies bytes. Important recorded as an owner decision rather than loosened: archived rows are immutable and validated by today's adapters, so a row an older writer produced that today's rules reject blocks packaging and cannot be repaired (§4.6).

### 3.4a Final verification on the final code tree (`36736c9`)
- Full non-external regression: **688 tests / 141 files passed**, 1 skipped file (opt-in `phase-nine-reconnection`), six documented external/destructive exclusions unchanged.
- `typecheck` 0, `lint` 0 (zero warnings), `build` 0, `security:check` 468 files / 0 findings, `operations:index-check` 90 source definitions (88 runtime / 2 offline, unchanged), `security:audit` 0 vulnerabilities, `git diff --check` 0.
- Growth over the session: 630 → 688 tests; recovery schema coverage 39/47 → 47/47.

## 4. Open recovery barriers (repository evidence exists; release still blocked)

Every inspector returns `releaseAllowed: false`. These remain unresolved by design and need owner/infrastructure decisions:
1. Independent durable deletion ledger, application write/import/job fencing and final release recheck under a fence (`deletion-receipt-store.ts` states these are not implemented; SoT ties them to an independently provisioned store).
2. Identity-key continuity: provider aliases are HMACs under `AUTH_SECRET`; restore under a different key orphans bindings. Versioned key migration design is pending (no rotation authorized).
3. Consent revalidation before any restored provider activity; operator review of unknown external outcomes.
4. Erased-subject provider reimport blocking (the ledger stores a pseudonymous user subject, not the provider subject) — needs a retention/ledger policy decision.
5. Mixed-subject digests: retired development manifests hold IDs/SHA-256 digests of every other document at planning time, including other owners'. Preserved exactly and counted; keeping or minimizing them is a retention decision.
6. Development archive in staging/production backups: policy says "no copy to staging by default"; the adapter makes inspected inclusion possible but does not decide inclusion.
7. Free-text privacy: the content guard rejects known secret patterns only; it also false-fails text like a merchant named "Bearer …" (kept as a security trade-off).
8. Canonical bank account rows written before `e5d30a5` with 101–120-character names stay invalid for reader and recovery (fingerprints unchanged, so sync never rewrites them); none known outside development; repair needs a normalization bump or owner-approved repair.
9. Packages created before the adapter version changes cannot be opened (none were ever persisted; all packages are synthetic and in-memory).

## 5. Phase 18 acceptance matrix — current status

Wording per `PHASE_18_ENTRY_REVIEW.md` / `PHASE_18_HARDENING_PACKAGE.md`. "R" repository, "O" owner/deployed, "E" external evidence, "P" policy.

| Row | Status after this session | What still closes it (owner/external) |
|---|---|---|
| 18-01 | satisfied at accepted boundaries | — |
| 18-02 | satisfied historically; Gates A/B owner-accepted on 3c370a2 | current release re-check at release time |
| 18-03 | pending E | verify local/preview/staging/production credential and data isolation |
| 18-04 | partially (R/O) | TLS/HSTS/limits/principal review on the platform |
| 18-05 | partially (R) | auth-edge/distributed/deployed limiter evidence; capacity policy |
| 18-06 | partially (R) | nonce/strict CSP rollout + real-browser validation |
| 18-07 | partially (R) | platform/crash/log-access review |
| 18-08 | partially (R) | monitoring/alert delivery with real credentials |
| 18-09 | partially (contract) | real SLO measurement |
| 18-10 | pending E/P | backup storage/vendor, consistent capture, schedule, alerts, retention (owner decision; may need paid tier) |
| 18-11 | R strengthened (47/47 adapters, no-replay/anti-reimport rehearsals) — still pending E/P | real isolated restore with measured RPO/RTO; ledger fence; §4 barriers |
| 18-12 | P gate (ADR-074 direction approved) | complete erase workflow + independent ledger; mixed-subject/archive retention decisions |
| 18-13 | partially | versioned identity-key migration design + isolated rehearsal; no rotation now |
| 18-14 | partially | authorized hosted security/isolation testing; DB/IAM roles |
| 18-15 | partially | on-call contacts, approved live failure/rollback drills |
| 18-16 | partially — dedicated SAST and secret scanning in hosted CI (2026-10-01: CodeQL 0 results, gitleaks 0 findings after triage, actions SHA-pinned) | owner settings: required checks, push protection; external penetration review |
| 18-17 | pending E | approved 10-user/30-minute synthetic staging load |
| 18-18 | partially | deployed keyboard/screen-reader/mobile/RTL matrix |
| 18-19 | partially | audited deployment control changes + rollback drill |
| 18-20 | partially | retention/role policy and tested sinks |
| 18-21 | partially | comprehensive deployed security clearance |
| 18-22 | blocked | all rows closed + operator sign-off |

## 6. Decisions and actions required from the owner

**Status update (later 2026-09-29):** G done — original checkout aligned to `origin/main` after line-level proof and checksum backup (`C:\dev\financial-os-wip-backup-20260929`). C done — ADR-076 (commit `093d2d5`). F designed — `PHASE_18_KEY_CONTINUITY_DESIGN.md` with an unwired prototype and synthetic tests. A+B — B1/A target approved; local build and rehearsals complete (`PHASE_18_BACKUP_LEDGER_PROPOSAL.md` §9–12); provisioning awaits the owner actions listed there. Step-by-step provisioning: `PHASE_18_PROVISIONING_RUNBOOK.md` (not executed); repository items C1–C7 implemented; costs, Flex assessment and app→ledger options: `PHASE_18_PROVISIONING_DECISION_SHEET.md`. D/E deferred. The original list follows.

Presented as options; the builder recommends starting with A–C because they unblock the most rows.
- **A. Backup capture/storage (18-10/11):** choose the logical filtered backup store (managed encrypted object storage in the staging region vs. Atlas paid tier with a reviewed secret-exclusion architecture). Recommendation: filtered logical BSON packages to encrypted object storage, since full Atlas snapshots include auth tokens that the approved boundary forbids. Requires a purchase/setup decision and credentials — owner only.
- **B. Independent deletion ledger + release fence (18-11/12):** approve where the ledger lives (separate project/cluster vs. separate database with a separate principal) so fence/watermark code can be written against it.
- **C. Retention rulings:** mixed-subject digests in development manifests (§4.5), development archive inclusion (§4.6), erased-subject provider reimport blocking (§4.4).
- **D. Scheduled windows:** staging load test (18-17), failure/rollback drills (18-15/19), restarting the incomplete 30-minute cutover observation if desired.
- **E. External reviews:** hosted SAST/required checks, authorized penetration/isolation testing, deployed accessibility/mobile/RTL review.
- **F. Key continuity:** approve designing (not executing) the versioned Financy identity-key migration.
- **G. Local checkout:** reconcile `C:\dev\financial-os` with `origin/main` (§2).

## 7. Reproduction

PowerShell, local synthetic configuration only (never staging/production URIs; tests do not load `.env.local`):

```powershell
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27017'; $env:MONGODB_TEST_DB_NAME='financial_os_integration'
$env:RUN_REAL_ANTHROPIC_TESTS='0'; $env:RUN_REAL_RESEND_TESTS='0'; $env:RUN_REAL_OPEN_FINANCE_TESTS='0'; $env:RUN_REAL_OPEN_FINANCE_RECONNECTION_TESTS='0'
npm ci
npm exec vitest run tests/unit tests/integration -- --maxWorkers=1 --exclude '**/phase-eight-anthropic.integration.test.ts' --exclude '**/phase-sixteen-anthropic.integration.test.ts' --exclude '**/phase-fifteen-resend.integration.test.ts' --exclude '**/phase-nine-financy.integration.test.ts' --exclude '**/phase-nine-identity-evidence.integration.test.ts' --exclude '**/phase-nine-development-cutover.operations.test.ts'
npm run typecheck; npm run lint; npm run build; npm run security:check; npm run operations:index-check; npm run security:audit; git diff --check
```

Focused rehearsals: `tests/integration/{ai-history,bank-control,bank-record,bank-development}-recovery.integration.test.ts`. To challenge a guard, delete it and re-run its unit file (mutation checks listed in `PHASE_18_RECOVERY_IMPLEMENTATION.md`).

## 8. Not verified / limitations of this evidence

- Nothing deployed, staging, real-provider or real-financial was exercised; all recovery evidence is local synthetic MongoDB. A local rehearsal is not RPO/RTO/history achievement.
- The six excluded test files (real Anthropic/Resend/Financy, identity evidence, destructive development cutover) and the opt-in reconnection test were not run.
- Reviews were performed by independent read-only review agents of the same model family; they are not the final adversarial review.
- `security:check` is a bounded secret/private-file guard, not SAST; `security:audit` reflects the registry at run time.
- Build ran without private configuration (the worktree has no `.env.local`); runtime behavior with real configuration was not exercised.
