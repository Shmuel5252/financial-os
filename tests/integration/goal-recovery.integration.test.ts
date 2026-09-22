import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { goalRepositoryForDatabase } from "@/lib/goals/goal-repository";
import { calculateGoalProgress } from "@/lib/domain/goals/goal-engine";
import { money } from "@/lib/domain/money/money";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { inspectGoalRecoveryLinks } from "@/lib/operations/goal-recovery";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated goal evidence recovery", () => {
  it("preserves manual-unverified progress and idempotency receipts without replay or foreign access", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const owners = [new ObjectId(), new ObjectId()]; const goalId = new ObjectId().toHexString(); const at = new Date("2026-09-22T00:00:00Z");
      const actor = { kind: "user" as const, userId: owners[0]!.toHexString() }; const erased = { kind: "user" as const, userId: owners[1]!.toHexString() };
      const repo = goalRepositoryForDatabase(source.database); await repo.ensureIndexes();
      const zero = money(0n, "ILS"); const high = money(9007199254740993n, "ILS");
      const configuration = { kind: "custom" as const, direction: "increase" as const, metricLabel: "Synthetic", targetAmount: high };
      const reportedEvidence = { capturedAt: at, currentValue: zero, startingValue: zero, targetAmount: high, goalRecordVersion: 1 };
      const receiptKey = randomUUID(); const progressReceiptKey = randomUUID();
      for (const user of [actor, erased]) {
        const definition = await repo.createDefinitionVersionForActor(user, { configuration, expectedDefinitionVersion: null, goalId, reportedEvidence, targetDate: null }, randomUUID());
        await repo.createDefinitionVersionForActor(user, { configuration, expectedDefinitionVersion: 1, goalId, reportedEvidence, targetDate: null }, receiptKey);
        const progress = { evaluatedAt: at, evaluationDate: "2026-09-22", evidenceHash: "a".repeat(64), goalDefinitionId: definition.id, goalId,
          goalVersion: 1, metricFacts: [{ key: "synthetic", value: zero }], milestonesCrossed: [], reason: "baseline_established" as const,
          result: calculateGoalProgress({ baselineValue: zero, currentValue: zero, targetValue: high, direction: "increase", evaluationDate: "2026-09-22", previous: null,
            sustainedSuccessDays: 1, verification: "manual_unverified" }),
          sourceReferences: [{ id: goalId, kind: "goal_record" as const, version: 1 }], timeZone: "Asia/Jerusalem" };
        await repo.createProgressForActor(user, progress, randomUUID()); await repo.createProgressForActor(user, progress, progressReceiptKey);
      }
      const names = ["goalDefinitions", "goalProgress", "goalCommandReceipts"];
      const rows = Object.fromEntries(await Promise.all(names.map(async name => [name, await source.database.collection(name).find().sort({ _id: 1 }).toArray()] as const)));
      expect(inspectGoalRecoveryLinks(rows.goalDefinitions!, rows.goalProgress!, rows.goalCommandReceipts!))
        .toEqual({ policy: "goal-recovery-links-v1", releaseAllowed: false, verifiedLinks: 6, missingLinks: 0,
          unreviewedSourceReferences: 2, unreviewedDefinitionReceipts: 2 });
      const before = BSON.serialize(rows); const key = { version: 1, material: randomBytes(32) };
      const records = { ...Object.fromEntries(recoveryCollections.map(name => [name, []])), authUsers: owners.map(_id => ({ _id })), ...rows };
      const artifact = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key); expect(artifact.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(artifact, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(erased, "isolated-test", randomUUID(), now, key)] });
      const restored = goalRepositoryForDatabase(target.database); await restored.ensureIndexes();
      for (const name of names) {
        const surviving = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(surviving);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: rows[name]!.filter(row => row.userId.equals(owners[0]!)) }));
        await expect(target.database.collection(name).insertOne({ ...surviving[0], _id: new ObjectId() })).rejects.toThrow();
      }
      const evidence = await restored.findProgressByIdempotencyKeyForActor(actor, progressReceiptKey);
      const restoredDatabase = target.database;
      const survivingRows = Object.fromEntries(await Promise.all(names.map(async name => [name, await restoredDatabase.collection(name).find().toArray()] as const)));
      expect(inspectGoalRecoveryLinks(survivingRows.goalDefinitions!, survivingRows.goalProgress!, survivingRows.goalCommandReceipts!))
        .toEqual({ policy: "goal-recovery-links-v1", releaseAllowed: false, verifiedLinks: 3, missingLinks: 0,
          unreviewedSourceReferences: 1, unreviewedDefinitionReceipts: 1 });
      expect(evidence?.result.verification).toBe("manual_unverified"); expect(evidence?.result.targetValue.amountMinor).toBe(9007199254740993n);
      expect(await restored.findProgressByIdempotencyKeyForActor(erased, progressReceiptKey)).toBeNull();
      expect(await restored.findLatestDefinitionForActor(erased, goalId)).toBeNull();
      const existing = await restored.findLatestDefinitionForActor(actor, goalId);
      const retry = await restored.createDefinitionVersionForActor(actor, { configuration, expectedDefinitionVersion: 1, goalId, reportedEvidence, targetDate: null }, receiptKey);
      expect(retry.id).toBe(existing?.id); expect(await target.database.collection("goalDefinitions").countDocuments()).toBe(1);
      const after = Object.fromEntries(await Promise.all(names.map(async name => [name, await source.database.collection(name).find().sort({ _id: 1 }).toArray()] as const)));
      expect(BSON.serialize(after)).toEqual(before);
    } finally { try { await target?.dispose(); } finally { await source.dispose(); } }
  }, 30000);
});
