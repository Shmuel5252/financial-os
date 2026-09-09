# Phase 18 backup secret-content boundary — design, not a backup job

2026-09-08. Supplements PHASE_18_DATA_INVENTORY.md without changing existing retention/immutability. All 52 source collections classified below; remote unknown collections require inspection before inclusion. **No backup or restore performed.**

M = must preserve for meaningful recovery of existing user intent/history, subject to approved deletion. R = rebuild from surviving authorized canonical data. X = exclude from backup payload/recreate safely. F = filtered/minimized representation needed, never raw copy. Token classification is schema-based: free-form user text can contain pasted secrets even when schema has no credential field. Thus "no designated secret" is not a guarantee raw documents contain no secrets. A future exporter needs a versioned allowlist, secret-bearing-field denial and tests; never use model redaction. Unknown fields/collections fail review, not auto-export. No raw provider payloads.

Replay codes: D apply current deletion ledger; H apply current household access/revocation; P reconcile current provider consent/identity, never replay operations; J suppress restored jobs/idempotent command execution; A rebuild authentication without old sessions. These are release barriers, not instructions to perform external revocation during restore.

| Collection | Backup classification | Credential/session material | Restore barrier |
| --- | --- | --- | --- |
| `profiles` | M | No designated secret; private text/audit | D |
| `accounts` | M | Minimized provider identities, not tokens; private text | D,H,P |
| `transactions` | M | Private descriptions/source identity, no designated token | D,H,P |
| `creditCards` | M | Private card metadata; deny raw PAN/CVV if unexpected | D,H |
| `recurringExpenses` | M | No designated secret; private text | D,H |
| `goals` | M | No designated secret; user text/manual evidence | D,H |
| `incomeSources` | M | No designated secret; private text | D,H |
| `loans` | M | No designated secret; private terms/text | D,H |
| `recurringTransactions` | M | No designated secret; private text | D,H,J |
| `safetyMargins` | M | No designated secret | D |
| `savings` | M | No designated secret; private text | D,H |
| `budgetCategories` | M | Labels and embedded personal audit | D |
| `budgetPeriods` | M | Personal allocation/close/audit values | D,H |
| `budgetCategoryCorrections` | M | Personal immutable reason/history | D,H |
| `financialSnapshots` | M | Private source manifests and engine evidence | D,H |
| `goalDefinitions` | M | Personal versioned targets/scope | D,H |
| `goalProgress` | M | Personal immutable metrics/evidence | D,H |
| `goalCommandReceipts` | M | Hashes/references, not bearer credentials | D,J |
| `purchaseSimulations` | M | Saved private hypothetical intent, not rebuildable truth | D,H |
| `forecastSnapshots` | M | Private historical timeline/evidence | D,H |
| `forecastScenarios` | M | Private saved what-if intent | D,H |
| `debtStrategyScenarios` | M | Private saved what-if intent | D,H |
| `netWorthItems` | M | Private valuations/text | D,H |
| `netWorthSnapshots` | M | Immutable personal historical values | D,H |
| `transactionIntelligenceRuns` | M | Private historical signals/merchant text | D,H |
| `transactionIntelligenceReviews` | M | Immutable review/correction evidence | D,H |
| `financialReports` | M | Private/shared historical payloads | D,H |
| `authorizedSearchDocuments` | R | Duplicated personal searchable text | D,H before rebuild |
| `reportAiSummaries` | M | Personal user-visible generated text, not hidden prompts | D,H |
| `aiConversations` | M | Personal conversation text may contain user-pasted secrets | D,H |
| `notifications` | F | Private delivery references; no provider credential intended | D,H,J; never re-send restored pending/sending |
| `notificationPreferences` | M | Consent/audit, no provider key | D,J; latest opt-out wins |
| `progressJourneyEvents` | M | Immutable personal achievement evidence | D,H |
| `progressJourneyPreferences` | M | Personal consent/preferences | D,J |
| `households` | M | Multi-subject personal audit | D,H |
| `householdMemberships` | M | Member identity/name/epochs, not session token | D,H |
| `householdInvitations` | F | Invitation token hashes, personal email hints/hashes | D,H; invalidate pending invitations |
| `householdResourceShares` | M | Resource identity/epochs, not credentials | D,H |
| `authUsers` | M | Personal identity/email/image, no password in current Google-only model | D,A |
| `authAccounts` | F | May contain OAuth access_token, refresh_token, id_token and session_state | D,A; raw copy forbidden |
| `authSessions` | X | Live bearer sessionToken | D,A; never restore sessions |
| `authVerificationTokens` | X | Verification token/identifier | D,A; never restore tokens |
| `bankProviderBindings` | M | HMAC subject alias, not provider password/token | D,P |
| `bankConnections` | M | Minimized aliases/consent/history, not access token | D,P,J |
| `bankRecordRevisions` | M | Minimized but private historical bank observations | D,H,P |
| `bankSyncRuns` | F | Command metadata/lease, not provider credentials | D,P,J; quarantine running state |
| `bankLifecycleCommands` | F | Paid/disconnect receipts, no provider token intended | D,P,J; never replay paid/remote actions |
| `bankAccountReconciliations` | M | Masked/hashed personal identities and audit | D,P |
| `bankDevelopmentMigrations` | M | Historical suppression IDs/digests, not credentials | D,P,J |
| `bankDevelopmentArchive` | F | Arbitrary historical BSON payload may embed unexpected sensitive fields | D,H,P; inspect nested payloads, never opaque-copy into staging backup |
| `bankDevelopmentMigrationLocks` | X | Offline lock token | J; never restore active lock |
| `rateLimits` | R | Linkable actor hash/counter, no credential | D; recreate TTL index/counters, not historical allowances |

## Authentication recovery without secret artifacts

Keep authUsers IDs unchanged. Export authAccounts only through an explicit field allowlist such as `_id`, `userId`, `provider`, `providerAccountId`, `type` after validating existing supported model; reject/omit OAuth credentials and unrecognized fields. Provider subject IDs remain sensitive personal linkage, not public metadata. Preserve enough verified account-to-user mapping to avoid duplicate users or silently attaching finances by email. Verify fresh Google login restores the same canonical user ID; do not enable dangerous email account linking as a shortcut. Account-link recovery behavior needs a real isolated auth acceptance gate before this strategy is approved for backup execution.

Exclude authSessions/authVerificationTokens entirely, recreate empty collections/indexes as applicable and require fresh sign-in. Operational readiness must never export these records. No existing auth adapter or stored token behavior is changed by this slice.

A whole-cluster Atlas snapshot includes secret-bearing auth records currently sharing the database. It cannot satisfy strict no-secret-artifact policy merely because encrypted. Managed backups require a reviewed upstream secret-storage/exclusion architecture first, or a separately approved change of requirement; no such requirement change is inferred. A filtered logical BSON backup can implement the above boundary but must solve cross-collection consistency and preserve exact BSON numeric types/index definitions. No full raw dump is declared safe.

All infrastructure keys/URIs/AUTH_SECRET/provider passwords and the future versioned Financy identity keys must be recovered through a separately controlled secret-management process, never packaged in the data backup, manifest, logs, scripts, or chat. Current AUTH_SECRET/Financy HMAC coupling remains unchanged; filtering it from artifacts does not remove the need for compatible key recovery. Key rotation remains separately gated.

## Privacy / audit release barrier

Immutable during normal operation does not mean retain forever after erasure. Apply current deletion/suppression ledger from an independently durable source before enabling reads, search rebuild, shares, jobs or provider sync. If ledger unavailable/stale, fail closed. Preserve retained financial/audit facts exactly; perform owner-approved privacy redaction only under a separately approved policy, never silently recompute history. Current pending shared-report/household erasure policy remains unresolved. No backup existence or restore test is claimed by this inventory.
