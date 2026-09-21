import { randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import { evaluateNotificationFacts } from "@/lib/domain/notifications/notification-policy";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { quarantineNotifications } from "@/lib/operations/notification-recovery";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated notification replay prevention", () => {
  it("restores history under real indexes without claimable jobs or provider polling references", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const owner = new ObjectId(); const erased = new ObjectId(); const users = [{ _id: owner }, { _id: erased }];
      const actor = { kind: "user" as const, userId: owner.toHexString() };
      const repository = notificationRepositoryForDatabase(source.database, () => new Date(100)); await repository.ensureIndexes();
      for (const user of users) for (const state of ["pending", "deferred", "failed", "sending", "sent", "delivered", "not_requested"]) {
        const candidate = evaluateNotificationFacts([{ kind: "budget", sourceReference: `synthetic-${state}`, sourceVersion: "1", unallocatedMinor: -1n }])[0]!;
        const { notification } = await repository.createForActor({ kind: "user", userId: user._id.toHexString() }, candidate, { state: "pending", notBeforeAt: null });
        // Synthetic isolated historical fixture only, never application/staging state.
        await source.database.collection("notifications").updateOne({ _id: new ObjectId(notification.id) }, { $set: {
          "email.state": state, "email.claimExpiresAt": new Date(200), "email.notBeforeAt": new Date(200),
          "email.providerMessageId": "synthetic-private-delivery-reference" } });
      }
      const rows = await source.database.collection("notifications").find().toArray(); const key = { version: 1, material: randomBytes(32) };
      const records = { ...Object.fromEntries(recoveryCollections.map(name => [name, []])), authUsers: users, notifications: rows };
      const opened = openBackupPackage(createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key), initialRecoverySchemas, "a".repeat(64), key);
      expect(JSON.stringify(opened.notifications)).not.toContain("synthetic-private-delivery-reference");
      const result = quarantineNotifications(opened.notifications!, users, { environment: "isolated-test", keys: [key], now: 1000,
        ledgerReadAt: 1000, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
        receipts: [beginDeletion({ kind: "user", userId: erased.toHexString() }, "isolated-test", randomUUID(), 500, key)] });
      const restored = notificationRepositoryForDatabase(target.database, () => new Date(5000)); await restored.ensureIndexes();
      await target.database.collection("notifications").insertMany(result.preserved);
      expect(await restored.claimReadyEmailForActor(actor)).toBeNull();
      expect(await restored.listForActor({ kind: "user", userId: erased.toHexString() })).toEqual([]);
      expect(await restored.listForActor(actor)).toHaveLength(7);
      expect((await restored.listSentForActor(actor)).every(row => row.email.providerMessageId === null)).toBe(true);
      expect(await source.database.collection("notifications").countDocuments()).toBe(14);
      expect(await source.database.collection("notifications").countDocuments({ "email.state": "pending" })).toBe(2);
      await expect(target.database.collection("notifications").insertOne({ ...result.preserved[0], _id: new ObjectId() })).rejects.toThrow();
      expect(result.releaseAllowed).toBe(false); expect(result.evidence.excluded).toBe(7);
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
