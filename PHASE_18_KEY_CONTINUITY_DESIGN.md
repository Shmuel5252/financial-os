# Phase 18 — Financy identity-key continuity design (F)

2026-09-29 (design); 2026-10-05 repository evidence appended below (18-13 PARTIAL; versioned-key design and remediation alternatives DESIGN / NOT ADOPTED; open findings F-18-13-02/03 High). **Design only**, owner-approved as such. No key is provisioned, rotated or copied; no credential, Vercel/Atlas setting or runtime code path changes. The prototype `src/lib/open-banking/identity-keyring.ts` is deliberately unreferenced by runtime code; `tests/unit/identity-keyring.test.ts` proves its properties with synthetic values. Refines the approved direction in `PHASE_18_HARDENING_PACKAGE.md` ("Secret-key separation design") and DECISIONS.md ("Key boundary").

## Problem

Every provider alias is `HMAC-SHA256(AUTH_SECRET, "financy:<kind>:<value>")`, computed in two places (`bankAlias` in `account-identity.ts`, `alias` in `open-banking-service.ts`). Kinds in stored data: `subject`, `connection`, `institution`, `account`, `transaction`, `financy-account-identity-v1` (account reference digest), and reconciliation request/command/row/view keys. Consequences:
- Rotating `AUTH_SECRET` (an authentication secret) silently changes every alias: bindings no longer match, sync reimports under new aliases (duplicate canonical records blocked only by reconnection guards), reconciliation and retired-alias suppression break.
- A restore under a different `AUTH_SECRET` orphans all provider evidence.
- Deletion-receipt provider markers (ADR-076 C3) are keyed on the subject alias, so they inherit the same coupling.

## Design: two separate steps

**Step 1 — decouple (no alias changes).** Introduce a server-only Financy identity keyring `{ activeVersion, keys: [{ version, material }] }`, whose v1 material is a copy of the *current* `AUTH_SECRET` value. The derivation is unchanged, so every stored alias stays byte-identical (proven for every kind by the prototype test). Code then reads the keyring instead of `AUTH_SECRET`; afterwards `AUTH_SECRET` can rotate for authentication purposes alone, without touching provider identity (also proven by test).
- Wiring: replace the two HMAC entry points by one keyring-backed function; `getServerEnv` validates the keyring at startup (fail closed on missing v1 when provider data exists).
- Suggested configuration: `FINANCY_IDENTITY_KEY_V1` (≥32 characters, identical bytes to current `AUTH_SECRET`), `FINANCY_IDENTITY_ACTIVE_VERSION=1`. Names are proposals; values are never logged, compared in reports, or placed in artifacts.
- Owner actions when approved: create the new secret in the platform secret store for each environment (copying the value privately, never through chat/Git), then deploy the wiring. Verification: a bounded bindings/readiness check that the configured subject alias still matches the stored binding, without printing either.

**Step 2 — rotate the identity key itself (only if required, e.g. suspected key exposure).** Aliases are pseudonymization, not authentication; rotation is not routine. If needed:
1. Add v2 to the keyring as active; keep v1 readable.
2. Dual read: every lookup (binding, connection/account/transaction record, retired aliases, reconciliation, deletion markers) resolves `readableAliases` across versions, newest first; writes use v2.
3. Record the alias version with new stored aliases (additive field; absent = v1) so no hash is ever guessed from another.
4. Re-observation migrates naturally: on the next sync, records seen again are linked from their v1 alias to their v2 alias through an immutable alias-link event on the same canonical ID (never a new canonical record). Records never seen again keep v1 aliases permanently.
5. v1 may leave the keyring only when an inventory proves no stored alias, marker or retained backup still depends on it (backup history window plus margin, as for ledger retention).
Raw provider identifiers are deliberately not stored, so old aliases can never be recomputed offline; continuity comes only from re-observation or retaining v1.

## Recovery compatibility

- The keyring is recovered from secret management, never from a backup package; package manifests record key *versions*, never material.
- Restore preflight: compute the configured subject's alias under each readable version and compare with restored bindings (count only). Mismatch is a release barrier (already reported as `unverifiedKeyContinuity` by `inspectBankControlRecovery`).
- Deletion markers: the restore check must test all readable alias versions of a subject (`readableAliases`) before concluding it is not marked.

## Rollback

- Step 1 rollback is safe while `AUTH_SECRET` still equals v1: old and new code derive identical aliases. After `AUTH_SECRET` has been rotated, the pre-decoupling build is no longer a valid rollback target; record this in the deployment rollback register.
- Step 2 rollback: set `activeVersion` back to 1 with v2 still readable (prototype test). Any v2-only records written meanwhile stay resolvable because v2 remains in the keyring; never remove a version that stored data uses.

## Tests

Synthetic (done, prototype): byte-identical v1 derivation for all stored alias kinds; decoupling survives `AUTH_SECRET` rotation; dual-read ordering; premature v1 removal makes legacy aliases unresolvable; rollback reproduces pre-rotation aliases; malformed keyrings fail without reflecting material.
When wiring is approved (planned): real-Mongo sync/reconnect/reconciliation/retired-alias/restore rehearsals under a v1-only keyring and under a v1+v2 dual-read keyring, verifying zero duplicate canonical records, stable idempotency, and restore preflight counts.

## Open owner decisions

1. Approve Step 1 wiring (repository change) and, separately, the private creation of the new secret per environment.
2. Whether Step 2 is ever needed; default: no rotation without an exposure event.

---

# 18-13 repository portion (2026-10-05): inventory, rehearsal, findings

**Status:**
- Row 18-13 remains **PARTIAL**.
- Everything in this part is evidence gathered with synthetic data on local MongoDB.
- No `AUTH_SECRET` was rotated, read, compared or copied from any deployed environment. No runtime, schema, index, adapter, recovery tooling, staging or deployment behaviour changed.
- The versioned-key design above and every remediation alternative below remain **DESIGN / NOT ADOPTED**.
- F-18-13-02 and F-18-13-03 are open; they are not risk-accepted and not remediated.

## 1. Sources of truth and CI enforcement

| Artifact | Role |
|---|---|
| `tests/security/secret-derivation-sites.ts` | Transitive scanner on the TypeScript checker (imports and aliases resolved). It reports: every mention of `AUTH_SECRET` / `AUTH_SECRET_<n>` / `NEXTAUTH_SECRET`; derived functions (value flow into **return values** through returns, locals, `push`/`set`, array-method callbacks, object shorthand); every call of a derived function with its kind; every **key-using crypto call** (`createHmac`, `createCipheriv`/`createDecipheriv`, `hkdf`, `pbkdf2`, `scrypt`, WebCrypto `importKey`), resolved through the checker so a renamed import is still found; and every **non-literal or bulk environment access** (computed key, `Object.keys`/`values`/`entries`, `JSON.stringify`, spread). `scripts/` is checked by text. **Limit:** flows through call *arguments* (e.g. hashing in `fingerprint()`, values handed to repositories) are not followed; stored second-order values are covered by the inventory mapping and by `[kc-secret-differential]` |
| `tests/security/secret-derivation-inventory.ts` | The classified inventory: mentions, derivers, the 28 derivation call sites with uses and stored fields, the key source of every keyed HMAC, the key source of every stored keyed field, and the findings register |
| `tests/unit/secret-derivation-inventory.test.ts` (7 tests, required module) | Fails CI when any of these is new or changed and unclassified: a mention, a dynamic environment access, a deriver, a call site, a key-using crypto call, an 18-07 `hmac` field, or an 18-07 `sha256` field described as hashing aliases or provider observations. It also fails when a stored use has no field, or a derived stored field has no producing call |
| `tests/integration/key-continuity-rehearsal.integration.test.ts` (`[kc-*]`, 8 tests, required ids) | Deterministic local rehearsal: unchanged and changed secret, both open findings, the preflight, reconciliation, an exact-value scan for derived aliases, and **`[kc-secret-differential]`**. The differential runs the same flows (claim, sync, a successful refresh, disconnect; a reconciliation decision) under V1, V1 again and V2 with fixed identities. Every stored leaf that changes with the secret, and not between the two V1 runs, must be inventoried: aliases, embedded copies and second-order digests alike |
| `tests/security/key-continuity-preflight.ts` | Test-only, read-only restore-preflight prototype. Not wired into runtime, scripts or restore tooling |

## 2. Derivation graph

**Coverage boundary (stated):** the rehearsal exercises claim, sync, a successful refresh, disconnect and a `same_account` reconciliation decision. Write paths it does not exercise are covered by the inventory mapping and the 18-07 type-driven classification only:
- `not_same` / `cannot_determine` decisions;
- the development-baseline migration (`bankDevelopmentMigrations`);
- `events[].oldIdentity.identity.*` (the legacy fixture has no identity);
- bank-control recovery;
- the manual sections whose provider fields are permitted by the type but not written.

Use categories:
- **auth-session:** Auth.js use only; nothing persisted derives from it.
- **persist:** the derived value is stored; continuity is required.
- **lookup:** the derived value is recomputed and compared with stored values; continuity is required, or the lookup silently misses.
- **client-roundtrip:** sent to the browser and returned.

```
AUTH_SECRET
├─ src/lib/auth/config.ts createAuthConfig ── Auth.js config.secret ............................ auth-session (CSRF hash, encrypted
│                                                                                                  OAuth state/PKCE/nonce cookies;
│                                                                                                  DB sessions use random tokens)
├─ account-identity.ts bankAlias = HMAC(AUTH_SECRET, "financy:<kind>:<value>")
│   ├─ minimizeAccountIdentity → identity.referenceDigest ("financy-account-identity-v1")
│   │    └─ financy adapter normalizeAccount → every account observation ...................... persist (revisions, reconciliation ledgers)
│   ├─ reconciliation-service reviewState: subject (lookup), connection/institution/account (lookup+persist on decision),
│   │    account-review-row key + account-review-view token .................................... client-roundtrip
│   │    └─ loadAccountReconciliation → GET /api/open-banking/reconciliation ..................... client-roundtrip
│   ├─ reconciliation-repository: account-review-request (persist + idempotency lookup),
│   │    account-review-command fingerprint (persist + replay check)
│   └─ decideAccountReconciliation: subject (lookup) + reviewState (lookup/persist)
└─ open-banking-service.ts alias = HMAC(AUTH_SECRET, "financy:<kind>:<externalId>")   (byte-identical to bankAlias)
    ├─ subjectAlias() ─ claim (persist binding; erased-subject guard lookup), sync/refresh/disconnect/center (lookup)
    ├─ sync: connection (persist + retired filter + continuity guard), institution (persist + continuity guard),
    │        account, transaction (persist)
    └─ disconnect: connection (lookup against stored connectionAlias)
Indirect: deletion ledger providerSubjects[] = HMAC(ledger key, subject alias) ... both keys needed to match (anti-resurrection)
```

The scanner pins:
- 5 mention sites (6 occurrences);
- 8 derivers (2 roots, 2 wrappers, the provider adapter, the auth config, and the two reconciliation functions that return derived keys and tokens);
- 28 distinct call-site keys (41 calls);
- 8 dynamic environment-access sites (none reads `AUTH_SECRET`: readiness, kill switches, ledger configuration, worker helpers);
- 9 key-using crypto calls (7 HMACs and the recovery-envelope cipher pair). Only `bankAlias` and `alias` use `AUTH_SECRET`. The deletion ledger, restore state, recovery manifest and ledger mirror use their own keys, and the identity-keyring prototype is not wired.

## 3. Persisted continuity map: every stored field that needs the same `AUTH_SECRET`

| Collection | Fields (alias kind) |
|---|---|
| `bankProviderBindings` | `subjectAlias` (subject) |
| `bankConnections` | `connectionAlias` (connection), `providerAlias` (institution) |
| `bankRecordRevisions` | `recordAlias` (account/connection/transaction), `accountAlias`, `connectionAlias`, `connection.providerAlias`, `account.identity.referenceDigest` |
| `accounts`, `transactions` | `source.connectionAlias`, `source.recordAlias` |
| `bankAccountReconciliations` | `aliases[]`, `active.*Alias`, `active.identity.*`, `events[].requestKey`, `events[].requestFingerprint`, `events[].oldIdentity.*`, `events[].newIdentity.*` (F-18-13-01) |
| `bankDevelopmentMigrations` | `subjectAlias`, `activeConnectionAlias`, `oldConnectionAliases[]` (copied from stored aliases) |
| 8 other manual sections | `source.connectionAlias` / `source.recordAlias`: permitted by the type, not written today |
| `deletionReceipts` | `current/accepted.providerSubjects[]`: ledger-key HMAC **of** the subject alias (indirect) |

**Second-order values:** unkeyed sha256 digests whose input includes derived aliases. They change when the secret changes (review M1; proven by `[kc-secret-differential]`):

| Collection | Field | Input |
|---|---|---|
| `bankConnections` | `fingerprint` | connection and institution aliases |
| `bankRecordRevisions` | `fingerprint` | the normalised observation, including its aliases and the identity digest |
| `accounts`, `transactions` | `source.observationFingerprint` | the observation, including its aliases |
| 8 other manual sections | `source.observationFingerprint` | permitted by the type, not written today |
| `bankDevelopmentMigrations` | `_id` | sha256 of policy, owner and the active connection alias |

These need no key to stay stable while the secret is unchanged, so a re-sync adds no revision. A future re-keying (rank 3, Step 2) must recompute or tolerate them. Otherwise the first sync after re-keying appends a revision for every record and rewrites every canonical `observationFingerprint`.

**Fields that do not depend on `AUTH_SECRET` (safe to change for authentication alone):**
- Auth.js sessions: random `sessionToken`. In-flight sign-ins fail once.
- Deletion-ledger subject identities and receipt signatures (ledger key).
- Recovery manifests (recovery key) and ledger mirror seals (mirror key).
- Unkeyed `sha256` digests whose inputs contain **no** derived alias: idempotency hashes, report source aliases, search keys, invitation tokens, and household share provenance in `financialReports.authorizationFingerprint`. The second-order digests above are the exception.

**Empirical confirmation:**
- The exact-value scan checks every document of every collection for the known derived values.
- The differential finds exactly 16 secret-dependent stored leaves in the bank flows: the 12 alias paths plus the 4 second-order fingerprints. Refresh and disconnect add none.
- Sync stores derived values at exactly 12 paths.
- Reconciliation stores them at exactly 23 paths, including 4 under `events[].newIdentity`.
- Every path found is inside the inventory.

## 4. Rehearsal results (`[kc-*]`, synthetic, local)

| Test | Result |
|---|---|
| `[kc-unchanged-secret]` | Claim and sync. Re-claim and re-sync add no record (1 binding, 1 connection, 3 revisions, 1 account, 1 transaction). All 12 derived paths stay byte-identical. The keyring prototype with v1 = the same secret reproduces every alias |
| `[kc-changed-secret]` | Under a different secret the owner's binding no longer resolves (`bindingClaimed:false`). Sync, refresh and disconnect fail with `UnauthorizedError`. The owner cannot re-claim (`ConflictError`: one binding per owner). Nothing is written (whole-database fingerprint unchanged). The center still lists only the owner's **own** stored records. Restoring the original secret restores resolution: the data was orphaned, not lost |
| `[kc-reconciliation]` | A v1 decision replays idempotently with no write. Under v2 the review is refused before any provider read, with no write |
| `[kc-takeover-f-18-13-02]` | Under v1 a second account is refused. Under v2, before its claim, the second account sees nothing and writes nothing. Its claim then **succeeds**: the provider subject is bound to the second account under the v2 alias. Its sync imports the subject's bank data into its own account (1 connection, 3 revisions, 1 account, 1 transaction). The owner's v1 copy remains, orphaned |
| `[kc-resurrection-f-18-13-03]` | Local replica set; the real `DeletionReceiptStore` and the real `runLedgerFirstErasure`. Steps: v1 claim and sync, then erasure (receipt `locally-erased`, every bank count 0). A v1 newcomer is **refused** with "erased account" and nothing is written. Under v2 another newcomer **claims** and its sync **re-imports** the erased subject's data. The ledger still marks the v1-derived subject and not the v2 one. The ledger's own subject identity (ledger key) is unaffected |
| `[kc-preflight]` | Read-only (fingerprint unchanged), counts only (no identifier, alias, secret or 24+ hex string). The deployed secret = v1 gives 0 orphaned bindings. The deployed secret = v2 gives 1 orphaned binding with at-risk documents: 1 connection, 3 revisions, 1 account, 1 transaction |
| `[kc-derived-paths]` | The pinned stored-path sets, all inside the inventory |

## 5. Findings

| ID | Severity | Boundary | Finding |
|---|---|---|---|
| F-18-13-01 | Low (documentation) | Classification | 18-07 classified `bankAccountReconciliations.events[].newIdentity.*` as transform `raw` although it stores derived aliases and the account digest. Corrected in the classification in a separately identifiable commit; no runtime effect |
| **F-18-13-02** | **High** | Ownership of a **live** provider subject | After an `AUTH_SECRET` change, another signed-in account can claim the subject and import its bank data into its own account. The owner is locked out (cannot re-claim). Preconditions: a secret change (rotation, or a restore/redeploy with a different value) and a second signed-in account. Sign-in is open (F-18-05-06), and the first claimant wins (F-18-14-02). **No rotation is needed** if two deployments with different `AUTH_SECRET` values share one database, for example a preview or local development pointed at the staging database. The runbook forbids ledgered previews, and deployed configuration was **not** checked here: **Owner confirmation requested**. After a takeover, restoring the original secret does not remove the second account's imported copy |
| **F-18-13-03** | **High**, exposure **Low/Latent** | Erasure / anti-resurrection guarantee | After an `AUTH_SECRET` change, an **erased** subject can be claimed again and its bank data re-imported. The guard checks only the marker of the *current* alias. Today no runtime path in `src/`, `workers/` or `scripts/` invokes full-account erasure or creates receipts, so present exposure is latent |

**Scope of the coupling:** only the Financy/open-banking aliases, plus the deletion-ledger provider-subject markers derived from them. No other persisted, recovery or erasure identity boundary depends on `AUTH_SECRET`, per the transitive inventory and the empirical scan.

## 6. Backup and restore implications

- **Packages contain the aliases, never key material.** Backup packages include every collection in §3 (recovery groups), with the aliases as stored. They are usable only together with the **identical** `AUTH_SECRET` (today's derivation key). Without it, restored data reproduces exactly the `[kc-changed-secret]` state (orphaned bindings, locked owner), with **F-18-13-02 and F-18-13-03 exposure** until the original secret is back.
- **Key material needed at restore time:**
  - `AUTH_SECRET`: identical bytes, for alias continuity;
  - the deletion-ledger keyring: all readable versions, for receipts and markers;
  - the recovery manifest key, for package verification;
  - the mirror key, for ledger rebuild;
  - `OPEN_FINANCE_USER_ID`: the same configured subject, or the subject alias changes as well.
- **Where it comes from:** all of this comes from secret management, never from a package. This row does not change backup contents, restore tooling or secret storage.
- **Preflight prototype:**
  - It can verify the subject alias, the only alias recomputable offline: it counts matching and orphaned bindings per candidate secret, plus the at-risk documents of orphaned owners. Raw provider identifiers are deliberately not stored, so connection, account and transaction aliases cannot be re-verified offline.
  - It does not evaluate ledger markers (that needs the ledger key). **`orphanedBindings: 0` does not clear F-18-13-03.** In exactly the F-18-13-03 state (erased subject, no binding) the preflight looks clean. It now also reports `aliasBearingWithoutBinding` and `deletionReceiptsWithProviderSubjects`; `[kc-resurrection-f-18-13-03]` pins this. It is a design input for a future restore gate, and is **not** wired into `inspectBankControlRecovery` or the drill.

## 7. Remediation alternatives (DESIGN INPUT ONLY, none adopted, ranked)

| Rank | Kind | Alternative | Notes |
|---|---|---|---|
| 1 | **Immediate containment / fail-closed** | Operational rule, recorded for decision: never change `AUTH_SECRET` (and never restore under a different one) while any binding or deletion receipt exists. Run the preflight before any restore release (a clean result does not clear F-18-13-03; see §6). Keep full-account erasure disabled until F-18-13-03 is resolved | No code. Contains both findings only as long as the rule holds. A readiness/startup check refusing claims while a stored binding fails to resolve would be a runtime change |
| 2 | **Narrow fix** | (a) Refuse a claim when the provider already has any binding that does not resolve under the current alias. (b) Make the erased-subject guard refuse when the ledger holds provider-subject markers that cannot be checked under the current alias (temporary marker fallback) | **Depends on an assumption:** at most one legitimate provider subject per deployment (one `OPEN_FINANCE_USER_ID`). This is **not** an accepted invariant. If several legitimate subjects or providers were supported later, (a) would block every legitimate new subject after the first, and (b) would block claims whenever any erased subject exists. Both would then need the subject-identity check from rank 3 |
| 3 | **Durable architecture** | The versioned identity keyring (Step 1: decouple aliases from `AUTH_SECRET` with v1 = the same bytes; Step 2: dual-read), with the binding check and erased-subject check run against **all readable key versions**, plus alias-version fields | Keeps identity stable across authentication-secret rotation and makes both guards version-aware. Works with several subjects. Needs Owner approval, a runtime/schema change (additive alias-version field), backup-adapter and index review, and a secret-store action. Post-S10 only |

## 8. Mutation evidence (temporary probes, all restored and SHA-verified)

**Result:** 24 of 24 effective probes DETECTED. KC13 is undetected by sequential tests because it is a race; it is documented, not counted.

| Probe | Mutation | Detected by |
|---|---|---|
| KC01 | New direct `process.env.AUTH_SECRET` read in another module | Inventory: mentions, derivers |
| KC02 | New exported wrapper returning `alias(...)` | Inventory: derivers, calls |
| KC03 | New derivation call in `loadOpenBankingCenter` | Inventory: calls |
| KC04 | New `createHmac` keyed by `getServerEnv().AUTH_SECRET` in another module | Inventory: mentions, derivers, HMAC keys |
| KC05 | Destructured `const { AUTH_SECRET } = getServerEnv()` | Inventory: mentions, derivers |
| KC06 | Aliased import of `bankAlias` wrapped in another module | Inventory: derivers, calls |
| KC07 | Derived value returned through a local array `push` | Inventory: derivers, calls |
| KC08 | Legacy `NEXTAUTH_SECRET` read | Inventory: mentions |
| KC09 | A script mentions `AUTH_SECRET` | Inventory: scripts |
| KC10 | 18-07 relabels an AUTH_SECRET-derived field `raw` | Inventory: key sources |
| KC11 | Inventory drops a keyed field | Inventory: calls, key sources |
| KC12 | Alias derivation prefix changed | `[kc-unchanged-secret]` |
| KC13 | Pre-claim erased-subject check removed | **Undetected by sequential tests (a race), not equivalent:** without the pre-check, an erased subject's binding is inserted and only released after the post-claim check, and a concurrent sync inside that window could import data. The pre-check is a real protection that sequential tests cannot observe (review L2) |
| KC13b | Erased-subject guard disabled entirely | `[kc-resurrection-f-18-13-03]` |
| KC14 | A claim restriction (stand-in for a future fix) | `[kc-changed-secret]` and the takeover pin: any remediation must update the pinned evidence deliberately |
| KC15 | Preflight leaks an alias | `[kc-preflight]` |
| KC16 | Preflight writes | `[kc-preflight]` (read-only fingerprint) |
| KC17 | A new stored field holding a derived alias | `[kc-unchanged-secret]` / `[kc-derived-paths]` |
| KC18 | `it.skip` on `[kc-takeover-f-18-13-02]`, full enforced run | Required-tests reporter |
| KC19 | Review probe D: a new stored sha256 of the subject alias on the binding | `[kc-secret-differential]` |
| KC20 | Review probe E: subject alias copied into the refresh audit trail | `[kc-secret-differential]` (refresh is exercised) |
| KC21 | Review probe A: computed env key `["AUTH","SECRET"].join("_")` | Inventory: dynamic env access |
| KC22 | Review probe B: `JSON.stringify(getServerEnv())` | Inventory: dynamic env access |
| KC23 | Review probe C: renamed `createHmac` import with a dynamic key | Inventory: key-using crypto calls (resolved through the checker) |
| KC24 | Review probe F: WebCrypto `importKey` with ``process.env[`AUTH_${"SECRET"}`]`` | Inventory: dynamic env access and key-using crypto calls |

## 9. Exact residual work to close 18-13

1. Owner decisions on F-18-13-02 and F-18-13-03: containment rule, narrow fix and/or keyring, with priority alongside F-18-05-01 right after S10 closes.
2. If the keyring is adopted:
   - Step 1 wiring, plus private creation of the v1 key in each environment's secret store;
   - a real-Mongo rehearsal under v1-only and v1+v2 keyrings (sync, reconnect, reconciliation, retired aliases, erasure guard, restore preflight);
   - backup-adapter, index-manifest and restore-compatibility review.
3. A restore gate using the preflight (counts only), wired into the recovery tooling after approval.
4. A deployed confirmation that the staging bindings resolve under the current secret: read-only, counts only, Owner-approved.
5. Owner acceptance of this repository portion.

## 10. Independent adversarial review

### Round 1 (at `07e1bd1`)

**Verdict:** no Blocker or High, and no new security invariant violation. No evidence that deployed exposure is greater than established, though one precondition for F-18-13-02 needs Owner confirmation (see §5). The reviewer confirmed:
- the Auth.js analysis against `@auth/core` and `next-auth`;
- the counts;
- the erasure evidence (real ledger and erasure, v1 still marked);
- rehearsal determinism;
- the preflight is read-only and counts-only;
- the F-18-13-01 correction is classification-only;
- the constraints (tests and docs only).

| Finding | Severity | Resolution (tests/docs only) |
|---|---|---|
| M1: second-order sha256 digests over derived aliases (4 stored fields plus `bankDevelopmentMigrations._id`) were missing from the inventory, and §3 claimed unkeyed digests never depend on the secret | Medium | Inventoried as `sha256 over AUTH_SECRET:<kinds>`. Every 18-07 `sha256` field described as hashing aliases or provider observations now must declare a key source. §3 corrected. `[kc-secret-differential]` added. KC19 is detected |
| M2: write paths covered only by the manual mapping | Medium/Low | Coverage boundary stated in §1. Refresh and disconnect added to the differential. KC20 is detected |
| L1: scanner evasions (computed env key, `JSON.stringify(env)`, renamed `createHmac`, WebCrypto) | Low | Dynamic and bulk environment access is pinned; key-using crypto calls are resolved through the checker (HMAC, cipher, KDF, `importKey`). KC21–KC24 are detected |
| L2: KC13 is a race, not an equivalent mutant | Low | §8 reworded |
| L3: preflight blind spots (clean result in the F-18-13-03 state; `bankDevelopmentMigrations` missing) | Low | `aliasBearingWithoutBinding`, `deletionReceiptsWithProviderSubjects` and `bankDevelopmentMigrations` added. The caveat is in §6 and §7, and is pinned in `[kc-resurrection-f-18-13-03]` |
| Info: shared-database precondition for F-18-13-02; takeover copy persists after restoring the secret; counting wording | Info | §5 and §2 |
| Info: an Auth.js email/magic-link provider would persist `verificationTokens.token = sha256(token + secret)` inside `node_modules`, invisible to the scanner | Info | Prevented today only by the providers-length pin in `tests/unit/mongodb-auth-lifecycle.test.ts`. Adding such a provider must re-open this inventory |
| Info: `events[].*Identity.comparison.maskedNumber` (raw) is inconsistent with `active.comparison.maskedNumber` (truncated) in 18-07 | Info | Pre-existing; not changed here |
