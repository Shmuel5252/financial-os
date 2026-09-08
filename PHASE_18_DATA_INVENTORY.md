# Phase 18 — collection-level recovery and erasure inventory

**2026-09-08; schema inventory only, not a live Atlas inventory or an approved deletion policy.** Base `812b280`; Phase 18 unaccepted. All 52 collection names below are extracted from runtime repository factories, the manual-section map, Auth.js collection options and the offline development utility. A source-inventory regression guards coverage. An external database may contain unknown/legacy collections: enumerate safely before ANY backup exclusion or erase operation; never assume this source list proves remote absence.

Classes: **C** canonical personal/user financial or configuration truth; **D** derived/rebuildable; **I** immutable/history/audit evidence; **A** authentication/provider linkage; **O** operational metadata. Multiple classes are intentional. Financial snapshots are derived but NOT safely rebuildable historical evidence from mutable current inputs. Hashes, masked bank data, actor IDs and digests remain linkable/personal, not automatically anonymous.

Backup/restore codes below are proposed scope, not executed configuration:

- **B:** encrypted consistent backup including BSON types, IDs, versions, references and indexes. Restore only into an isolated target, validate, then apply current deletion/revocation decisions before any release. Do not reconstruct accepted history from current data.
- **R:** rebuild from authorized surviving canonical data after validation; never rebuild before deletion/share revocation is applied.
- **Q:** backup may capture this sensitive/transient state, but quarantine on restore; do not activate/replay it without current consent and explicit recovery policy.
- **E:** ephemeral, not needed as recovery truth; do not resurrect stale leases/counters/secrets. Reset/recreate only under an approved restore runbook, never automatically in this slice.

Erasure implications are decision inputs, **not permission to remove or retain immutable records now**. Existing soft-delete/append-only behavior is unchanged. A future valid full erase must remove ordinary personal data, not just hide it; any audit exception needs a separately approved purpose/fields/duration. No fixed legal period is selected. Approved backup horizon is 30 days; it does not confer permission to keep active personal data for 30 days after erase.

| Collection | Classes | Ownership / sensitive contents | Backup / restore | Full-erasure consequence and current distinction |
| --- | --- | --- | --- | --- |
| `profiles` | C,I | userId, name/timezone/onboarding, embedded audit | B | Remove profile and personal audit fields under policy; not just reset onboarding |
| `accounts` | C,I,A | userId, exact money, manual/provider source, audit | B | Remove user's source and embedded history; bank sync must not recreate after erase; never blanket-delete manual or other-owner accounts |
| `transactions` | C,I,A | userId, amount/date/merchant/account/source/audit | B | Remove and cascade personal references/copies; corrections are separate; ordinary deletion is soft |
| `creditCards` | C,I | userId, card balances/limits and audit | B | Erase personal record/history; references in net worth/reports/goals require handling |
| `recurringExpenses` | C,I | userId, scheduled amounts, labels, audit | B | Erase source and personal retained projections under evidence policy |
| `goals` | C,I | userId, manual reported values and audit | B | Distinct from goalDefinitions/progress; erase cannot stop at the manual row |
| `incomeSources` | C,I | userId, confirmed/uncertain income schedules, audit | B | Erase income and downstream personal evidence under approved policy |
| `loans` | C,I | userId, principal/payment/terms, audit | B | Include debt scenario, report and goal references in erase graph |
| `recurringTransactions` | C,I | userId, recurring terms/account references/audit | B | Remove definitions and derived personal copies; prevent automatic regeneration |
| `safetyMargins` | C,I | userId, amount/percentage and audit | B | Remove configuration and policy-governed historical copies |
| `savings` | C,I | userId, savings values/source audit | B | Remove record and personal downstream historical values under policy |
| `budgetCategories` | C,I | userId, labels and before/after settings audit | B | System key catalogue is code, but per-user rows/labels/audit are personal |
| `budgetPeriods` | C,I | userId, allocations/carry, close snapshot, before/after MONEY audit | B | Neither closed totals nor audit amounts are harmless metadata; policy must address both |
| `budgetCategoryCorrections` | I | userId/actor, transaction reference, reason, old/new category | B | Cannot silently leave personal reasons/references after full erase; immutable ordinary correction history remains intact now |
| `financialSnapshots` | D,I | userId; source_manifest and engine_result kinds, source/version/hash, results/audit | B | Include both kinds; manifests alone cannot reproduce mutated historical source data; no recalc-and-replace restore |
| `goalDefinitions` | C,I | userId, goalId/version, scope/targets/reported baseline | B | All versions and source relationships affected; not just latest definition |
| `goalProgress` | D,I | userId, metric facts/results/milestones/source references | B | Erasure changes retained achievement history; do not relabel old completion or retain personal values silently |
| `goalCommandReceipts` | O,I | userId, payload/key hashes and result IDs | B,Q | Needed for replay safety; decide minimal evidence/suppression on erase, do not replay old commands after restore |
| `purchaseSimulations` | D,I | userId, saved hypothetical inputs/results/source evidence | B | Saved personal scenarios are not regenerable wishes or real transactions; erase independently of source truth |
| `forecastSnapshots` | D,I | userId, confirmed/estimated timelines, provenance/audit | B | Retain exact historical evidence for normal recovery; personal history treatment requires erase policy |
| `forecastScenarios` | D,I | userId, hypothetical inputs/results/forecast reference | B | Never promote restored scenario into confirmed truth; erase all owned copies under policy |
| `debtStrategyScenarios` | D,I | userId, terms/strategy/amounts/note/audit | B | Personal saved what-if evidence; not canonical debt payment, and not safely recreated from current loans |
| `netWorthItems` | C,I | userId, valuations/relationships/embedded audit | B | Ordinary delete is soft; full erase must cover hidden item and personal history |
| `netWorthSnapshots` | D,I | userId, exact historical component values/provenance | B | Not merely cache; contains personal values even after source item removal |
| `transactionIntelligenceRuns` | D,I | userId, merchant groups/signals/transaction IDs/rules/hash | B | New analysis is rebuildable but accepted historical run/review provenance is not; erase personal derived text and IDs |
| `transactionIntelligenceReviews` | I | userId, decisions/run/correction IDs/audit | B | Preserve corrections on normal restore; erase requires handling reviewer evidence and linked financial correction |
| `financialReports` | D,I | userId, scope, closed/restated payload, source references, hiddenAt/audit | B | Hiding is not erasure; shared-source values inside another owner's report require a specific shared-history decision |
| `authorizedSearchDocuments` | D | userId, title/subtitle/searchText/tokens/source IDs | R | Purge personal index copies; rebuild only surviving currently authorized sources; no stale-share resurrection |
| `reportAiSummaries` | D | userId, report/evidence, response/usage, deletedAt | B | Current delete is soft; full erase must remove hidden response/evidence too; future regeneration is not identical history |
| `aiConversations` | D | userId, user-visible messages and cited financial evidence | B | Current owned conversation delete is hard; full erase includes all conversations, not canonical finance |
| `notifications` | D,O,I | userId, source references/condition hashes, delivery state/IDs and audit | B,Q | Restored pending/sending must not resend automatically; erase personal rows and coordinate consent without replay |
| `notificationPreferences` | C,I | userId, consent/quiet hours/embedded audit | B,Q | Current opt-out must supersede backup; erase consent data under policy, never infer renewed opt-in |
| `progressJourneyEvents` | D,I | userId, goal/period source refs, subject label, milestones/supersession | B | History is personal and append-only; erase policy must address values/references, not just hide UI |
| `progressJourneyPreferences` | C,I | userId, visibility/streak/notification consent and audit | B,Q | Restore current opt-outs; erase personal preferences after workflow prevents regeneration |
| `households` | C,I | ownerUserId, name, embedded actor/target/resource audit | B,Q | Owner deletion cannot arbitrarily delete members' individually owned finance; choose dissolution/remaining-history policy |
| `householdMemberships` | A,I | userId/householdId, displayNameSnapshot, membership epochs/audit | B,Q | Membership removal is not personal erase; cover display-name and audit copies, preserve immediate access revocation |
| `householdInvitations` | A,O,I | inviter/accepter IDs, invitee hash/hint, token hash/expiry/audit | B,Q | Hashes/hints remain personal; invalidate outstanding invitations and decide other-member audit minimization |
| `householdResourceShares` | A,I | ownerUserId, resource/household IDs, membership epoch and audit | B,Q | Apply current unshare/leave before restored access; never transfer source ownership or revive old epochs |
| `authUsers` | A,C | _id identity, email/name/image/emailVerified | B,Q | Account erase joins by _id (not userId); prevent session/link access first; auth identity recreation must not revive erased finance |
| `authAccounts` | A | userId, providerAccountId; adapter can store OAuth access/refresh/id tokens | B,Q | Highly sensitive encrypted/restricted backup; future erase removes linkage/tokens; provider revocation is separate, not proof from local deletion |
| `authSessions` | A,O | userId, sessionToken and expiry | Q | Never reactivate backed-up sessions by default; revoke on erase; session token is not a harmless operational ID |
| `authVerificationTokens` | A,O | identifier/token/expiry, adapter collection may be absent with Google-only auth | E,Q | No userId guarantee; handle identifier-bound cleanup; do not resurrect tokens; inventory does not claim rows exist |
| `bankProviderBindings` | A,I | userId, provider subject HMAC, claim/audit | B,Q | Block reimport after erase; key continuity required on restore; do not silently unbind or revoke provider now |
| `bankConnections` | A,O,I | userId, aliases, consent/freshness/status/audit | B,Q | Local status deletion is not remote revocation; verify current consent before enabling restored sync |
| `bankRecordRevisions` | I,A | userId, historical minimized observations including MONEY/merchant/masked identity | B | Not raw token storage but still sensitive financial history; erase policy covers every revision, pending and noncanonical observations too |
| `bankSyncRuns` | O,I,A | userId, counts/status/category/lease/idempotency/audit | B,Q | Historical receipts may explain partial writes; quarantine running leases and do not replay on restore |
| `bankLifecycleCommands` | O,I,A | userId, paid-refresh/disconnect command identity, status/audit | B,Q | Preserve no-replay safety; successful restore never authorizes paid refresh/disconnect; erase evidence exception needs explicit minimal fields |
| `bankAccountReconciliations` | A,I | userId, canonical ID, old/new aliases, masked comparison and actor events | B | Erasing ledger alone breaks mapping; financial history and identity-key plan must be coherent; preserve all normal-history events now |
| `bankDevelopmentMigrations` | O,I,A | userId, retired IDs/aliases, protected-record IDs/digests across collections | B,Q | Prevents reimport of retired test data; hashes may reference other owners. Do not delete without analyzing suppression and mixed-subject consequences |
| `bankDevelopmentArchive` | I,C,A | userId, exact archived BSON financial documents/digests/source IDs | B | Development-only sensitive archive, not anonymous audit or ordinary cloud backup. Erasure policy must include payloads; no copy to staging by default |
| `bankDevelopmentMigrationLocks` | O | offline migration lock/token/time; no general owner field | E,Q | Do not restore as an active migration or steal a lock; offline operator scope only; not a per-user blanket erase target |
| `rateLimits` | O | scope + user hash + time window, count/expiry | E | TTL expires counters; hashes link users, but not financial audit. No canonical history depends on retaining counters |

## Cross-collection consequences requiring owner policy

1. **Audit is not uniformly metadata-only.** budgetPeriods embeds allocation amounts before/after, budgetCategories embeds settings/labels, snapshots/reports/progress contain historical personal values, bank revisions contain financial observations, and archives contain full BSON documents. Retaining these unchanged after full erase would retain ordinary personal finance. Possible direction: erase personal payloads and keep only separately justified minimized deletion/security receipts; this is NOT approved or implemented here.
2. **Shared history is multi-subject.** Reports can contain authorized shared-source evidence; household rows contain other members' IDs/name snapshots/audit. A naive deleteMany({userId}) neither covers these copies nor safely handles other people's records. Owner must decide how to remove one subject's personal contribution while preserving other members' independent truth and explaining historical redaction. No implicit ownership transfer.
3. **Restoring backups must not undo erasure or revocation.** A future protected deletion/suppression mechanism must survive outside the restored historical snapshot and be applied before application access, search rebuild, notification delivery or provider sync. Its minimal identifiers, access and retention need approval; hashing alone is not anonymization. Do not create this ledger now.
4. **Replay/identity safety survives a restore.** Retain ID/version/index/BSON int64 semantics and command receipts while reconciling current consent. Invalidate sessions/tokens/leases in an isolated release workflow. Do not resend emails, refresh Financy, recreate erased users, reimport retired IDs or promote hypothetical evidence. Restore HMAC-compatible identity handling without copying secrets into records or using an auth-key rotation as a data migration.
5. **Full erase vs ordinary deletion:** manual/net-worth soft removal, report hiding, summary soft deletion and immutable correction are intentional existing workflows, NOT full erasure. AI conversation hard deletion already exists. No service currently orchestrates a full cross-collection erase/recovery workflow.

## Recovery acceptance prerequisites (not executed)

Keep approved RPO <=24h, RTO <=4h and 30-day backup history. Inspect real Atlas tier/policy before selecting backup technology. Back up canonical inputs, saved user intent, immutable history, bindings and idempotency evidence consistently; encryption/access control and secret recovery must be separate. A logical JSON export is not an exact BSON backup. Rebuildable search is not sufficient to reconstruct history. Archive verification in Phase 9 was a narrowly scoped migration check, NOT a Phase 18 whole-database restore drill.

An isolated real restore must prove timestamps/recovery point and elapsed recovery time, exact money/currency/types, unchanged retained IDs/versions/provenance/digests, indexes/unique constraints, two-user/current-household isolation, suppression of erased subjects, and no replay of sessions/notifications/provider mutations. Expired backups must age out; do not extend retention or overwrite live staging to make a drill pass. Remote collection enumeration, backup job success, restore result, role/network inspection and retention enforcement remain externally unverified.
