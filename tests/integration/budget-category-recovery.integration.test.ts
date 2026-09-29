import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { budgetRepositoryForDatabase } from "@/lib/budgets/budget-repository";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { inspectBudgetRecoveryLinks } from "@/lib/operations/budget-recovery-links";
import { money } from "@/lib/domain/money/money";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated category and correction recovery", () => {
  it("preserves repository audit BSON and retry identity while suppressing the erased owner's records", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const repo = budgetRepositoryForDatabase(source.database); await repo.ensureIndexes();
      const transactions = manualRecordRepositoryForDatabase(source.database, "transactions"); await transactions.ensureIndexes();
      const inputs = [];
      const retryKey = randomUUID();
      const categoryKey = randomUUID();
      const categoryInput = { label: "Synthetic", rolloverPolicy: "reset" as const };
      for (const actor of actors) {
        const transaction = await transactions.createForActor(actor, { accountId: new ObjectId().toHexString(), category: "food",
          confidenceBps: 10000, date: "2026-09-27", destinationAccountId: null, merchant: null, notes: null,
          recurring: false, refundOfTransactionId: null, type: "expense", amount: money(9007199254740993n, "ILS") }, randomUUID());
        const input = { fromCategoryId: null, toCategoryId: "system:food", transactionId: transaction.id, reason: "Synthetic correction" };
        inputs.push(input);
        const custom = await repo.createCustomCategoryForActor(actor, categoryInput, categoryKey);
        const settings = { label: "Synthetic updated", hidden: true, rolloverPolicy: "carry" as const, sortOrder: 15 };
        await repo.updateCategoryForActor(actor, custom.categoryId, 1, settings);
        await repo.updateCategoryForActor(actor, "system:food", 0, settings);
        await repo.createCorrectionForActor(actor, input, retryKey);
      }
      // Account/transaction historical closure is not implied by these direct budget links.
      const input = inputs[1]!; const transactionId = input.transactionId;
      const names = ["budgetCategories", "budgetCategoryCorrections", "transactions"];
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) };
      const opened = openBackupPackage(createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key), initialRecoverySchemas, "a".repeat(64), key);
      expect(inspectBudgetRecoveryLinks({ categories: opened.budgetCategories!, corrections: opened.budgetCategoryCorrections!,
        transactions: opened.transactions!, periods: [] })).toEqual({ policy: "budget-recovery-links-v1", releaseAllowed: false,
        matched: 4, virtualCategories: 0, unresolved: { missing: 0, inactive: 0, historicalCorrections: 2 } });
      const now = Date.now();
      const suppression = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restored = budgetRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await manualRecordRepositoryForDatabase(target.database, "transactions").ensureIndexes();
      for (const name of names) {
        const surviving = opened[name]!.filter(row => !suppression.isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(surviving);
        const rows = await target.database.collection(name).find().sort({ _id: 1 }).toArray();
        expect(BSON.serialize({ rows })).toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect((await target.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual((await source.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))));
        await expect(target.database.collection(name).insertOne({ ...surviving[0], _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
      }
      expect(inspectBudgetRecoveryLinks({ categories: await target.database.collection("budgetCategories").find().toArray(),
        corrections: await target.database.collection("budgetCategoryCorrections").find().toArray(),
        transactions: await target.database.collection("transactions").find().toArray(), periods: [] })).toEqual({ policy: "budget-recovery-links-v1",
        releaseAllowed: false, matched: 2, virtualCategories: 0, unresolved: { missing: 0, inactive: 0, historicalCorrections: 1 } });
      const first = await restored.createCorrectionForActor(actors[1]!, input, retryKey);
      const categoryBeforeRetry = await target.database.collection("budgetCategories").findOne({ kind: "custom" });
      const categoryRetry = await restored.createCustomCategoryForActor(actors[1]!, categoryInput, categoryKey);
      expect(categoryRetry.categoryId).toBe(categoryBeforeRetry!.categoryId);
      expect(categoryRetry.version).toBe(2);
      expect(await target.database.collection("budgetCategories").countDocuments()).toBe(2);
      const second = await restored.createCorrectionForActor(actors[1]!, input, retryKey);
      expect(second).toEqual(first);
      expect(await target.database.collection("budgetCategoryCorrections").countDocuments()).toBe(1);
      await expect(restored.createCorrectionForActor(actors[1]!, { ...input, reason: "Different synthetic reason" }, retryKey)).rejects.toThrow();
      expect(await restored.listCorrectionsForActor(actors[0]!, [transactionId])).toEqual([]);
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
