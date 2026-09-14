import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { beginDeletion, completeLocalDeletion, restorationDisposition } from "@/lib/operations/deletion-ledger";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { decryptRecoveryBson, encryptRecoveryBson } from "@/lib/operations/recovery-envelope";
import { projectAuthLink } from "@/lib/operations/recovery-plan";

const uri = process.env.MONGODB_TEST_URI;
const realMongo = uri ? describe : describe.skip;
realMongo("real isolated recovery primitives, NOT full 52-collection restore acceptance", () => {
  it("retains suppression through local partial deletion/retry and filters a synthetic BSON restoration", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    const ledger = await createIsolatedRecoveryTarget(uri!);
    const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const key = { version: 1, material: randomBytes(32) };
      const encryptionKey = { version: 1, material: randomBytes(32) };
      const erased = new ObjectId(); const survivor = new ObjectId();
      const actor = { kind: "user" as const, userId: erased.toHexString() };
      const documents = [
        { _id: new ObjectId(), userId: erased, balance: Long.fromString("9007199254740993"), currency: "ILS" },
        { _id: new ObjectId(), userId: survivor, balance: Long.fromString("-9007199254740993"), currency: "ILS" },
      ];
      await source.database.collection("accounts").insertMany(documents);
      const before = await source.database.collection("accounts").find().sort({ _id: 1 }).toArray();
      const manifest = "a".repeat(64);
      const envelope = encryptRecoveryBson(BSON.serialize({ documents: before }), "accounts", manifest, encryptionKey);
      const receipt = beginDeletion(actor, "isolated-test", randomUUID(), 1000, key);
      // Independent fixture DB, not included in the old encrypted artifact.
      const suppression = ledger.database.collection<{ _id: string; receipt: typeof receipt }>("suppression");
      await suppression.insertOne({ _id: receipt.subject, receipt });
      // Partial operation: suppression remains durable BEFORE any deletion; no claimed local completion.
      const saved = (await suppression.findOne({ _id: receipt.subject }))!.receipt;
      const evidence = { receipts: [saved], environment: "isolated-test" as const, keys: [key], now: 1010,
        ledgerReadAt: 1010, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1 };
      expect(restorationDisposition({ ...evidence, ownerId: actor.userId, contributingSubjectIds: [] })).toBe("exclude-owner");
      expect(() => completeLocalDeletion(saved, { kind: "user", userId: survivor.toHexString() }, "isolated-test", 1010, key)).toThrow();
      // Explicitly test-only scoped delete, NOT the application full-account deletion workflow.
      await source.database.collection("accounts").deleteMany({ userId: erased });
      expect((await source.database.collection("accounts").deleteMany({ userId: erased })).deletedCount).toBe(0);
      const decoded = BSON.deserialize(decryptRecoveryBson(envelope, manifest, encryptionKey), { promoteLongs: false });
      for (const row of decoded.documents) {
        if (restorationDisposition({ ...evidence, ownerId: row.userId.toHexString(), contributingSubjectIds: [] }) === "preserve")
          await target.database.collection("accounts").insertOne(row);
      }
      const restored = await target.database.collection("accounts").find().toArray();
      expect(restored).toHaveLength(1);
      expect(BSON.serialize(restored[0]!)).toEqual(BSON.serialize(documents[1]!));
      expect(restored[0]!.balance.toString()).toBe("-9007199254740993");
      expect(restorationDisposition({ ...evidence, ownerId: survivor.toHexString(), contributingSubjectIds: [actor.userId] })).toBe("redact-shared-before-release");
      const link = projectAuthLink({ _id: new ObjectId(), userId: survivor, provider: "google", providerAccountId: "synthetic-subject", type: "oauth", access_token: "SYNTHETIC_NOT_A_TOKEN" });
      await target.database.collection("authAccounts").insertOne(link);
      expect(Object.keys((await target.database.collection("authAccounts").findOne())!)).not.toContain("access_token");
      expect(await target.database.collection("authSessions").countDocuments()).toBe(0);
      expect(await source.database.collection("accounts").countDocuments({ userId: survivor })).toBe(1);
    } finally {
      await target.dispose(); await ledger.dispose(); await source.dispose();
    }
  }, 30000);
});
