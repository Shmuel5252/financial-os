import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { debtRecoveryFixture } from "../helpers/debt-recovery-fixture";
import { debtStrategyRepositoryForDatabase } from "@/lib/debt-strategies/debt-strategy-repository";
import { debtStrategyInputDomainSchema, debtStrategyComparisonDomainSchema } from "@/lib/debt-strategies/debt-strategy";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { fromStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { money } from "@/lib/domain/money/money";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { inspectDebtRecoveryLinks } from "@/lib/operations/debt-recovery-links";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated saved debt evidence recovery", () => {
  it("roundtrips original loan/scenario BSON, filters erased ownership and preserves retry/index integrity", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const loans = manualRecordRepositoryForDatabase(source.database, "loans");
      const scenarios = debtStrategyRepositoryForDatabase(source.database);
      await loans.ensureIndexes(); await scenarios.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const retryKey = randomUUID(); const balance = money(9007199254740993n, "ILS");
      for (const actor of actors) {
        const loan = await loans.createForActor(actor, { name: "Synthetic loan", annualInterestRateBps: 0, endDate: null,
          nextPaymentDate: "2026-10-01", monthlyPayment: balance, originalAmount: balance, remainingBalance: balance }, randomUUID());
        const fixture = debtRecoveryFixture(new ObjectId(actor.userId), new ObjectId(loan.id));
        await scenarios.saveForActor(actor, debtStrategyInputDomainSchema.parse(fromStoredDomainValue(fixture.input)),
          debtStrategyComparisonDomainSchema.parse(fromStoredDomainValue(fixture.comparison)), { idempotencyKey: retryKey, name: fixture.name, note: fixture.note });
      }
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      const names = ["loans", "debtStrategyScenarios"];
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) };
      const pack = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      expect(inspectDebtRecoveryLinks(opened.debtStrategyScenarios!, opened.loans!)).toEqual({ policy: "debt-recovery-links-v1",
        releaseAllowed: false, matched: 2, unresolved: { missing: 0, changed: 0, inactive: 0, historicalScenarios: 2 } });
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restored = debtStrategyRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await manualRecordRepositoryForDatabase(target.database, "loans").ensureIndexes();
      for (const name of names) {
        const survivors = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(survivors);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        expect((await target.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual((await source.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
      }
      const row = (await target.database.collection("debtStrategyScenarios").findOne())!;
      expect(inspectDebtRecoveryLinks([row], await target.database.collection("loans").find().toArray())).toEqual({ policy: "debt-recovery-links-v1",
        releaseAllowed: false, matched: 1, unresolved: { missing: 0, changed: 0, inactive: 0, historicalScenarios: 1 } });
      expect(row.input.debts[0].balance.amountMinor).toBeInstanceOf(Long);
      expect(row.input.debts[0].balance.amountMinor.toString()).toBe("9007199254740993");
      expect(await restored.listAllForActor(actors[0]!)).toEqual([]);
      expect((await restored.listAllForActor(actors[1]!)).map(item => item.id)).toEqual([row._id.toHexString()]);
      const retry = await restored.saveForActor(actors[1]!, debtStrategyInputDomainSchema.parse(fromStoredDomainValue(row.input)),
        debtStrategyComparisonDomainSchema.parse(fromStoredDomainValue(row.comparison)), { idempotencyKey: retryKey, name: row.name, note: row.note });
      expect(retry.id).toBe(row._id.toHexString());
      expect(await target.database.collection("debtStrategyScenarios").countDocuments()).toBe(1);
      await expect(target.database.collection("debtStrategyScenarios").insertOne({ ...row, _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
      expect(await target.database.collection("transactions").countDocuments()).toBe(0);
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
