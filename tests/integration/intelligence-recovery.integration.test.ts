import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { intelligenceRecoveryFixture } from "../helpers/intelligence-recovery-fixture";
import { transactionIntelligenceRepositoryForDatabase } from "@/lib/transaction-intelligence/transaction-intelligence-repository";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { money } from "@/lib/domain/money/money";
import { inspectIntelligenceRecoveryLinks } from "@/lib/operations/intelligence-recovery-links";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated transaction-intelligence recovery", () => {
  it("preserves immutable run/review BSON, owner suppression, indexes and idempotency without replaying decisions", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const repo = transactionIntelligenceRepositoryForDatabase(source.database); await repo.ensureIndexes();
      const accounts = manualRecordRepositoryForDatabase(source.database, "accounts"); await accounts.ensureIndexes();
      const transactions = manualRecordRepositoryForDatabase(source.database, "transactions"); await transactions.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const fixtures: ReturnType<typeof intelligenceRecoveryFixture>[] = [];
      const runKey = randomUUID(); const reviewKey = randomUUID();
      const saved = [];
      for (const actor of actors) {
        const amount = money(9007199254740993n, "ILS");
        const account = await accounts.createForActor(actor, { name: "Synthetic account", type: "bank", balance: amount }, randomUUID());
        const ids = [];
        for (let index = 0; index < 2; index++) {
          const transaction = await transactions.createForActor(actor, { accountId: account.id, amount, category: "other", confidenceBps: 10000,
            date: "2026-09-28", destinationAccountId: null, merchant: "Synthetic merchant", notes: null, recurring: false,
            refundOfTransactionId: null, type: "expense" }, randomUUID());
          ids.push(new ObjectId(transaction.id));
        }
        const fixture = intelligenceRecoveryFixture(new ObjectId(actor.userId), ids, account.id); fixtures.push(fixture);
        const run = await repo.createRunForActor(actor, fixture.calculation, fixture.metadata, runKey);
        const review = await repo.createReviewForActor(actor, { ...fixture.reviewInput, runId: run.id.toUpperCase(), sequence: 1 }, reviewKey);
        saved.push({ run, review });
      }
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      const names = ["transactionIntelligenceRuns", "transactionIntelligenceReviews", "accounts", "transactions"];
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) };
      const pack = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      expect(inspectIntelligenceRecoveryLinks({ runs: opened.transactionIntelligenceRuns!, reviews: opened.transactionIntelligenceReviews!,
        transactions: opened.transactions!, corrections: [] })).toEqual({ policy: "intelligence-recovery-links-v1", releaseAllowed: false,
        matched: 2, unresolved: { missing: 0, inactive: 0, unversioned: 4, sequenceGaps: 0, historicalRuns: 2 } });
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restored = transactionIntelligenceRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await manualRecordRepositoryForDatabase(target.database, "accounts").ensureIndexes();
      await manualRecordRepositoryForDatabase(target.database, "transactions").ensureIndexes();
      for (const name of names) {
        const survivors = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(survivors);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        expect((await target.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual((await source.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
        await expect(target.database.collection(name).insertOne({ ...survivors[0], _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
      }
      const row = (await target.database.collection("transactionIntelligenceRuns").findOne())!;
      expect(inspectIntelligenceRecoveryLinks({ runs: [row], reviews: await target.database.collection("transactionIntelligenceReviews").find().toArray(),
        transactions: await target.database.collection("transactions").find().toArray(), corrections: [] }))
        .toEqual({ policy: "intelligence-recovery-links-v1", releaseAllowed: false, matched: 1,
          unresolved: { missing: 0, inactive: 0, unversioned: 2, sequenceGaps: 0, historicalRuns: 1 } });
      expect(row.signals[0].amount.amountMinor).toBeInstanceOf(Long);
      expect(row.signals[0].amount.amountMinor.toString()).toBe("9007199254740993");
      expect(await restored.listAllRunsForActor(actors[0]!)).toEqual([]);
      expect(await restored.listAllReviewsForActor(actors[0]!)).toEqual([]);
      expect(await restored.findRunForActor(actors[0]!, saved[1]!.run.id)).toBeNull();
      expect((await restored.createRunForActor(actors[1]!, fixtures[1]!.calculation, fixtures[1]!.metadata, runKey)).id).toBe(saved[1]!.run.id);
      expect((await restored.createReviewForActor(actors[1]!, { ...fixtures[1]!.reviewInput, runId: saved[1]!.run.id.toUpperCase(), sequence: 1 }, reviewKey)).id).toBe(saved[1]!.review.id);
      expect(await target.database.collection("transactionIntelligenceRuns").countDocuments()).toBe(1);
      expect(await target.database.collection("transactionIntelligenceReviews").countDocuments()).toBe(1);
      expect(await target.database.collection("transactions").countDocuments()).toBe(2);
      expect(await target.database.collection("budgetCategoryCorrections").countDocuments()).toBe(0);
      // Unversioned transaction references do not establish historical input/inference validity.
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
