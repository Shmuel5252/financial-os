import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { filterHouseholdDeletionQuarantine } from "@/lib/operations/household-deletion-quarantine";
import { householdRepositoryForDatabase } from "@/lib/households/household-repository";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated shared erasure transform", () => {
  it("restores survivor sharing metadata without deleted-member audit or finance corruption", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const owner = new ObjectId(); const member = new ObjectId(); const household = new ObjectId();
      const accounts = [{ _id: new ObjectId(), userId: owner, amount: Long.fromString("9007199254740993") },
        { _id: new ObjectId(), userId: member, amount: Long.fromString("200") }];
      const common = { createdAt: new Date(0), updatedAt: new Date(0), version: 1, schemaVersion: 1,
        policyVersion: "household-policy-v1", auditTrail: [] };
      await source.database.collection("authUsers").insertMany([{ _id: owner }, { _id: member }]);
      await source.database.collection("accounts").insertMany(accounts);
      await source.database.collection("households").insertOne({ ...common, _id: household, ownerUserId: owner,
        name: "Synthetic household", status: "active", idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64),
        auditTrail: [{ action: "member_left", actorUserId: member, targetUserId: member, resourceId: null,
          resourceKind: null, changedFields: ["status"], revision: 1, at: new Date(0) }] });
      await source.database.collection("householdMemberships").insertOne({ ...common, _id: new ObjectId(), householdId: household,
        userId: member, activatedByInvitationId: new ObjectId(), displayNameSnapshot: "Synthetic member", endedAt: null,
        joinedAt: new Date(0), membershipEpoch: 1, status: "active" });
      const graph = { authUsers: await source.database.collection("authUsers").find().toArray(),
        accounts: await source.database.collection("accounts").find().toArray(), goals: [],
        households: await source.database.collection("households").find().toArray(),
        householdMemberships: await source.database.collection("householdMemberships").find().toArray(), householdResourceShares: [] };
      const key = { version: 1, material: randomBytes(32) };
      const receipt = beginDeletion({ kind: "user", userId: member.toHexString() }, "isolated-test", randomUUID(), 100, key);
      const result = filterHouseholdDeletionQuarantine(graph, { receipts: [receipt], environment: "isolated-test", keys: [key],
        now: 1000, ledgerReadAt: 1000, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1 });
      await householdRepositoryForDatabase(target.database).ensureIndexes();
      for (const [name, rows] of Object.entries(result.collections)) if (rows.length) await target.database.collection(name).insertMany(rows);
      await target.database.collection("accounts").insertOne(graph.accounts.find(row => row.userId.equals(owner))!);
      const restored = await target.database.collection("households").findOne();
      expect(restored!.auditTrail).toEqual([]); expect(restored!.ownerUserId).toEqual(owner);
      expect(await target.database.collection("householdMemberships").countDocuments()).toBe(0);
      expect(BSON.serialize((await target.database.collection("accounts").findOne())!)).toEqual(BSON.serialize(accounts[0]!));
      expect(await source.database.collection("accounts").countDocuments()).toBe(2);
      expect((await source.database.collection("households").findOne())!.auditTrail).toHaveLength(1);
      expect(JSON.stringify(result.collections)).not.toContain(member.toHexString());
      expect(result.releaseAllowed).toBe(false);
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
