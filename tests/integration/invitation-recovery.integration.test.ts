import { createHash, randomBytes } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { householdRepositoryForDatabase } from "@/lib/households/household-repository";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { materializeInertRecoveryInvitation } from "@/lib/operations/invitation-recovery";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated invitation recovery indexes and replay prevention", () => {
  it("restores multiple inert rows under actual unique indexes without accepting any old token", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const repository = householdRepositoryForDatabase(source.database);
      const restored = householdRepositoryForDatabase(target.database);
      await repository.ensureIndexes(); await restored.ensureIndexes();
      const tokens = ["SYNTHETIC_INVITATION_ONE", "SYNTHETIC_INVITATION_TWO"];
      for (const token of tokens) await repository.createInvitation({ householdId: new ObjectId().toHexString(),
        invitedByUserId: new ObjectId().toHexString(), inviteeEmailHash: "a".repeat(64), inviteeHint: "synthetic",
        expiresAt: new Date(Date.now() + 60000), tokenHash: createHash("sha256").update(token).digest("hex") });
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      records.householdInvitations = await source.database.collection("householdInvitations").find().toArray();
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const opened = openBackupPackage(createBackupPackage(records, initialRecoverySchemas, digest, key), initialRecoverySchemas, digest, key);
      for (const row of opened.householdInvitations!) {
        expect(row).not.toHaveProperty("tokenHash");
        await target.database.collection("householdInvitations").insertOne(materializeInertRecoveryInvitation(row, new Date()));
      }
      expect(await target.database.collection("householdInvitations").countDocuments({ status: "revoked" })).toBe(2);
      expect(await target.database.collection("householdInvitations").countDocuments({ activeInviteKey: { $exists: true } })).toBe(0);
      for (const token of tokens) {
        const hash = createHash("sha256").update(token).digest("hex");
        expect(await repository.findInvitationByTokenHash(hash)).not.toBeNull();
        expect(await restored.findInvitationByTokenHash(hash)).toBeNull();
      }
      // Parallel index creation has no stable list order; compare complete definitions by name.
      const actualIndexes = await target.database.collection("householdInvitations").listIndexes().toArray();
      const expectedIndexes = await source.database.collection("householdInvitations").listIndexes().toArray();
      expect(actualIndexes.sort((a, b) => a.name!.localeCompare(b.name!)))
        .toEqual(expectedIndexes.sort((a, b) => a.name!.localeCompare(b.name!)));
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
