import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { budgetRepositoryForDatabase } from "@/lib/budgets/budget-repository";
import { calculateBudget } from "@/lib/domain/budgets/budget-engine";
import { money } from "@/lib/domain/money/money";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated budget-period recovery", () => {
  it("preserves open/updated/closed BSON and indexes, while excluding a deleted owner before restore", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const owner = new ObjectId(); const erased = new ObjectId();
      const actor = { kind: "user" as const, userId: owner.toHexString() };
      const other = { kind: "user" as const, userId: erased.toHexString() };
      const repo = budgetRepositoryForDatabase(source.database); await repo.ensureIndexes();
      const allocations = [{ categoryId: "system:food", amount: money(9007199254740993n, "ILS") }];
      const input = { allocations, carryIn: [], calendarMonth: "2026-09", currency: "ILS", expectedVersion: null };
      await repo.savePeriodForActor(actor, { ...input, allocations: [{ categoryId: "system:food", amount: money(1n, "ILS") }] });
      await repo.savePeriodForActor(other, input);
      await repo.savePeriodForActor(actor, { ...input, calendarMonth: "2026-10" });
      await repo.savePeriodForActor(actor, { ...input, expectedVersion: 1 });
      const calculation = calculateBudget({ ...input, activities: [], plannedOutflows: [],
        categories: [{ categoryId: "system:food", hidden: false, kind: "system", label: null, rolloverPolicy: "reset", sortOrder: 1, systemKey: "food", version: 0 }],
        confirmedIncome: money(9007199254740994n, "ILS"), uncertainIncome: money(0n, "ILS") });
      await repo.closePeriodForActor(actor, "2026-09", 2, calculation);
      const rows = await source.database.collection("budgetPeriods").find().sort({ _id: 1 }).toArray(); const before = BSON.serialize({ rows });
      const key = { version: 1, material: randomBytes(32) };
      const records = { ...Object.fromEntries(recoveryCollections.map(name => [name, []])), authUsers: [{ _id: owner }, { _id: erased }], budgetPeriods: rows };
      const opened = openBackupPackage(createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key), initialRecoverySchemas, "a".repeat(64), key);
      const now = Date.now();
      const suppression = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(other, "isolated-test", randomUUID(), now, key)] });
      const surviving = opened.budgetPeriods!.filter(row => !suppression.isSuppressed(row.userId.toHexString()));
      const restored = budgetRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await target.database.collection("budgetPeriods").insertMany(surviving);
      const closed = await restored.findPeriodForActor(actor, "2026-09");
      expect(closed?.status).toBe("closed"); expect(closed?.version).toBe(3);
      expect(closed?.closingSnapshot?.unallocated.amountMinor).toBe(1n);
      expect((await restored.findPeriodForActor(actor, "2026-10"))?.status).toBe("open");
      expect(await restored.findPeriodForActor(other, "2026-09")).toBeNull();
      const reread = await target.database.collection("budgetPeriods").find().sort({ _id: 1 }).toArray();
      expect(BSON.serialize({ rows: reread })).toEqual(BSON.serialize({ rows: rows.filter(row => row.userId.equals(owner)) }));
      expect(reread[0]!.allocations[0].amount.amountMinor).toBeInstanceOf(Long);
      await expect(target.database.collection("budgetPeriods").insertOne({ ...surviving[0], _id: new ObjectId() })).rejects.toThrow();
      expect(BSON.serialize({ rows: await source.database.collection("budgetPeriods").find().sort({ _id: 1 }).toArray() })).toEqual(before);
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
