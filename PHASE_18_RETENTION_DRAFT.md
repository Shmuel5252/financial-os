# Phase 18 rows 18-20 / 18-12: retention, access and deletion — DRAFT / NOT ADOPTED

> **DRAFT — NOT ADOPTED — recommendations only.**
>
> - Nothing in this document is an Owner decision, an adopted policy or a commitment, and no code implements it.
> - Current behaviour is described in `PHASE_18_DATA_AND_LOGGING_CLASSIFICATION.md` §2 and `tests/security/data-classification.ts`.
> - Adopting any line below requires an explicit Owner decision.
> - Implementing it (TTL indexes, purge jobs, erasure execution, token stripping, platform settings) is a separately gated item, with its own tests, migration plan and review.

## 1. Principles proposed

1. **Keep canonical financial data only as long as the account exists.** Canonical data is what the user entered, attested or imported. The user's erasure request ends retention, subject to the deletion-ledger protocol (ADR-074/076).
2. **Derived data never outlives its source or its authorization.** This covers snapshots, reports, search index, AI output and notifications. It closes the class behind F-18-14-01, F-18-14-05 and F-18-20-04.
3. **Operational metadata gets the shortest period that still serves its purpose.** Examples: rate limits, runs, commands, locks, receipts.
4. **Secrets the app does not use are not stored.** Secrets the app needs are stored as verifiers where the protocol allows.
5. **Pseudonymized values stay personal data.** They are deleted with the subject, unless they are deletion evidence held under the ledger key.
6. **Logs carry no identifiers or content.** They follow the tested projections. Platform log retention is set explicitly and kept short.

## 2. Recommended retention per class (proposal)

| Data | Collections | Recommendation (not adopted) | Mechanism (proposed) |
| --- | --- | --- | --- |
| Canonical financial records | manual sections (`accounts`, `transactions`, `creditCards`, `recurringExpenses`, `goals`, `incomeSources`, `loans`, `recurringTransactions`, `safetyMargins`, `savings`), `budgetCategories`, `budgetPeriods`, `budgetCategoryCorrections`, `goalDefinitions`, `netWorthItems`, `transactionIntelligenceReviews`, `bankAccountReconciliations` | Kept while the account exists.<br>Soft-deleted rows are hard-deleted 30 days after `deletedAt`.<br>Everything goes on erasure. | Scheduled purge job for soft-deleted rows; executable erasure (18-12) |
| Provider observations | `accounts`/`transactions` (open-banking rows), `bankRecordRevisions`, `bankConnections` | Revisions kept 24 months, then compacted to the current state.<br>Disconnected connections: observations deleted 90 days after disconnect, unless the user keeps the records. | Purge job; erasure |
| Derived financial | `financialSnapshots`, `goalProgress`, `forecastSnapshots`, `forecastScenarios`, `purchaseSimulations`, `debtStrategyScenarios`, `netWorthSnapshots`, `transactionIntelligenceRuns`, `financialReports` | Kept 24 months or until erasure.<br>Copies of labels or notes from a deleted source are removed or blanked with the source. | Purge job keyed on age and source deletion |
| Search index | `authorizedSearchDocuments` | Rebuildable cache.<br>Rows removed when the source or its authorization goes (F-18-14-01).<br>Rows older than 30 days are deleted. | TTL index on `indexedAt` (30 days) + purge on source deletion/access loss |
| AI content | `aiConversations`, `reportAiSummaries` | Conversations: 12 months after the last update, or on user delete.<br>Soft-deleted summaries: hard-deleted after 30 days.<br>Summaries are removed when their report's authorization ends (F-18-14-05). | TTL index on `updatedAt`; purge job |
| Notifications | `notifications`, `notificationPreferences` | Notifications: 12 months; the Resend `providerMessageId` is dropped after delivery is final.<br>Preferences: kept while the account exists. | TTL index on `createdAt` (12 months) |
| Progress | `progressJourneyEvents`, `progressJourneyPreferences` | Events: 24 months; preferences while the account exists. | Purge job |
| Households | `households`, `householdMemberships`, `householdInvitations`, `householdResourceShares` | Ended memberships: `displayNameSnapshot` blanked after 90 days.<br>Expired, revoked or accepted invitations: deleted after 30 days (the e-mail hash and hint go with them).<br>Dissolved households: deleted after 90 days. | Purge job (keeps the "membership rows are never deleted for a living user" invariant from 18-14 I1 until the job is designed around it) |
| Identity | `profiles`, `authUsers`, `authAccounts` | Kept while the account exists.<br>`authAccounts` OAuth tokens are **not stored**: stripped at link time and existing ones purged (F-18-20-02). | Adapter wrapper + one-off purge |
| Sessions | `authSessions`, `authVerificationTokens` | Deleted at expiry. | TTL index on `expires` (expireAfterSeconds 0) (F-18-20-03) |
| Rate limits | `rateLimits` | As today: two windows. | Existing TTL index |
| Bank control | `bankSyncRuns`, `bankLifecycleCommands`, `bankProviderBindings` | Runs and commands: 90 days after completion.<br>Bindings: until disconnect plus erasure. | TTL index on `completedAt`; erasure |
| Idempotency / command receipts | `goalCommandReceipts` and the `*Hash` idempotency fields | 90 days. | TTL index on `createdAt` |
| Deletion ledger | `deletionReceipts`, `deletionLedgerHead`, S3 `ledger-mirror/` and `ledger-journal/` | Kept indefinitely: deletion evidence, pseudonymous under the ledger key.<br>Mirror objects older than the newest N kept for 1 year, then expired; the journal is kept. | Lifecycle rule on `ledger-mirror/` (owner decision on N) |
| Backups | S3 `packages/` | As today: 35-day Object Lock, 36-day expiry. Confirm that this matches the erasure promise (erased users fall out of every package within about 37 days). | Existing lifecycle |
| Offline development | `bankDevelopmentArchive`, `bankDevelopmentMigrations`, `bankDevelopmentMigrationLocks` (deleted in `finally`; a stale lock after a crash is removed by the operator) | Archive deleted 30 days after a verified retirement.<br>`protectedRecords` dropped after retirement (F-18-20-07). | Operator step in the offline runbook |
| Restore targets / operator copies | restore-drill database (incl. `recoveryQuarantine`), local bucket copy | Dropped at the end of every drill; the `--keep` default stays off; the local copy is wiped by `recovery-drill.ps1 -Step cleanup`. | Existing scripts |

## 3. Access roles (proposal)

| Role | Access recommended | Notes |
| --- | --- | --- |
| Application runtime (Vercel) | Read/write on the app database. No ledger write except the ledger app role path. No bucket read. | Already the design |
| Backup worker (Lambda) | Read-only snapshot of the app database and ledger. Create-only writes to the bucket. KMS encrypt. | Already the design |
| Restore operator | Bucket read and a loopback restore target. No production write. | Already the design (S11) |
| Ledger app role | Insert/update on ledger collections only; journal create-only. | Already the design |
| Break-glass | Object Lock bypass and bucket admin; MFA; used only with an Owner record. | Already the design |
| Log readers | Vercel, CloudWatch and Atlas logs readable by the Owner/operator only, with no drains to third parties until classified as sinks. | **Platform evidence needed** |

## 4. Deletion mechanisms (proposal)

1. **TTL indexes.** Use them where retention is purely age-based: sessions, search index, AI conversations, notifications, runs and commands, receipts.
2. **One scheduled purge job.** It is idempotent, reports counts only, and handles:
   - soft-deleted rows,
   - derived data whose source or authorization is gone,
   - membership display-name blanking,
   - invitation cleanup.

   It runs under its own least-privilege role and is tested against the classification (every collection must have a rule).
3. **Executable erasure (18-12).** It uses the existing ledger-first protocol and covers every collection in `dataClassification`, including derived copies and the search index.
4. **Platform settings.** Set explicit Vercel/Atlas/CloudWatch log retention and keep query strings free of user content (F-18-20-01).

## 5. Open questions for the Owner

- **Retention periods:** accept, shorten or lengthen each period above. In particular, the 24-month periods for derived and provider data.
- **Ledger mirror retention:** how many mirror objects to keep.
- **Offboarding:** whether disconnected-bank data is deleted automatically or only on request.
- **Paid tiers:** whether any of this requires paid Atlas backup or log features. No paid resource is assumed here.
