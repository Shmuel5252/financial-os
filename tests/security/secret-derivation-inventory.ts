// Phase 18 row 18-13 (repository portion): what depends on the authentication secret AUTH_SECRET, classified. Enforced by
// tests/unit/secret-derivation-inventory.test.ts against the source (tests/security/secret-derivation-sites.ts, transitive), against
// the 18-07 data classification (every hmac field has a key source) and, empirically, by the rehearsal
// (tests/integration/key-continuity-rehearsal.integration.test.ts), which finds every stored path holding an AUTH_SECRET-derived value.
// Nothing here changes behaviour. The versioned-key design in PHASE_18_KEY_CONTINUITY_DESIGN.md remains DESIGN / NOT ADOPTED.
//
// Categories (Owner requirement 1):
//   auth-session        Auth.js use of the secret (CSRF hash, encrypted OAuth state/PKCE/nonce cookies). Database sessions use random
//                       tokens, so NO persisted value derives from it: safe to change for authentication alone (in-flight sign-ins fail).
//   derive              an HMAC/derivation function or wrapper whose result is derived from the secret.
//   persist             the derived value is stored (collections/fields listed): continuity REQUIRED across backup/restore.
//   lookup              the derived value is recomputed and compared with stored values (binding checks, retired-alias filters,
//                       continuity guards, deletion-ledger anti-resurrection markers): continuity REQUIRED or the lookup silently misses.
//   client-roundtrip    the derived value is sent to the browser and must come back unchanged (review keys/tokens): a secret change
//                       between load and decision invalidates the pending form only.
export type Use = "auth-session" | "derive" | "persist" | "lookup" | "client-roundtrip";
export type DerivationCall = Readonly<{ count: number; uses: readonly Use[]; persisted: readonly string[]; note: string }>;

/** Every syntactic mention of the secret names in src/ and workers/ (`<file>#<function> <how>`). scripts/ mention none. */
export const secretMentions: Readonly<Record<string, { count: number; role: string }>> = {
  "src/lib/config/server-env.ts#<module> key": { count: 1, role: "environment schema: AUTH_SECRET optional, ≥32 chars, not a placeholder" },
  "src/lib/config/server-env.ts#getConfigurationStatus literal": { count: 1, role: "readiness listing of required variable NAMES (no value)" },
  "src/lib/auth/config.ts#createAuthConfig read": { count: 2, role: "auth-session: config.secret = AUTH_SECRET for Auth.js" },
  "src/lib/open-banking/account-identity.ts#bankAlias read": { count: 1, role: "HMAC key of bankAlias" },
  "src/lib/open-banking/open-banking-service.ts#alias read": { count: 1, role: "HMAC key of the service-private alias()" },
};
export const secretScripts: Readonly<Record<string, number>> = {};

/** Every untyped module load (require/createRequire/non-literal import()): an API obtained this way escapes the typed key-API check. */
export const untypedLoads: Readonly<Record<string, { count: number; role: string }>> = {
  "workers/backup/index.ts#load import(name)": { count: 1, role: "backup worker lazy-loads its AWS SDK clients by fixed package names; no crypto key use" },
};

/** Every non-literal or bulk access to an environment object (a way to read AUTH_SECRET without naming it). None reads AUTH_SECRET today. */
export const dynamicEnvAccess: Readonly<Record<string, { count: number; role: string }>> = {
  "src/lib/config/server-env.ts#missingKeys computed-key": { count: 1, role: "readiness: presence check of required variable names" },
  "src/lib/operations/controls.ts#capabilityEnabled computed-key": { count: 1, role: "OPERATIONS_DISABLE_* kill switches (fixed names)" },
  "src/lib/operations/deletion-ledger-runtime.ts#present computed-key": { count: 2, role: "deletion-ledger configuration presence (ledger variable names)" },
  "src/lib/operations/deletion-ledger-runtime.ts#deletionLedgerConfig Object.keys": { count: 1, role: "ledger keyring variables by LEDGER key prefix" },
  "src/lib/operations/deletion-ledger-runtime.ts#deletionLedgerConfig computed-key": { count: 4, role: "ledger URI, database, role ARN, region" },
  "workers/backup/index.ts#env computed-key": { count: 1, role: "worker required-variable helper (backup configuration names)" },
  "workers/ledger-rebuild/cli.ts#required computed-key": { count: 1, role: "worker required-variable helper (ledger names)" },
  "workers/restore-drill/cli.ts#required computed-key": { count: 1, role: "worker required-variable helper (drill names)" },
};

/** Functions whose result is derived from the secret (transitively; found by the scanner, explained here). */
export const derivers: Readonly<Record<string, string>> = {
  "src/lib/auth/config.ts#createAuthConfig": "auth-session: the Auth.js configuration carrying the secret; no persisted derivation",
  "src/lib/open-banking/account-identity.ts#bankAlias": "ROOT: HMAC-SHA256(AUTH_SECRET, `financy:<kind>:<value>`)",
  "src/lib/open-banking/open-banking-service.ts#alias": "ROOT: HMAC-SHA256(AUTH_SECRET, `financy:<kind>:<externalId>`) - byte-identical to bankAlias (OPEN_BANKING_PROVIDER = \"financy\")",
  "src/lib/open-banking/open-banking-service.ts#subjectAlias": "wrapper: alias(\"subject\", OPEN_FINANCE_USER_ID)",
  "src/lib/open-banking/account-identity.ts#minimizeAccountIdentity": "wrapper: SafeAccountIdentity.referenceDigest = bankAlias(\"financy-account-identity-v1\", JSON[providerId, type, currency, normalized account number, bank, branch])",
  "src/lib/adapters/financy/financy-open-banking-provider.ts#normalizeAccount": "provider adapter: every account observation carries identity.referenceDigest (derived at observation time)",
  "src/lib/open-banking/account-reconciliation-service.ts#reviewState": "review rows carry derived row keys, view tokens and live account/connection/institution aliases",
  "src/lib/open-banking/account-reconciliation-service.ts#loadAccountReconciliation": "the review view returned to the browser (row key, reviewToken, candidate keys = account aliases)",
};

const OB = "src/lib/open-banking/open-banking-service.ts";
const RS = "src/lib/open-banking/account-reconciliation-service.ts";
const RR = "src/lib/open-banking/account-reconciliation-repository.ts#AccountReconciliationRepository";
const ID = "src/lib/open-banking/account-identity.ts";
const SOURCE = (alias: string) => ["accounts", "transactions"].map((c) => `${c} source.${alias}`);

/** Every call of a deriver (`<file>#<caller> -> <file>#<deriver>(<first argument>)`), what the value is used for, and where it is stored. */
export const derivationCalls: Readonly<Record<string, DerivationCall>> = {
  "src/lib/auth/config.ts#<module> -> src/lib/auth/config.ts#createAuthConfig()": { count: 1, uses: ["auth-session"], persisted: [], note: "NextAuth(createAuthConfig) at module load" },
  [`${ID}#minimizeAccountIdentity -> ${ID}#bankAlias(ACCOUNT_IDENTITY_VERSION)`]: { count: 1, uses: ["derive"], persisted: [], note: "identity.referenceDigest (stored by the callers below)" },
  [`src/lib/adapters/financy/financy-open-banking-provider.ts#normalizeAccount -> ${ID}#minimizeAccountIdentity(input)`]: { count: 1, uses: ["derive", "persist"],
    persisted: ["bankRecordRevisions account.identity.referenceDigest", "bankRecordRevisions fingerprint", "accounts source.observationFingerprint", "bankAccountReconciliations active.identity.*", "bankAccountReconciliations events[].oldIdentity.identity.*", "bankAccountReconciliations events[].newIdentity.identity.*"],
    note: "observation identity; stored in account revisions and copied into reconciliation ledgers" },
  [`${OB}#subjectAlias -> ${OB}#alias("subject")`]: { count: 1, uses: ["derive"], persisted: [], note: "the configured Financy user's subject alias" },
  [`${OB}#claimConfiguredOpenBankingSubject -> ${OB}#subjectAlias()`]: { count: 4, uses: ["persist", "lookup"], persisted: ["bankProviderBindings subjectAlias"],
    note: "erased-subject guard before and after the claim (deletion-ledger providerSubjects markers are computed from THIS value), claimBinding, compensating releaseBinding" },
  [`${OB}#synchronizeOpenBanking -> ${OB}#subjectAlias()`]: { count: 1, uses: ["lookup"], persisted: [], note: "assertBinding before any provider call" },
  [`${OB}#synchronizeOpenBanking -> ${OB}#alias("connection")`]: { count: 7, uses: ["persist", "lookup"],
    persisted: ["bankConnections connectionAlias", "bankRecordRevisions connectionAlias", "bankRecordRevisions recordAlias", ...SOURCE("connectionAlias"),
      "bankConnections fingerprint", "bankRecordRevisions fingerprint", ...SOURCE("observationFingerprint")],
    note: "retired-alias filters (lookup), connection-continuity guard (lookup), observeConnection/observeAccount/observeTransaction (persist)" },
  [`${OB}#synchronizeOpenBanking -> ${OB}#alias("institution")`]: { count: 2, uses: ["persist", "lookup"], persisted: ["bankConnections providerAlias", "bankRecordRevisions connection.providerAlias", "bankConnections fingerprint", "bankRecordRevisions fingerprint"],
    note: "continuity guard matches previous connections BY institution alias (lookup); observeConnection (persist)" },
  [`${OB}#synchronizeOpenBanking -> ${OB}#alias("account")`]: { count: 2, uses: ["persist"], persisted: ["bankRecordRevisions recordAlias", "bankRecordRevisions accountAlias", "accounts source.recordAlias", "bankRecordRevisions fingerprint", ...SOURCE("observationFingerprint")],
    note: "account observation and canonical account; transactions reference their account alias" },
  [`${OB}#synchronizeOpenBanking -> ${OB}#alias("transaction")`]: { count: 1, uses: ["persist"], persisted: ["bankRecordRevisions recordAlias", "transactions source.recordAlias", "bankRecordRevisions fingerprint", "transactions source.observationFingerprint"],
    note: "HMAC of the provider stableExternalKey" },
  [`${OB}#loadOpenBankingCenter -> ${OB}#subjectAlias()`]: { count: 1, uses: ["lookup"], persisted: [], note: "bindingClaimed = binding with this alias exists" },
  [`${OB}#requestOpenBankingRefresh -> ${OB}#subjectAlias()`]: { count: 1, uses: ["lookup"], persisted: [], note: "assertBinding" },
  [`${OB}#disconnectOpenBankingConnection -> ${OB}#subjectAlias()`]: { count: 1, uses: ["lookup"], persisted: [], note: "assertBinding" },
  [`${OB}#disconnectOpenBankingConnection -> ${OB}#alias("connection")`]: { count: 1, uses: ["lookup"], persisted: [], note: "finds the provider connection whose alias equals the stored connectionAlias" },
  [`${RR}.isRecordedRequest -> ${ID}#bankAlias("account-review-request")`]: { count: 1, uses: ["lookup"], persisted: [], note: "idempotent replay check against events[].requestKey" },
  [`${RR}.isRecordedRequest -> ${ID}#bankAlias("account-review-command")`]: { count: 1, uses: ["lookup"], persisted: [], note: "replayed command must match events[].requestFingerprint" },
  [`${RR}.recordDecision -> ${ID}#bankAlias("account-review-request")`]: { count: 1, uses: ["persist"], persisted: ["bankAccountReconciliations events[].requestKey"], note: "unique index" },
  [`${RR}.recordDecision -> ${ID}#bankAlias("account-review-command")`]: { count: 1, uses: ["persist"], persisted: ["bankAccountReconciliations events[].requestFingerprint"], note: "" },
  [`${RS}#reviewState -> ${ID}#bankAlias("subject")`]: { count: 1, uses: ["lookup"], persisted: [], note: "assertBinding before provider reads" },
  [`${RS}#reviewState -> ${ID}#bankAlias("connection")`]: { count: 2, uses: ["lookup", "persist"],
    persisted: ["bankAccountReconciliations active.connectionAlias", "bankAccountReconciliations events[].oldIdentity.{accountAlias,connectionAlias,institutionAlias}", "bankAccountReconciliations events[].newIdentity.{accountAlias,connectionAlias,institutionAlias}"],
    note: "live connection aliases compared with stored ones; a confirmed decision stores them in the ledger" },
  [`${RS}#reviewState -> ${ID}#bankAlias("institution")`]: { count: 2, uses: ["lookup", "persist"],
    persisted: ["bankAccountReconciliations active.institutionAlias", "bankAccountReconciliations events[].oldIdentity.{accountAlias,connectionAlias,institutionAlias}", "bankAccountReconciliations events[].newIdentity.{accountAlias,connectionAlias,institutionAlias}"],
    note: "legacy accounts are matched to live accounts BY institution alias" },
  [`${RS}#reviewState -> ${ID}#bankAlias("account")`]: { count: 1, uses: ["lookup", "persist", "client-roundtrip"],
    persisted: ["bankAccountReconciliations aliases[]", "bankAccountReconciliations active.accountAlias", "bankAccountReconciliations events[].newIdentity.{accountAlias,connectionAlias,institutionAlias}"],
    note: "candidate key sent to the browser = account alias; confirmed decisions attach it to the canonical account" },
  [`${RS}#reviewState -> ${ID}#bankAlias("account-review-row")`]: { count: 1, uses: ["client-roundtrip"], persisted: [], note: "row key (command.legacyKey); hashed into requestFingerprint only" },
  [`${RS}#reviewState -> ${ID}#bankAlias("account-review-view")`]: { count: 1, uses: ["client-roundtrip"], persisted: [], note: "reviewToken: binds the decision to the evidence the owner saw" },
  [`${RS}#loadAccountReconciliation -> ${RS}#reviewState(actor)`]: { count: 1, uses: ["client-roundtrip"], persisted: [], note: "view rows returned to the browser" },
  [`${RS}#decideAccountReconciliation -> ${ID}#bankAlias("subject")`]: { count: 1, uses: ["lookup"], persisted: [], note: "assertBinding" },
  [`${RS}#decideAccountReconciliation -> ${RS}#reviewState(actor)`]: { count: 1, uses: ["lookup", "persist"], persisted: [], note: "recomputes the rows; the chosen row's key/token must equal the command's (stored values listed under reviewState)" },
  [`src/app/api/open-banking/reconciliation/route.ts#GET -> ${RS}#loadAccountReconciliation(actor)`]: { count: 1, uses: ["client-roundtrip"], persisted: [], note: "JSON response" },
};

/** Every key-using crypto call in src/ and workers/ (HMAC, cipher, KDF, WebCrypto importKey) and its key. Only the two Financy alias roots use AUTH_SECRET. */
export const hmacKeySources: Readonly<Record<string, string>> = {
  "src/lib/open-banking/account-identity.ts#bankAlias createHmac(secret)": "AUTH_SECRET",
  "src/lib/open-banking/open-banking-service.ts#alias createHmac(key)": "AUTH_SECRET",
  "src/lib/open-banking/identity-keyring.ts#identityAlias createHmac(key.material)": "identity keyring prototype (not wired; v1 material = AUTH_SECRET bytes by design)",
  "src/lib/operations/deletion-ledger.ts#mac createHmac(key.material)": "deletion-ledger key (LEDGER keyring, separate from AUTH_SECRET)",
  "src/lib/operations/backup-package.ts#signature createHmac(key.material)": "recovery manifest key (separate)",
  "src/lib/operations/recovery-envelope.ts#encryptRecoveryBson createCipheriv(key.material)": "recovery envelope key (separate)",
  "src/lib/operations/recovery-envelope.ts#decryptRecoveryBson createDecipheriv(key.material)": "recovery envelope key (separate)",
  "src/lib/operations/ledger-mirror.ts#seal createHmac(key.material)": "ledger mirror key (separate)",
  "src/lib/operations/restore-orchestration.ts#stateMac createHmac(key.material)": "deletion-ledger key (restore release state)",
};

/**
 * Key source of every stored field that holds a keyed digest: the 18-07 `hmac` fields, plus fields 18-07 classifies otherwise but
 * which hold AUTH_SECRET-derived values (`classified18_07` records the discrepancy). `AUTH_SECRET:<kinds>` = continuity required.
 */
export type FieldKey = Readonly<{ source: string; classified18_07?: string }>;
const AS = (kinds: string): FieldKey => ({ source: `AUTH_SECRET:${kinds}` });
/** Second-order: an UNKEYED sha256 whose input includes AUTH_SECRET-derived aliases - changes when the secret changes (18-07 transform sha256). */
const SHA = (kinds: string): FieldKey => ({ source: `sha256 over AUTH_SECRET:${kinds}` });
const LEDGER: FieldKey = { source: "ledger-key" };
const NOT_WRITTEN = "(permitted by the type; only manual rows are written to this section today)";
const MANUAL = { "source.connectionAlias": AS(`connection ${NOT_WRITTEN}`), "source.recordAlias": AS(`account|transaction ${NOT_WRITTEN}`),
  "source.observationFingerprint": SHA(`connection|account|transaction ${NOT_WRITTEN}`) };
export const keyedFields: Readonly<Record<string, Readonly<Record<string, FieldKey>>>> = {
  accounts: { "source.connectionAlias": AS("connection"), "source.recordAlias": AS("account"), "source.observationFingerprint": SHA("connection|account|financy-account-identity-v1") },
  transactions: { "source.connectionAlias": AS("connection"), "source.recordAlias": AS("transaction"), "source.observationFingerprint": SHA("connection|account|transaction") },
  creditCards: MANUAL, goals: MANUAL, incomeSources: MANUAL, loans: MANUAL, recurringExpenses: MANUAL, recurringTransactions: MANUAL, safetyMargins: MANUAL, savings: MANUAL,
  bankProviderBindings: { subjectAlias: AS("subject") },
  bankConnections: { connectionAlias: AS("connection"), providerAlias: AS("institution"), fingerprint: SHA("connection|institution") },
  bankRecordRevisions: { recordAlias: AS("account|connection|transaction"), accountAlias: AS("account"), connectionAlias: AS("connection"),
    "connection.providerAlias": AS("institution"), "account.identity.referenceDigest": AS("financy-account-identity-v1"),
    fingerprint: SHA("account|connection|institution|transaction|financy-account-identity-v1") },
  bankAccountReconciliations: {
    "aliases[]": AS("account"), "active.accountAlias": AS("account"), "active.connectionAlias": AS("connection"), "active.institutionAlias": AS("institution"),
    "active.identity.*": AS("financy-account-identity-v1"), "events[].requestKey": AS("account-review-request"), "events[].requestFingerprint": AS("account-review-command"),
    "events[].oldIdentity.{accountAlias,connectionAlias,institutionAlias}": AS("account|connection|institution"), "events[].oldIdentity.identity.*": AS("financy-account-identity-v1"),
    // F-18-13-01 (corrected 2026-10-05): newIdentity was one 18-07 row with transform "raw"; it now mirrors oldIdentity.
    "events[].newIdentity.{accountAlias,connectionAlias,institutionAlias}": AS("account|connection|institution"), "events[].newIdentity.identity.*": AS("financy-account-identity-v1"),
  },
  bankDevelopmentMigrations: { subjectAlias: AS("subject (copied from the binding)"), activeConnectionAlias: AS("connection (copied)"), "oldConnectionAliases[]": AS("connection (copied)"),
    _id: SHA("connection (copied: sha256 of policy, owner and the active connection alias)") },
  // Not AUTH_SECRET: hashes household share provenance aliases, which are themselves unkeyed sha256 of share ids.
  financialReports: { authorizationFingerprint: { source: "sha256 over household share provenance aliases (not AUTH_SECRET)" } },
  deletionReceipts: {
    _id: LEDGER, accepted: LEDGER, current: LEDGER, "current.subject": LEDGER, "accepted.subject": LEDGER, "current.signature": LEDGER, "accepted.signature": LEDGER,
    // Indirect: HMAC(ledger key, AUTH_SECRET-derived subject alias). Matching requires BOTH keys to be unchanged.
    "current.providerSubjects[]": { source: "ledger-key over AUTH_SECRET:subject" }, "accepted.providerSubjects[]": { source: "ledger-key over AUTH_SECRET:subject" },
  },
  recoveryQuarantine: { signature: LEDGER },
};

/** Continuity weaknesses / inventory findings found by 18-13 (reported, not remediated). */
export const keyContinuityFindings: Readonly<Record<string, string>> = {
  "F-18-13-01": "LOW (documentation), CORRECTED: 18-07 classified bankAccountReconciliations events[].newIdentity.* as transform raw although it stores AUTH_SECRET-derived aliases and the account digest; now mirrors oldIdentity (hmac)",
  "F-18-13-02": "HIGH (ownership boundary): after an AUTH_SECRET change a different signed-in account can claim the live provider subject and import its bank data into its own account ([kc-takeover-f-18-13-02])",
  "F-18-13-03": "HIGH, exposure LOW/LATENT (erasure / anti-resurrection boundary): after an AUTH_SECRET change an erased provider subject can be claimed again and its bank data re-imported; the guard checks only the current alias ([kc-resurrection-f-18-13-03])",
};
