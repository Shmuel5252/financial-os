import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { quarantineNotificationPreferences } from "@/lib/operations/notification-preference-recovery";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated notification preference recovery", () => {
  it("roundtrips actual repository BSON, excludes erased consent and restores survivors with email disabled", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const owner = new ObjectId(); const erased = new ObjectId(); const users = [{ _id: owner }, { _id: erased }];
      const repository = notificationRepositoryForDatabase(source.database, () => new Date(100));
      await repository.ensureIndexes();
      for (const user of users) await repository.savePreferencesForActor({ kind: "user", userId: user._id.toHexString() },
        { emailEnabled: true, inAppEnabled: true, expectedVersion: null, quietHours: { enabled: true, startHour: 22, endHour: 8 } });
      const rows = await source.database.collection("notificationPreferences").find().toArray();
      const key = { version: 1, material: randomBytes(32) };
      const records = { ...Object.fromEntries(recoveryCollections.map(name => [name, []])), authUsers: users, notificationPreferences: rows };
      const artifact = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      const opened = openBackupPackage(artifact, initialRecoverySchemas, "a".repeat(64), key);
      expect(BSON.serialize({ rows: opened.notificationPreferences })).toEqual(BSON.serialize({ rows }));
      const result = quarantineNotificationPreferences(opened.notificationPreferences!, users, { environment: "isolated-test", keys: [key],
        now: 1000, ledgerReadAt: 1000, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
        receipts: [beginDeletion({ kind: "user", userId: erased.toHexString() }, "isolated-test", randomUUID(), 500, key)] });
      const restored = notificationRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await target.database.collection("notificationPreferences").insertMany(result.preserved);
      expect(await restored.findPreferencesForActor({ kind: "user", userId: erased.toHexString() })).toBeNull();
      const survivor = await restored.findPreferencesForActor({ kind: "user", userId: owner.toHexString() });
      expect(survivor!.emailEnabled).toBe(false); expect(survivor!.inAppEnabled).toBe(true); expect(survivor!.version).toBe(2);
      expect(await restored.claimReadyEmailForActor({ kind: "user", userId: owner.toHexString() })).toBeNull();
      expect(result.evidence.excluded).toBe(1); expect(result.releaseAllowed).toBe(false);
      expect(await source.database.collection("notificationPreferences").countDocuments({ emailEnabled: true })).toBe(2);
      await expect(target.database.collection("notificationPreferences").insertOne({ ...result.preserved[0], _id: new ObjectId() })).rejects.toThrow();
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
