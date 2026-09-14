import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { householdRecoverySchemas } from "@/lib/operations/household-recovery-schemas";

const owner = new ObjectId(); const member = new ObjectId(); const household = new ObjectId();
const common = { _id: household, auditTrail: [{ action: "member_left", actorUserId: member,
  at: new Date(0), changedFields: ["status"], resourceId: null, resourceKind: null, revision: 1, targetUserId: member }],
  createdAt: new Date(0), updatedAt: new Date(0), version: 1, policyVersion: "household-policy-v1", schemaVersion: 1 };
const rows = {
  households: { ...common, idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64),
    name: "Synthetic household", ownerUserId: owner, status: "active" },
  householdMemberships: { ...common, _id: new ObjectId(), activatedByInvitationId: new ObjectId(),
    displayNameSnapshot: "Synthetic member", endedAt: null, householdId: household, joinedAt: new Date(0),
    membershipEpoch: 1, status: "active", userId: member },
  householdResourceShares: { ...common, _id: new ObjectId(), householdId: household, ownerMembershipEpoch: 1,
    ownerUserId: member, resourceId: new ObjectId(), resourceKind: "account", status: "shared" },
};
describe("household quarantine adapters", () => {
  it.each(Object.entries(rows))("preserves %s BSON and multi-subject evidence without mutating input", (name, row) => {
    const before = BSON.serialize(row); const project = householdRecoverySchemas[name as keyof typeof householdRecoverySchemas]!.project;
    expect(BSON.serialize(project(row))).toEqual(before);
    expect(BSON.serialize(project(project(row)))).toEqual(before);
    expect(BSON.serialize(row)).toEqual(before);
  });
  it.each(Object.entries(rows))("rejects unreviewed fields/schema/identity for %s", (name, row) => {
    const project = householdRecoverySchemas[name as keyof typeof householdRecoverySchemas]!.project;
    for (const altered of [{ ...row, unexpected: "unreviewed" }, { ...row, schemaVersion: 2 },
      { ...row, _id: "foreign" }, { ...row, auditTrail: [{ ...common.auditTrail[0], extra: "unreviewed" }] },
      { ...row, auditTrail: [{ ...common.auditTrail[0], sessionToken: "SYNTHETIC_NOT_A_TOKEN" }] }])
      expect(() => project(altered)).toThrow();
  });
  it("does not silently accept invitations or claim their token-free replay safety", () => {
    expect(householdRecoverySchemas.householdInvitations).toBeUndefined();
  });
});
