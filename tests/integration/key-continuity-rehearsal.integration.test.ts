import { createHash, randomUUID } from "node:crypto";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { money } from "@/lib/domain/money/money";
import { ConflictError, UnauthorizedError } from "@/lib/errors/application-error";
import { bankAlias, minimizeAccountIdentity } from "@/lib/open-banking/account-identity";
import type { AccountReconciliationCommand, AccountReconciliationView } from "@/lib/open-banking/account-reconciliation";
import { AccountReconciliationRepository } from "@/lib/open-banking/account-reconciliation-repository";
import { decideAccountReconciliation, loadAccountReconciliation } from "@/lib/open-banking/account-reconciliation-service";
import { identityAlias } from "@/lib/open-banking/identity-keyring";
import { openBankingRepositoryForDatabase, type OpenBankingRepository } from "@/lib/open-banking/open-banking-repository";
import type { OpenBankingAccountObservation, OpenBankingConnectionObservation, OpenBankingProvider, OpenBankingTransactionObservation } from "@/lib/open-banking/open-banking-provider";
import { claimConfiguredOpenBankingSubject, disconnectOpenBankingConnection, loadOpenBankingCenter, requestOpenBankingRefresh, synchronizeOpenBanking } from "@/lib/open-banking/open-banking-service";
import { DeletionReceiptStore, type DeletionLedgerRow } from "@/lib/operations/deletion-receipt-store";
import { runLedgerFirstErasure } from "@/lib/operations/erasure-protocol";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { profileRepositoryForDatabase, type UserProfileRepository } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { keyContinuityPreflight } from "../security/key-continuity-preflight";
import { keyedFields } from "../security/secret-derivation-inventory";

// Phase 18 row 18-13: deterministic key-continuity rehearsal on LOCAL MongoDB with SYNTHETIC data and a fixture provider (no network,
// no staging, no real secret: V1/V2 below are rehearsal-only strings). It pins CURRENT behaviour, including two open High findings:
// F-18-13-02 (takeover of a live provider subject after an AUTH_SECRET change) and F-18-13-03 (re-import of an ERASED provider subject
// after an AUTH_SECRET change). These tests document the vulnerable behaviour; a future remediation must change them deliberately.
const uri = process.env.MONGODB_TEST_URI;
const replicaUri = process.env.MONGODB_TEST_REPLICA_URI;
const V1 = "rehearsal-only-secret-v1-synthetic-32-characters-min";
const V2 = "rehearsal-only-secret-v2-synthetic-32-characters-min";
const SUBJECT = "rehearsal-provider-user";
const BANK = "raw-bank-1"; const CONNECTION = "raw-conn-1"; const ACCOUNT = "raw-acct-1"; const STABLE = "raw-stable-1"; const NUMBER = "1234567890";
const NOW = new Date("2026-09-03T10:00:00.000Z");
const k = (material: string) => ({ activeVersion: 1, keys: [{ version: 1, material }] });
const identityOf = () => minimizeAccountIdentity({ accountNumber: NUMBER, providerId: BANK, accountType: "CHECKING", currency: "ILS" });
const profileOf = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" } as const;

class FixtureProvider implements OpenBankingProvider {
  async listConnections(): Promise<OpenBankingConnectionObservation[]> {
    return [{ expiryDate: "2026-12-01", externalId: CONNECTION, lastFetchedAt: "2026-09-03T08:00:00.000Z", lastFetchedDataDate: "2026-09-03", mode: "PSD2",
      providerExternalId: BANK, status: "ACTIVE", subjectExternalId: SUBJECT }];
  }
  async listAccountsPage(): Promise<{ items: OpenBankingAccountObservation[]; nextCursor: string | null }> {
    // As the real adapter (normalizeAccount): the identity digest is derived with the secret current at observation time.
    return { items: [{ accountType: "CHECKING", balances: [{ amount: money(500_00n, "ILS"), creditLimitIncluded: false, referenceDate: "2026-09-03", type: "interimAvailable" }],
      connectionExternalId: CONNECTION, currency: "ILS", displayName: "Synthetic checking", externalId: ACCOUNT, isDuplicate: false, providerExternalId: BANK, identity: identityOf() }], nextCursor: null };
  }
  async listTransactionsPage(): Promise<{ items: OpenBankingTransactionObservation[]; nextCursor: string | null }> {
    return { items: [{ accountExternalId: ACCOUNT, amount: money(-120_00n, "ILS"), bookingDate: "2026-09-02", categoryMain: "shopping", categorySub: "retail", changedCategoryMain: null,
      changedCategorySub: null, connectionExternalId: CONNECTION, externalId: "raw-tx-1", installmentNumber: null, installmentTotal: null, isDuplicate: false, merchantName: "Synthetic shop",
      originalAmount: null, providerExternalId: BANK, stableExternalKey: STABLE, status: "BOOKED", transactionDate: "2026-09-02", type: "CHECKING", valueDate: "2026-09-02" } as OpenBankingTransactionObservation], nextCursor: null };
  }
  async refreshConnections() { return { costCredits: 20, status: "accepted" as const }; }
  async deleteConnection() {}
}

/** Digest of every document in every collection: equal before/after proves "no write". */
async function fingerprint(db: Db): Promise<string> {
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  const parts = await Promise.all(names.map(async (name) => [name, BSON.EJSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray())]));
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
const counts = async (db: Db, owner?: Actor) => Object.fromEntries(await Promise.all(["bankProviderBindings", "bankConnections", "bankRecordRevisions", "accounts", "transactions"]
  .map(async (name) => [name, await db.collection(name).countDocuments(owner ? { userId: new ObjectId(owner.userId) } : {})] as const)));
const FULL = { bankProviderBindings: 1, bankConnections: 1, bankRecordRevisions: 3, accounts: 1, transactions: 1 };
const NONE = { bankProviderBindings: 0, bankConnections: 0, bankRecordRevisions: 0, accounts: 0, transactions: 0 };

/** Every stored path (array indices collapsed to []) whose string value is one of the AUTH_SECRET-derived values. */
async function derivedPaths(db: Db, values: ReadonlySet<string>): Promise<string[]> {
  const found = new Set<string>();
  for (const { name } of await db.listCollections().toArray()) {
    for (const document of await db.collection(name).find({}).toArray()) {
      const walk = (value: unknown, path: string): void => {
        if (typeof value === "string" && values.has(value)) found.add(`${name} ${path}`);
        else if (Array.isArray(value)) value.forEach((item) => walk(item, `${path}[]`));
        else if (value !== null && typeof value === "object" && !(value instanceof ObjectId) && !(value instanceof Date) && !(value instanceof BSON.Long)) {
          for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
        }
      };
      walk(document, "");
    }
  }
  return [...found].sort();
}
/** Does a concrete stored path fall under an inventory keyed-field pattern whose key source is AUTH_SECRET? */
function inventoried(found: string): boolean {
  const [collection, path] = found.split(" ") as [string, string];
  return Object.entries(keyedFields[collection] ?? {}).some(([pattern, key]) => /^(sha256 over )?AUTH_SECRET:/.test(key.source)
    && new RegExp(`^${pattern.replace(/[.[\]]/g, (c) => `\\${c}`).replace(/\\\.\*$/, "\\..+").replace(/\{([^}]+)\}/g, (_m, list: string) => `(${list.split(",").join("|")})`)}$`).test(path));
}
const syncValues = (secret: string) => new Set([identityAlias(k(secret), "subject", SUBJECT), identityAlias(k(secret), "connection", CONNECTION),
  identityAlias(k(secret), "institution", BANK), identityAlias(k(secret), "account", ACCOUNT), identityAlias(k(secret), "transaction", STABLE)]);

/** A fresh synthetic database with the owner signed up under V1 (not yet claimed). */
async function scenario(databaseUri: string, ownerId?: string) {
  vi.stubEnv("AUTH_SECRET", V1);
  const client = await new MongoClient(databaseUri, { promoteLongs: false }).connect();
  const db = client.db(`keycontinuity_${randomUUID().replaceAll("-", "")}`);
  const repository: OpenBankingRepository = openBankingRepositoryForDatabase(db, () => NOW);
  const profiles: UserProfileRepository = profileRepositoryForDatabase(db);
  await Promise.all([repository.ensureIndexes(), profiles.ensureIndexes()]);
  const actor = async (id: string = new ObjectId().toHexString()): Promise<Actor> => {
    const created: Actor = { kind: "user", userId: id };
    await saveProfile(created, profileOf, { repository: profiles });
    return created;
  };
  const deps = () => ({ now: () => NOW, profileRepository: profiles, provider: new FixtureProvider(), repository, erasedProviderSubject: async () => false });
  const owner = await actor(ownerId);
  return { db, actor, owner, deps, dispose: async () => { vi.stubEnv("AUTH_SECRET", V1); await db.dropDatabase(); await client.close(); } };
}
const env = () => { vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("OPEN_FINANCE_USER_ID", SUBJECT); vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "rehearsal-client"); vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "rehearsal-client-secret"); };

/** Legacy account on a terminated connection, a new connection with one candidate, and one confirmed same-account decision under V1. */
async function reconciliation(db: Db, fixed?: Readonly<{ actorId: string; idempotencyKey: string }>) {
  const banking = openBankingRepositoryForDatabase(db); const repository = new AccountReconciliationRepository(db);
  await banking.ensureIndexes(); await repository.ensureIndexes();
  const actor: Actor = { kind: "user", userId: fixed?.actorId ?? new ObjectId().toHexString() };
  const base = { expiryDate: "2026-12-01", lastFetchedAt: "2026-09-06T08:00:00.000Z", lastFetchedDataDate: "2026-09-06", mode: "PSD2", providerExternalId: BANK, subjectExternalId: SUBJECT };
  const newAccount: OpenBankingAccountObservation = { accountType: "CHECKING", balances: [{ amount: money(1_00n, "ILS"), creditLimitIncluded: false, type: "closingBooked", referenceDate: "2026-09-06" }],
    connectionExternalId: "new-conn", currency: "ILS", displayName: "Synthetic", externalId: "new-acct", isDuplicate: false, providerExternalId: BANK, identity: identityOf() };
  const provider = {
    listConnections: vi.fn(async () => [{ ...base, externalId: "old-conn", status: "TERMINATED_BY_USER" }, { ...base, externalId: "new-conn", status: "ACTIVE" }]),
    listAccountsPage: vi.fn(async () => ({ items: [newAccount], nextCursor: null })),
    listTransactionsPage: vi.fn(async () => { throw new Error("not used"); }), refreshConnections: vi.fn(async () => { throw new Error("not used"); }),
    deleteConnection: vi.fn(async () => { throw new Error("not used"); }),
  };
  await banking.claimBinding(actor, bankAlias("subject", SUBJECT));
  await banking.observeConnection(actor, { ...base, externalId: "old-conn", status: "DISCONNECTED" }, { connection: bankAlias("connection", "old-conn"), provider: bankAlias("institution", BANK) }, "rec-connection");
  const { identity: _unused, ...legacy } = newAccount; void _unused;
  await banking.observeAccount(actor, { ...legacy, connectionExternalId: "old-conn", externalId: "old-acct" },
    { account: bankAlias("account", "old-acct"), connection: bankAlias("connection", "old-conn") }, "rec-account", { name: "Synthetic", balance: money(1_00n, "ILS"), type: "bank" });
  const deps = { repository, bankingRepository: banking, provider: provider as unknown as OpenBankingProvider };
  const view: AccountReconciliationView = await loadAccountReconciliation(actor, deps);
  const row = view.rows[0]!;
  const command: AccountReconciliationCommand = { legacyKey: row.key, candidateKey: row.candidates[0]!.key, reviewToken: row.reviewToken, decision: "same_account", confirmation: true, idempotencyKey: fixed?.idempotencyKey ?? randomUUID() };
  await decideAccountReconciliation(actor, command, deps);
  const kv = k(V1);
  const values = new Set([identityAlias(kv, "subject", SUBJECT), identityAlias(kv, "connection", "old-conn"), identityAlias(kv, "connection", "new-conn"),
    identityAlias(kv, "institution", BANK), identityAlias(kv, "account", "old-acct"), identityAlias(kv, "account", "new-acct"), identityOf().referenceDigest!,
    identityAlias(kv, "account-review-request", command.idempotencyKey), identityAlias(kv, "account-review-command", JSON.stringify(command))]);
  return { actor, deps, provider, values, replay: () => decideAccountReconciliation(actor, command, deps) };
}

(uri ? describe : describe.skip)("18-13 key-continuity rehearsal: bank flows (local MongoDB, synthetic)", () => {
  beforeAll(env);
  afterAll(() => { vi.unstubAllEnvs(); });

  it("[kc-unchanged-secret] with the secret unchanged every stored alias stays byte-identical, re-claim and re-sync add nothing, and the keyring prototype v1 reproduces the aliases", async () => {
    const s = await scenario(uri!);
    try {
      await claimConfiguredOpenBankingSubject(s.owner, s.deps());
      expect((await synchronizeOpenBanking(s.owner, randomUUID(), s.deps())).status).toBe("completed");
      expect(await counts(s.db)).toEqual(FULL);
      const values = new Set([...syncValues(V1), identityOf().referenceDigest!]); // computed with the prototype keyring (v1 = the same secret)
      const paths = await derivedPaths(s.db, values);
      expect(paths.length).toBe(12); // every derived field was found with the prototype's bytes
      await claimConfiguredOpenBankingSubject(s.owner, s.deps());
      expect((await synchronizeOpenBanking(s.owner, randomUUID(), s.deps())).status).toBe("completed");
      expect(await counts(s.db)).toEqual(FULL);
      expect(await derivedPaths(s.db, values)).toEqual(paths);
      expect((await loadOpenBankingCenter(s.owner, s.deps())).bindingClaimed).toBe(true);
      expect(identityAlias(k(V1), "subject", SUBJECT)).toBe(bankAlias("subject", SUBJECT));
    } finally { await s.dispose(); }
  }, 60_000);

  it("[kc-derived-paths] every stored path holding an AUTH_SECRET-derived value is in the inventory (sync and reconciliation), and the path sets are pinned", async () => {
    const s = await scenario(uri!);
    try {
      await claimConfiguredOpenBankingSubject(s.owner, s.deps());
      await synchronizeOpenBanking(s.owner, randomUUID(), s.deps());
      const sync = await derivedPaths(s.db, new Set([...syncValues(V1), identityOf().referenceDigest!]));
      expect(sync).toEqual([
        "accounts source.connectionAlias", "accounts source.recordAlias", "bankConnections connectionAlias", "bankConnections providerAlias",
        "bankProviderBindings subjectAlias", "bankRecordRevisions account.identity.referenceDigest", "bankRecordRevisions accountAlias",
        "bankRecordRevisions connection.providerAlias", "bankRecordRevisions connectionAlias", "bankRecordRevisions recordAlias",
        "transactions source.connectionAlias", "transactions source.recordAlias",
      ]);
      for (const path of sync) expect(inventoried(path), path).toBe(true);
    } finally { await s.dispose(); }
    const client = await new MongoClient(uri!, { promoteLongs: false }).connect();
    const db = client.db(`keycontinuity_rec_${randomUUID().replaceAll("-", "")}`);
    try {
      vi.stubEnv("AUTH_SECRET", V1);
      const r = await reconciliation(db);
      const found = await derivedPaths(db, r.values);
      expect(found).toEqual([
        "accounts source.connectionAlias", "accounts source.recordAlias",
        "bankAccountReconciliations active.accountAlias", "bankAccountReconciliations active.connectionAlias", "bankAccountReconciliations active.identity.referenceDigest",
        "bankAccountReconciliations active.institutionAlias", "bankAccountReconciliations aliases[]",
        "bankAccountReconciliations events[].newIdentity.accountAlias", "bankAccountReconciliations events[].newIdentity.connectionAlias",
        "bankAccountReconciliations events[].newIdentity.identity.referenceDigest", "bankAccountReconciliations events[].newIdentity.institutionAlias",
        "bankAccountReconciliations events[].oldIdentity.accountAlias", "bankAccountReconciliations events[].oldIdentity.connectionAlias",
        "bankAccountReconciliations events[].oldIdentity.institutionAlias", "bankAccountReconciliations events[].requestFingerprint",
        "bankAccountReconciliations events[].requestKey", "bankConnections connectionAlias", "bankConnections providerAlias", "bankProviderBindings subjectAlias",
        "bankRecordRevisions accountAlias", "bankRecordRevisions connection.providerAlias", "bankRecordRevisions connectionAlias", "bankRecordRevisions recordAlias",
      ]);
      expect(found.filter((path) => path.includes("newIdentity")).length, "F-18-13-01: newIdentity holds derived values").toBeGreaterThan(0);
      for (const path of found) expect(inventoried(path), path).toBe(true);
    } finally { await db.dropDatabase(); await client.close(); }
  }, 60_000);

  it("[kc-changed-secret] after an AUTH_SECRET change the owner's binding no longer resolves: bank actions are refused with no write, the owner cannot re-claim, and the data is orphaned (restorable by the original secret)", async () => {
    const s = await scenario(uri!);
    try {
      await claimConfiguredOpenBankingSubject(s.owner, s.deps());
      await synchronizeOpenBanking(s.owner, randomUUID(), s.deps());
      const before = await fingerprint(s.db);
      vi.stubEnv("AUTH_SECRET", V2);
      // The binding no longer resolves; the center still lists the owner's OWN stored records (read by owner id), never anyone else's.
      const center = await loadOpenBankingCenter(s.owner, s.deps());
      expect(center.bindingClaimed).toBe(false);
      expect([center.accounts.length, center.connections.length]).toEqual([1, 1]);
      await expect(synchronizeOpenBanking(s.owner, randomUUID(), s.deps())).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(requestOpenBankingRefresh(s.owner, randomUUID(), s.deps())).rejects.toBeInstanceOf(UnauthorizedError);
      const connection = (await s.db.collection("bankConnections").findOne({}))!;
      await expect(disconnectOpenBankingConnection(s.owner, connection._id.toHexString(), connection.version as number, randomUUID(), s.deps())).rejects.toBeInstanceOf(UnauthorizedError);
      // The owner already holds a (now unresolvable) binding: one binding per owner per provider.
      await expect(claimConfiguredOpenBankingSubject(s.owner, s.deps())).rejects.toBeInstanceOf(ConflictError);
      expect(await fingerprint(s.db), "refusals write nothing").toBe(before);
      expect(await counts(s.db, s.owner)).toEqual(FULL);
      vi.stubEnv("AUTH_SECRET", V1);
      expect((await loadOpenBankingCenter(s.owner, s.deps())).bindingClaimed).toBe(true);
    } finally { await s.dispose(); }
  }, 60_000);

  it("[kc-takeover-f-18-13-02] OPEN HIGH FINDING: after an AUTH_SECRET change a different signed-in account can claim the same live provider subject and import its bank data into its own account", async () => {
    const s = await scenario(uri!);
    try {
      await claimConfiguredOpenBankingSubject(s.owner, s.deps());
      await synchronizeOpenBanking(s.owner, randomUUID(), s.deps());
      const other = await s.actor();
      await expect(claimConfiguredOpenBankingSubject(other, s.deps())).rejects.toBeInstanceOf(UnauthorizedError); // unchanged secret: refused
      vi.stubEnv("AUTH_SECRET", V2);
      // BEFORE the competing claim: no disclosure to and no write for the other account.
      const before = await fingerprint(s.db);
      expect(await loadOpenBankingCenter(other, s.deps())).toMatchObject({ bindingClaimed: false, accounts: [], connections: [] });
      await expect(synchronizeOpenBanking(other, randomUUID(), s.deps())).rejects.toBeInstanceOf(UnauthorizedError);
      expect(await fingerprint(s.db)).toBe(before);
      expect(await counts(s.db, other)).toEqual(NONE);
      // The competing claim succeeds: the provider subject becomes bound to the OTHER account ...
      await claimConfiguredOpenBankingSubject(other, s.deps());
      const bindings = await s.db.collection("bankProviderBindings").find({}).toArray();
      expect(bindings.map((b) => b.userId.toHexString()).sort()).toEqual([s.owner.userId, other.userId].sort());
      expect(bindings.find((b) => b.userId.toHexString() === other.userId)?.subjectAlias).toBe(identityAlias(k(V2), "subject", SUBJECT));
      // ... and its sync imports the subject's bank data into the other account (the owner's v1 copy stays, orphaned).
      expect((await synchronizeOpenBanking(other, randomUUID(), s.deps())).status).toBe("completed");
      expect(await counts(s.db, other)).toEqual(FULL);
      expect(await counts(s.db, s.owner)).toEqual(FULL);
      const center = await loadOpenBankingCenter(other, s.deps());
      expect(center.bindingClaimed).toBe(true);
      expect(center.accounts.length).toBe(1);
    } finally { await s.dispose(); }
  }, 60_000);

  it("[kc-preflight] the test-only preflight counts orphaned bindings and at-risk documents per candidate secret, reads only, and reveals no identifier", async () => {
    const s = await scenario(uri!);
    try {
      await claimConfiguredOpenBankingSubject(s.owner, s.deps());
      await synchronizeOpenBanking(s.owner, randomUUID(), s.deps());
      const before = await fingerprint(s.db);
      const same = await keyContinuityPreflight(s.db, { subjectExternalId: SUBJECT, candidates: [{ label: "deployed", material: V1 }] });
      expect(same).toEqual({ bindings: 1, matchingBindings: { deployed: 1 }, orphanedBindings: 0, documentsAtRisk: { bankConnections: 0, bankRecordRevisions: 0, bankAccountReconciliations: 0, bankDevelopmentMigrations: 0, accounts: 0, transactions: 0 },
        aliasBearingWithoutBinding: { bankConnections: 0, bankRecordRevisions: 0, bankAccountReconciliations: 0, bankDevelopmentMigrations: 0, accounts: 0, transactions: 0 }, deletionReceiptsWithProviderSubjects: 0 });
      const changed = await keyContinuityPreflight(s.db, { subjectExternalId: SUBJECT, candidates: [{ label: "deployed", material: V2 }] });
      expect(changed).toEqual({ bindings: 1, matchingBindings: { deployed: 0 }, orphanedBindings: 1,
        documentsAtRisk: { bankConnections: 1, bankRecordRevisions: 3, bankAccountReconciliations: 0, bankDevelopmentMigrations: 0, accounts: 1, transactions: 1 },
        aliasBearingWithoutBinding: { bankConnections: 0, bankRecordRevisions: 0, bankAccountReconciliations: 0, bankDevelopmentMigrations: 0, accounts: 0, transactions: 0 }, deletionReceiptsWithProviderSubjects: 0 });
      const both = await keyContinuityPreflight(s.db, { subjectExternalId: SUBJECT, candidates: [{ label: "old", material: V1 }, { label: "new", material: V2 }] });
      expect(both).toMatchObject({ matchingBindings: { old: 1, new: 0 }, orphanedBindings: 0 });
      expect(await fingerprint(s.db), "read-only").toBe(before);
      const text = JSON.stringify([same, changed, both]);
      for (const sensitive of [V1, V2, SUBJECT, s.owner.userId, ...syncValues(V1)]) expect(text).not.toContain(sensitive);
      expect(text).not.toMatch(/[0-9a-f]{24,}/);
    } finally { await s.dispose(); }
  }, 60_000);

  it("[kc-secret-differential] the same flows under V1, V1 again and V2 change exactly the inventoried stored leaves (aliases AND second-order digests)", async () => {
    // Leaf multisets per `<collection> <path>`; values that differ between the two V1 runs (random ids, clock) are noise and excluded.
    const leaves = async (db: Db) => {
      const out = new Map<string, string[]>();
      for (const { name } of await db.listCollections().toArray()) for (const document of await db.collection(name).find({}).toArray()) {
        const walk = (value: unknown, path: string): void => {
          if (Array.isArray(value)) value.forEach((item) => walk(item, `${path}[]`));
          else if (value !== null && typeof value === "object" && !(value instanceof ObjectId) && !(value instanceof Date) && !(value instanceof BSON.Long)) {
            for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
          } else { const key = `${name} ${path}`; out.set(key, [...(out.get(key) ?? []), BSON.EJSON.stringify({ v: value })].sort()); }
        };
        walk(document, "");
      }
      return out;
    };
    const ownerId = new ObjectId().toHexString(); const keys = { sync: randomUUID(), refresh: randomUUID(), disconnect: randomUUID() };
    const bank = async (secret: string) => {
      const s = await scenario(uri!, ownerId);
      try {
        vi.stubEnv("AUTH_SECRET", secret);
        await claimConfiguredOpenBankingSubject(s.owner, s.deps());
        expect((await synchronizeOpenBanking(s.owner, keys.sync, s.deps())).status).toBe("completed");
        await requestOpenBankingRefresh(s.owner, keys.refresh, s.deps());
        const connection = (await s.db.collection("bankConnections").findOne({}))!;
        await disconnectOpenBankingConnection(s.owner, connection._id.toHexString(), connection.version as number, keys.disconnect, s.deps());
        return await leaves(s.db);
      } finally { await s.dispose(); }
    };
    const reconcile = async (secret: string) => {
      const client = await new MongoClient(uri!, { promoteLongs: false }).connect();
      const db = client.db(`keycontinuity_diff_${randomUUID().replaceAll("-", "")}`);
      try { vi.stubEnv("AUTH_SECRET", secret); await reconciliation(db, { actorId: ownerId, idempotencyKey: keys.sync }); return await leaves(db); }
      finally { vi.stubEnv("AUTH_SECRET", V1); await db.dropDatabase(); await client.close(); }
    };
    const dependent = (a: Map<string, string[]>, control: Map<string, string[]>, b: Map<string, string[]>) => [...new Set([...a.keys(), ...b.keys()])]
      .filter((key) => JSON.stringify(a.get(key)) === JSON.stringify(control.get(key)) && JSON.stringify(a.get(key)) !== JSON.stringify(b.get(key))).sort();
    const bankPaths = dependent(await bank(V1), await bank(V1), await bank(V2));
    expect(bankPaths).toEqual([
      "accounts source.connectionAlias", "accounts source.observationFingerprint", "accounts source.recordAlias",
      "bankConnections connectionAlias", "bankConnections fingerprint", "bankConnections providerAlias", "bankProviderBindings subjectAlias",
      "bankRecordRevisions account.identity.referenceDigest", "bankRecordRevisions accountAlias", "bankRecordRevisions connection.providerAlias",
      "bankRecordRevisions connectionAlias", "bankRecordRevisions fingerprint", "bankRecordRevisions recordAlias",
      "transactions source.connectionAlias", "transactions source.observationFingerprint", "transactions source.recordAlias",
    ]);
    const reconciliationPaths = dependent(await reconcile(V1), await reconcile(V1), await reconcile(V2));
    for (const path of [...bankPaths, ...reconciliationPaths]) expect(inventoried(path), `${path}: secret-dependent stored leaf not in the inventory`).toBe(true);
    expect(reconciliationPaths.filter((path) => path.startsWith("bankAccountReconciliations")).length).toBeGreaterThan(0);
  }, 120_000);

  it("[kc-reconciliation] a v1 reconciliation decision replays idempotently; under v2 the review is refused before any provider read and writes nothing", async () => {
    const client = await new MongoClient(uri!, { promoteLongs: false }).connect();
    const db = client.db(`keycontinuity_rec_${randomUUID().replaceAll("-", "")}`);
    try {
      vi.stubEnv("AUTH_SECRET", V1);
      const r = await reconciliation(db);
      const before = await fingerprint(db);
      await r.replay(); // same idempotency key and command: no new event
      expect(await fingerprint(db)).toBe(before);
      vi.stubEnv("AUTH_SECRET", V2);
      const reads = r.provider.listConnections.mock.calls.length;
      await expect(loadAccountReconciliation(r.actor, r.deps)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(r.provider.listConnections.mock.calls.length, "refused before any provider read").toBe(reads);
      expect(await fingerprint(db)).toBe(before);
    } finally { vi.stubEnv("AUTH_SECRET", V1); await db.dropDatabase(); await client.close(); }
  }, 60_000);
});

(uri && replicaUri ? describe : describe.skip)("18-13 key-continuity rehearsal: erasure (local replica set, synthetic, real ledger-first erasure)", () => {
  beforeAll(env);
  afterAll(() => { vi.unstubAllEnvs(); });

  it("[kc-resurrection-f-18-13-03] OPEN HIGH FINDING: an erased provider subject is refused under the same secret, but after an AUTH_SECRET change it can be claimed again and its bank data re-imported", async () => {
    vi.stubEnv("AUTH_SECRET", V1);
    const target = await createIsolatedRecoveryTarget(replicaUri!);
    try {
      const db = target.database;
      const repository = openBankingRepositoryForDatabase(db, () => NOW); const profiles = profileRepositoryForDatabase(db);
      await Promise.all([repository.ensureIndexes(), profiles.ensureIndexes()]);
      const ledgerKey = { version: 1, material: new Uint8Array(32).fill(9) }; // synthetic ledger key
      const store = new DeletionReceiptStore(db, "isolated-test", { active: ledgerKey, keys: [ledgerKey] });
      // The claim's anti-resurrection guard backed by the REAL deletion ledger (as configuredErasureGuard does at runtime).
      const deps = () => ({ now: () => NOW, profileRepository: profiles, provider: new FixtureProvider(), repository, erasedProviderSubject: (alias: string) => store.isProviderSubjectErased(alias) });
      const person = async (): Promise<Actor> => {
        const a: Actor = { kind: "user", userId: new ObjectId().toHexString() };
        await saveProfile(a, profileOf, { repository: profiles });
        return a;
      };
      // 1. v1: the owner claims and syncs.
      const erased = await person();
      await claimConfiguredOpenBankingSubject(erased, deps());
      expect((await synchronizeOpenBanking(erased, randomUUID(), deps())).status).toBe("completed");
      expect(await counts(db, erased)).toEqual(FULL);
      // 2. Real ledger-first erasure (synthetic local steps) removes the owner's bank data and bindings.
      const owned = { userId: new ObjectId(erased.userId) }; const journal: DeletionLedgerRow[] = [];
      const receipt = await runLedgerFirstErasure(store, erased, randomUUID(), () => Date.parse("2026-09-04T00:00:00Z"), {
        providerSubjectAliases: async () => (await db.collection("bankProviderBindings").find(owned).toArray()).map((b) => b.subjectAlias as string),
        fence: async () => {},
        erase: async () => { for (const c of ["bankProviderBindings", "bankConnections", "bankRecordRevisions", "bankSyncRuns", "accounts", "transactions", "profiles"]) await db.collection(c).deleteMany(owned); },
        verify: async () => (await db.collection("bankProviderBindings").countDocuments(owned)) === 0,
      }, async (row) => { journal.push(row); });
      expect(receipt.status).toBe("locally-erased");
      expect(journal.length).toBeGreaterThan(0);
      expect(await counts(db)).toEqual(NONE);
      const v1Subject = identityAlias(k(V1), "subject", SUBJECT);
      expect(await store.isProviderSubjectErased(v1Subject)).toBe(true);
      // The read-only preflight is CLEAN here (no binding, nothing orphaned) - "0 orphaned" does not clear F-18-13-03; it only reports
      // that a receipt carries provider-subject markers it cannot evaluate.
      expect(await keyContinuityPreflight(db, { subjectExternalId: SUBJECT, candidates: [{ label: "deployed", material: V2 }] })).toEqual({ bindings: 0,
        matchingBindings: { deployed: 0 }, orphanedBindings: 0, documentsAtRisk: { bankConnections: 0, bankRecordRevisions: 0, bankAccountReconciliations: 0, bankDevelopmentMigrations: 0, accounts: 0, transactions: 0 }, aliasBearingWithoutBinding: { bankConnections: 0, bankRecordRevisions: 0, bankAccountReconciliations: 0, bankDevelopmentMigrations: 0, accounts: 0, transactions: 0 }, deletionReceiptsWithProviderSubjects: 1 });
      // 3. v1: a newcomer is refused by the anti-resurrection guard, with no write.
      const newcomerV1 = await person();
      const beforeV1 = await fingerprint(db);
      await expect(claimConfiguredOpenBankingSubject(newcomerV1, deps())).rejects.toThrow(/erased account/);
      expect(await fingerprint(db)).toBe(beforeV1);
      // 4. v2: another newcomer claims the same provider subject ...
      vi.stubEnv("AUTH_SECRET", V2);
      const newcomerV2 = await person();
      await claimConfiguredOpenBankingSubject(newcomerV2, deps());
      // 5. ... and the sync re-imports the erased subject's bank data.
      expect((await synchronizeOpenBanking(newcomerV2, randomUUID(), deps())).status).toBe("completed");
      expect(await counts(db, newcomerV2)).toEqual(FULL);
      // 6. The ledger still marks the erased subject under its v1-derived identity; the guard only checks the current (v2) alias.
      expect(await store.isProviderSubjectErased(v1Subject)).toBe(true);
      expect(await store.isProviderSubjectErased(identityAlias(k(V2), "subject", SUBJECT))).toBe(false);
      // The ledger's own subject identity is keyed by the ledger key, not AUTH_SECRET: the receipt is still readable under v2.
      expect((await store.read(erased))?.status).toBe("locally-erased");
    } finally { vi.stubEnv("AUTH_SECRET", V1); await target.dispose(); }
  }, 120_000);
});
