import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { money } from "@/lib/domain/money/money";
import type { ManualFields } from "@/lib/onboarding/manual-record";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { AccountReconciliationRepository } from "@/lib/open-banking/account-reconciliation-repository";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import type { OpenBankingAccountObservation, OpenBankingPage, OpenBankingProvider, OpenBankingTransactionObservation } from "@/lib/open-banking/open-banking-provider";
import { claimConfiguredOpenBankingSubject, synchronizeOpenBanking } from "@/lib/open-banking/open-banking-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { quarantineBankControl } from "@/lib/operations/bank-control-recovery";
import { inspectBankRecordRecovery } from "@/lib/operations/bank-record-recovery";

const uri = process.env.MONGODB_TEST_URI;
const byName = (left: Document, right: Document) => String(left.name).localeCompare(String(right.name));

class SyntheticProvider implements OpenBankingProvider {
  modified = false;
  constructor(private readonly subject: string) {}
  async listConnections() {
    return [{ expiryDate: "2026-12-01", externalId: `${this.subject}-connection`, lastFetchedAt: "2026-09-29T08:00:00.000Z", lastFetchedDataDate: "2026-09-29",
      mode: "PSD2", providerExternalId: "synthetic-bank", status: "ACTIVE", subjectExternalId: this.subject }];
  }
  async listAccountsPage(): Promise<OpenBankingPage<OpenBankingAccountObservation>> {
    return { nextCursor: null, items: [{ accountType: "CHECKING", balances: [{ amount: money(9007199254740993n, "ILS"), creditLimitIncluded: false,
      referenceDate: "2026-09-29", type: "interimAvailable" }], connectionExternalId: `${this.subject}-connection`, currency: "ILS", displayName: `${"x".repeat(99)} ${"y".repeat(10)}`,
    externalId: `${this.subject}-account`, identity: { version: "financy-account-identity-v1", bankCode: "12", branchCode: "345", maskedNumber: "•••• 6789",
      referenceDigest: "7".repeat(64) }, isDuplicate: false, providerExternalId: "synthetic-bank" }] };
  }
  async listTransactionsPage(): Promise<OpenBankingPage<OpenBankingTransactionObservation>> {
    return { nextCursor: null, items: [{ accountExternalId: `${this.subject}-account`, amount: money(this.modified ? -1_334n : -1_234n, "ILS"), bookingDate: "2026-09-02",
      categoryMain: "shopping", categorySub: null, changedCategoryMain: null, changedCategorySub: null, connectionExternalId: `${this.subject}-connection`,
      externalId: `${this.subject}-transaction`, installmentNumber: null, installmentTotal: null, isDuplicate: false, merchantName: "Merchant ••••", originalAmount: null,
      providerExternalId: "synthetic-bank", stableExternalKey: `${this.subject}-stable`, status: "BOOKED", transactionDate: "2026-09-02", type: "CHECKING", valueDate: "2026-09-02" }] };
  }
  async refreshConnections(): Promise<never> { throw new Error("Paid refresh is never called by recovery tests"); }
  async deleteConnection(): Promise<never> { throw new Error("Disconnect is never called by recovery tests"); }
}

(uri ? describe : describe.skip)("real isolated bank record recovery", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("restores service-written observations, bank-sourced canonical rows and owner reconciliation without re-deriving truth", async () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUTH_SECRET", "synthetic-recovery-secret-at-least-32-characters");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "synthetic-client"); vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "synthetic-secret");
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      // Advances on every call, as in production: separate now() calls within one write never share a timestamp.
      let clock = Date.parse("2026-09-29T08:00:00.000Z"); const now = () => new Date(clock++);
      const profiles = profileRepositoryForDatabase(source.database); const repository = openBankingRepositoryForDatabase(source.database, now);
      const accounts = manualRecordRepositoryForDatabase(source.database, "accounts", now); const transactions = manualRecordRepositoryForDatabase(source.database, "transactions", now);
      const ledgers = new AccountReconciliationRepository(source.database, now);
      await Promise.all([profiles.ensureIndexes(), repository.ensureIndexes(), accounts.ensureIndexes(), transactions.ensureIndexes(), ledgers.ensureIndexes()]);
      const actors: Actor[] = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const providers = actors.map((_, index) => new SyntheticProvider(`synthetic-subject-${index}`));
      for (const [index, actor] of actors.entries()) {
        vi.stubEnv("OPEN_FINANCE_USER_ID", `synthetic-subject-${index}`);
        const deps = { now, profileRepository: profiles, provider: providers[index]!, repository };
        await saveProfile(actor, { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profiles });
        const manual = await accounts.createForActor(actor, { balance: money(1_000n, "ILS"), name: "Manual cash", type: "cash" } as ManualFields, randomUUID());
        await transactions.createForActor(actor, { accountId: manual.id, amount: money(100n, "ILS"), category: "food", confidenceBps: 10_000, date: "2026-09-01",
          destinationAccountId: null, merchant: "Manual", notes: null, recurring: false, refundOfTransactionId: null, type: "expense" } as ManualFields, randomUUID());
        await claimConfiguredOpenBankingSubject(actor, deps); clock += 60_000;
        expect((await synchronizeOpenBanking(actor, randomUUID(), deps)).status).toBe("completed"); clock += 60_000;
        providers[index]!.modified = true;
        expect((await synchronizeOpenBanking(actor, randomUUID(), deps)).canonicalTransactionCount).toBe(1); clock += 60_000;
        const legacy = (await ledgers.listLegacyAccounts(actor))[0]!;
        const reference = (accountAlias: string) => ({ accountAlias, connectionAlias: legacy.connectionAlias, institutionAlias: legacy.institutionAlias, identity: legacy.identity,
          comparison: { institution: "Synthetic bank", name: legacy.name, type: legacy.type, currency: legacy.currency, maskedNumber: legacy.identity?.maskedNumber ?? null,
            bankCode: legacy.identity?.bankCode ?? null, branchCode: legacy.identity?.branchCode ?? null } });
        const candidate = "b".repeat(63) + String(index);
        await ledgers.recordDecision(actor, { legacy, expectedVersion: 0, oldIdentity: reference(legacy.accountAlias), newIdentity: reference(candidate),
          command: { legacyKey: legacy.accountAlias, candidateKey: candidate, reviewToken: "c".repeat(64), idempotencyKey: randomUUID(), decision: "same_account", confirmation: true } });
      }
      const records: Record<string, Document[]> = Object.fromEntries(await Promise.all(recoveryCollections.map(async name =>
        [name, await source.database.collection(name).find().sort({ _id: 1 }).toArray()])));
      const written = Object.keys(records).filter(name => records[name]!.length > 0).sort();
      expect(written).toEqual(["accounts", "bankAccountReconciliations", "bankConnections", "bankProviderBindings", "bankRecordRevisions", "bankSyncRuns", "profiles", "transactions"]);
      const inspect = (rows: Record<string, readonly Document[]>) => inspectBankRecordRecovery({ connections: rows.bankConnections!, revisions: rows.bankRecordRevisions!,
        accounts: rows.accounts!, transactions: rows.transactions!, reconciliations: rows.bankAccountReconciliations! });
      // Per owner: 3 revision links + 1 superseded transaction revision, 2 canonical connection + 2 evidence links, transaction and ledger account links.
      expect(inspect(records)).toEqual({ policy: "bank-record-recovery-v1", releaseAllowed: false, matched: 20,
        unresolved: { missingConnection: 0, missingEvidence: 0, missingAccount: 0, sequenceGaps: 0, historicalObservations: 8 } });
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const pack = createBackupPackage(records, initialRecoverySchemas, digest, key); expect(pack.manifest.releaseAllowed).toBe(false);
      expect(Object.fromEntries(pack.manifest.entries.filter(entry => written.includes(entry.collection)).map(entry => [entry.collection, entry.schema]))).toEqual({
        accounts: "manual-v2-open-banking-v1", transactions: "manual-v2-open-banking-v1", profiles: "profile-v1", bankProviderBindings: "bank-binding-v1",
        bankConnections: "bank-connection-v1", bankSyncRuns: "bank-sync-run-v1", bankRecordRevisions: "bank-revision-v1", bankAccountReconciliations: "bank-reconciliation-v1" });
      const opened = openBackupPackage(pack, initialRecoverySchemas, digest, key); const at = Date.now();
      const ledger = { environment: "isolated-test" as const, keys: [key], now: at, ledgerReadAt: at, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
        receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), at, key)] };
      const { isSuppressed } = restorationSuppression(ledger);
      const quarantined = quarantineBankControl({ bindings: opened.bankProviderBindings!, connections: opened.bankConnections!, runs: opened.bankSyncRuns!,
        lifecycle: opened.bankLifecycleCommands! }, ledger);
      expect(quarantined.evidence).toMatchObject({ excluded: 4, fenced: 0 });
      const restoredRows: Record<string, readonly Document[]> = Object.fromEntries(written.map(name => [name, name === "bankProviderBindings" ? quarantined.bindings
        : name === "bankConnections" ? quarantined.connections : name === "bankSyncRuns" ? quarantined.runs
          : opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()))]));
      const restored = { profiles: profileRepositoryForDatabase(target.database), repository: openBankingRepositoryForDatabase(target.database, now),
        accounts: manualRecordRepositoryForDatabase(target.database, "accounts", now), transactions: manualRecordRepositoryForDatabase(target.database, "transactions", now),
        ledgers: new AccountReconciliationRepository(target.database, now) };
      await Promise.all(Object.values(restored).map(item => item.ensureIndexes()));
      for (const name of written) {
        await target.database.collection(name).insertMany([...restoredRows[name]!]);
        const survivors = records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: survivors }));
        expect((await target.database.collection(name).listIndexes().toArray()).sort(byName)).toEqual((await source.database.collection(name).listIndexes().toArray()).sort(byName));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
      }
      const survivor = actors[1]!;
      expect(inspect(Object.fromEntries(await Promise.all(written.map(async name => [name, await target!.database.collection(name).find().toArray()]))))).toEqual({
        policy: "bank-record-recovery-v1", releaseAllowed: false, matched: 10,
        unresolved: { missingConnection: 0, missingEvidence: 0, missingAccount: 0, sequenceGaps: 0, historicalObservations: 4 } });
      // Existing readers accept restored rows unchanged; exact money survives as Long.
      const bankTransaction = (await restored.transactions.listForActor(survivor)).find(item => item.source.kind === "open_banking")!;
      expect(bankTransaction.fields).toMatchObject({ amount: { amountMinor: 1_334n, currency: "ILS" } });
      const restoredAccounts = await restored.accounts.listForActor(survivor);
      expect(restoredAccounts.map(item => item.source.kind).sort()).toEqual(["manual", "open_banking"]);
      // A 110-character provider label stays whole in private evidence; canonical truth keeps the trimmed domain name limit
      // (the cut at 100 lands after a space, which must not survive into the stored name).
      expect((restoredAccounts.find(item => item.source.kind === "open_banking")!.fields as { name: string }).name).toBe("x".repeat(99));
      expect((await target.database.collection("bankRecordRevisions").findOne({ recordKind: "account" }))!.account.displayName).toHaveLength(110);
      expect((await target.database.collection("bankRecordRevisions").findOne({ recordKind: "account" }))!.account.balances[0].amount.amountMinor).toEqual(Long.fromBigInt(9007199254740993n));
      expect(await restored.ledgers.listLedgers(survivor)).toHaveLength(1);
      expect(await restored.ledgers.listLedgers(actors[0]!)).toEqual([]);
      // An explicit later sync of unchanged provider data dedupes against restored evidence instead of duplicating it.
      vi.stubEnv("OPEN_FINANCE_USER_ID", "synthetic-subject-1"); clock += 60_000;
      const before = await target.database.collection("bankRecordRevisions").countDocuments();
      const resync = await synchronizeOpenBanking(survivor, randomUUID(), { now, profileRepository: restored.profiles, provider: providers[1]!, repository: restored.repository });
      expect(resync).toMatchObject({ status: "completed", canonicalAccountCount: 0, canonicalTransactionCount: 0 });
      expect(await target.database.collection("bankRecordRevisions").countDocuments()).toBe(before);
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
