import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { money } from "@/lib/domain/money/money";
import { bankAlias } from "@/lib/open-banking/account-identity";
import { ensureDevelopmentBaselineIndexes, planDevelopmentBaseline, retireDevelopmentBaseline } from "@/lib/open-banking/development-baseline";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import type { OpenBankingAccountObservation, OpenBankingConnectionObservation, OpenBankingPage, OpenBankingProvider,
  OpenBankingTransactionObservation } from "@/lib/open-banking/open-banking-provider";
import { claimConfiguredOpenBankingSubject, synchronizeOpenBanking } from "@/lib/open-banking/open-banking-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { quarantineBankControl } from "@/lib/operations/bank-control-recovery";
import { inspectBankDevelopmentRecovery } from "@/lib/operations/bank-development-recovery";

const uri = process.env.MONGODB_TEST_URI;
const byName = (left: Document, right: Document) => String(left.name).localeCompare(String(right.name));

/** One synthetic subject; `connections` lists which external connections exist and their status. */
class SyntheticProvider implements OpenBankingProvider {
  connections: Readonly<Record<string, string>> = {};
  constructor(private readonly subject: string) {}
  async listConnections(): Promise<readonly OpenBankingConnectionObservation[]> {
    return Object.entries(this.connections).map(([name, status]) => ({ expiryDate: "2026-12-01", externalId: `${this.subject}-${name}`,
      lastFetchedAt: "2026-09-06T08:00:00.000Z", lastFetchedDataDate: "2026-09-06", mode: "PSD2", providerExternalId: "synthetic-bank", status, subjectExternalId: this.subject }));
  }
  async listAccountsPage(): Promise<OpenBankingPage<OpenBankingAccountObservation>> {
    return { nextCursor: null, items: Object.keys(this.connections).map(name => ({ accountType: "CHECKING" as const, balances: [{ amount: money(9007199254740993n, "ILS"),
      creditLimitIncluded: false, referenceDate: "2026-09-06", type: "interimAvailable" }], connectionExternalId: `${this.subject}-${name}`, currency: "ILS",
    displayName: `Account ${name}`, externalId: `${this.subject}-${name}-account`, isDuplicate: false, providerExternalId: "synthetic-bank" })) };
  }
  async listTransactionsPage(): Promise<OpenBankingPage<OpenBankingTransactionObservation>> {
    return { nextCursor: null, items: Object.keys(this.connections).map(name => ({ accountExternalId: `${this.subject}-${name}-account`, amount: money(-1_234n, "ILS"),
      bookingDate: "2026-09-02", categoryMain: "shopping", categorySub: null, changedCategoryMain: null, changedCategorySub: null, connectionExternalId: `${this.subject}-${name}`,
      externalId: `${this.subject}-${name}-transaction`, installmentNumber: null, installmentTotal: null, isDuplicate: false, merchantName: "Merchant", originalAmount: null,
      providerExternalId: "synthetic-bank", stableExternalKey: `${this.subject}-${name}-stable`, status: "BOOKED", transactionDate: "2026-09-02", type: "CHECKING", valueDate: "2026-09-02" })) };
  }
  async refreshConnections(): Promise<never> { throw new Error("Paid refresh is never called by recovery tests"); }
  async deleteConnection(): Promise<never> { throw new Error("Disconnect is never called by recovery tests"); }
}

(uri ? describe : describe.skip)("real isolated development-baseline recovery", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("restores minimized manifests without the development archive so retired development data is never reimported", async () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUTH_SECRET", "synthetic-recovery-secret-at-least-32-characters");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "synthetic-client"); vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "synthetic-secret");
    const source = await createIsolatedRecoveryTarget(uri!);
    const namespaces: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>>[] = [];
    try {
      let clock = Date.parse("2026-09-06T08:00:00.000Z"); const now = () => new Date(clock++);
      const profiles = profileRepositoryForDatabase(source.database); const repository = openBankingRepositoryForDatabase(source.database, now);
      await Promise.all([profiles.ensureIndexes(), repository.ensureIndexes(), manualRecordRepositoryForDatabase(source.database, "accounts").ensureIndexes(),
        manualRecordRepositoryForDatabase(source.database, "transactions").ensureIndexes()]);
      const actors: Actor[] = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const providers = actors.map((_, index) => new SyntheticProvider(`synthetic-subject-${index}`));
      const deps = (index: number) => ({ now, profileRepository: profiles, provider: providers[index]!, repository });
      const subject = (index: number) => vi.stubEnv("OPEN_FINANCE_USER_ID", `synthetic-subject-${index}`);
      for (const [index, actor] of actors.entries()) {
        subject(index); providers[index]!.connections = { old: "ACTIVE" };
        await saveProfile(actor, { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profiles });
        await claimConfiguredOpenBankingSubject(actor, deps(index)); expect((await synchronizeOpenBanking(actor, randomUUID(), deps(index))).status).toBe("completed");
      }
      // Survivor (owner 1) ends the old connection and retires it with the real offline tool; owner 0 keeps ordinary data and is erased later.
      subject(1); const survivor = actors[1]!; const oldAlias = bankAlias("connection", "synthetic-subject-1-old");
      const oldConnection = await source.database.collection("bankConnections").findOne({ userId: new ObjectId(survivor.userId), connectionAlias: oldAlias });
      await repository.markDisconnected(survivor, oldConnection!._id.toHexString(), oldConnection!.version);
      const plan = await planDevelopmentBaseline(source.database, { owner: new ObjectId(survivor.userId), subjectAlias: bankAlias("subject", "synthetic-subject-1"),
        activeConnectionAlias: bankAlias("connection", "synthetic-subject-1-new") });
      await retireDevelopmentBaseline(source.database, plan, "owner-approved-development-reset-2026-09-06");
      providers[1]!.connections = { old: "TERMINATED_BY_USER", new: "ACTIVE" };
      expect((await synchronizeOpenBanking(survivor, randomUUID(), deps(1))).status).toBe("completed");
      const erasedIds = new Set<string>();
      for (const name of recoveryCollections) for (const row of await source.database.collection(name).find({ userId: new ObjectId(actors[0]!.userId) }).toArray()) erasedIds.add(row._id.toHexString());
      // The manifest's protected digests include the other owner's records: the mixed-subject barrier is real, not hypothetical.
      expect(plan.protectedRecords.filter(item => erasedIds.has(item.id.toHexString())).length).toBeGreaterThan(0);

      const records: Record<string, Document[]> = Object.fromEntries(await Promise.all(recoveryCollections.map(async name =>
        [name, await source.database.collection(name).find().sort({ _id: 1 }).toArray()])));
      const written = Object.keys(records).filter(name => records[name]!.length > 0).sort();
      expect(written).toEqual(["accounts", "bankConnections", "bankDevelopmentArchive", "bankDevelopmentMigrations", "bankProviderBindings", "bankRecordRevisions",
        "bankSyncRuns", "profiles", "transactions"]);
      const inspect = (rows: Record<string, readonly Document[]>) => inspectBankDevelopmentRecovery({ migrations: rows.bankDevelopmentMigrations ?? [],
        connections: rows.bankConnections!, revisions: rows.bankRecordRevisions!, accounts: rows.accounts!, transactions: rows.transactions! });
      // Retired manifests are inspected in minimized form: no mixed-subject digests remain for a completed retirement.
      expect(inspect(records)).toEqual({ policy: "bank-development-recovery-v2", releaseAllowed: false, unresolved: { retiredReappeared: 0, mixedSubjectDigests: 0, interruptedRetirements: 0 } });
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const pack = createBackupPackage(records, initialRecoverySchemas, digest, key); expect(pack.manifest.releaseAllowed).toBe(false);
      // ADR-076 C2: the development archive is excluded; there is no part for it at all.
      expect(pack.manifest.excluded).toContain("bankDevelopmentArchive");
      expect(pack.manifest.entries.filter(entry => entry.collection.startsWith("bankDevelopment")).map(entry => [entry.collection, entry.schema]))
        .toEqual([["bankDevelopmentMigrations", "bank-development-migration-v2"]]);
      const opened = openBackupPackage(pack, initialRecoverySchemas, digest, key); const at = Date.now();
      expect(opened.bankDevelopmentArchive).toBeUndefined();
      // ADR-076 C1: the restored manifest carries none of the protected-record digests, including the erased owner digests.
      expect(opened.bankDevelopmentMigrations!.every(row => row.protectedRecords === undefined)).toBe(true);
      const bindingOf = (index: number) => records.bankProviderBindings!.find(row => row.userId.toHexString() === actors[index]!.userId)!.subjectAlias as string;
      const ledger = { environment: "isolated-test" as const, keys: [key], now: at, ledgerReadAt: at, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
        receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), at, key, [bindingOf(0)])] };
      const { isSuppressed, isProviderSubjectSuppressed } = restorationSuppression(ledger);
      // ADR-076 C3: the erased owner provider subject is marked; the survivor subject is not.
      expect([isProviderSubjectSuppressed(bindingOf(0)), isProviderSubjectSuppressed(bindingOf(1))]).toEqual([true, false]);
      const control = quarantineBankControl({ bindings: opened.bankProviderBindings!, connections: opened.bankConnections!, runs: opened.bankSyncRuns!, lifecycle: [] }, ledger);
      expect(control.evidence).toMatchObject({ erasedProviderSubjects: 0 });
      const included = written.filter(name => name !== "bankDevelopmentArchive");
      const survivors: Record<string, readonly Document[]> = Object.fromEntries(included.map(name => [name, name === "bankProviderBindings" ? control.bindings
        : name === "bankConnections" ? control.connections : name === "bankSyncRuns" ? control.runs : opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()))]));
      const restore = async (names: readonly string[]) => {
        const target = await createIsolatedRecoveryTarget(uri!); namespaces.push(target);
        const repo = openBankingRepositoryForDatabase(target.database, now); const restoredProfiles = profileRepositoryForDatabase(target.database);
        await Promise.all([repo.ensureIndexes(), restoredProfiles.ensureIndexes(), manualRecordRepositoryForDatabase(target.database, "accounts").ensureIndexes(),
          manualRecordRepositoryForDatabase(target.database, "transactions").ensureIndexes()]);
        for (const name of names) await target.database.collection(name).insertMany([...survivors[name]!]);
        return { target, repo, restoredProfiles };
      };
      const restored = await restore(included);
      const minimized = (name: string, row: Document) => { const copy = { ...row }; if (name === "bankDevelopmentMigrations") delete copy.protectedRecords; return copy; };
      for (const name of included) {
        expect(BSON.serialize({ rows: await restored.target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === survivor.userId).map(row => minimized(name, row)) }));
        expect(await restored.target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
      }
      expect(await restored.target.database.collection("bankDevelopmentArchive").countDocuments()).toBe(0);
      await ensureDevelopmentBaselineIndexes(restored.target.database);
      expect((await restored.target.database.collection("bankDevelopmentMigrations").listIndexes().toArray()).sort(byName))
        .toEqual((await source.database.collection("bankDevelopmentMigrations").listIndexes().toArray()).sort(byName));
      // After release, an ordinary sync where the provider still lists the retired connection imports only the active one.
      const rows = async (db: typeof restored.target.database) => (await Promise.all([db.collection("accounts").countDocuments({ "source.connectionAlias": oldAlias }),
        db.collection("transactions").countDocuments({ "source.connectionAlias": oldAlias }), db.collection("bankConnections").countDocuments({ connectionAlias: oldAlias }),
        db.collection("bankRecordRevisions").countDocuments({ connectionAlias: oldAlias })])).reduce((sum, value) => sum + value, 0);
      expect((await synchronizeOpenBanking(survivor, randomUUID(), { now, profileRepository: restored.restoredProfiles, provider: providers[1]!, repository: restored.repo })).status).toBe("completed");
      expect(await rows(restored.target.database)).toBe(0);
      expect(inspect(Object.fromEntries(await Promise.all(included.map(async name => [name, await restored.target.database.collection(name).find().toArray()]))))).toEqual({
        policy: "bank-development-recovery-v2", releaseAllowed: false, unresolved: { retiredReappeared: 0, mixedSubjectDigests: 0, interruptedRetirements: 0 } });
      // Control: the same restore without the minimized manifest reimports the retired development connection and its records.
      const unguarded = await restore(included.filter(name => name !== "bankDevelopmentMigrations"));
      expect((await synchronizeOpenBanking(survivor, randomUUID(), { now, profileRepository: unguarded.restoredProfiles, provider: providers[1]!, repository: unguarded.repo })).status).toBe("completed");
      // Connection, account, transaction and their revisions all come back without the manifest.
      expect(await rows(unguarded.target.database)).toBeGreaterThanOrEqual(6);
      expect(inspectBankDevelopmentRecovery({ migrations: survivors.bankDevelopmentMigrations!, connections: await unguarded.target.database.collection("bankConnections").find().toArray(),
        revisions: [], accounts: await unguarded.target.database.collection("accounts").find().toArray(), transactions: [] }).unresolved.retiredReappeared).toBeGreaterThan(0);
    } finally { for (const target of namespaces) await target.dispose(); await source.dispose(); }
  }, 60000);
});
