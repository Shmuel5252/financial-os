import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { inspectHouseholdRecoveryReferences } from "@/lib/operations/household-recovery-references";

function fixture() {
  const owner = new ObjectId(); const member = new ObjectId(); const account = new ObjectId(); const household = new ObjectId();
  const metadata = { createdAt: new Date(0), updatedAt: new Date(0), version: 1,
    policyVersion: "household-policy-v1", schemaVersion: 1, auditTrail: [] };
  return { authUsers: [{ _id: owner }, { _id: member }], accounts: [{ _id: account, userId: member }], goals: [],
    households: [{ ...metadata, _id: household, ownerUserId: owner, name: "Synthetic",
      idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64), status: "active",
      auditTrail: [{ action: "resource_shared", actorUserId: member, targetUserId: null, at: new Date(0),
        changedFields: ["status"], resourceId: account, resourceKind: "account", revision: 1 }] }],
    householdMemberships: [{ ...metadata, _id: new ObjectId(), householdId: household, userId: member,
      activatedByInvitationId: new ObjectId(), displayNameSnapshot: "Synthetic", endedAt: null,
      joinedAt: new Date(0), membershipEpoch: 1, status: "active" }],
    householdResourceShares: [{ ...metadata, _id: new ObjectId(), householdId: household, ownerUserId: member,
      ownerMembershipEpoch: 1, resourceKind: "account", resourceId: account, status: "shared" }] };
}
describe("private household quarantine reference analysis", () => {
  it("includes household owner, member and audit resource owner without modifying canonical data", () => {
    const input = fixture(); const before = JSON.stringify(input);
    const result = inspectHouseholdRecoveryReferences(input);
    expect(result.releaseAllowed).toBe(false);
    for (const row of result.records) expect(row.contributingSubjectIds).toEqual(input.authUsers.map(u => u._id.toHexString()).sort());
    expect(JSON.stringify(input)).toBe(before);
  });
  it("rejects foreign ownership instead of accepting the share's asserted identity", () => {
    const input = fixture(); input.householdResourceShares[0]!.ownerUserId = input.authUsers[0]!._id;
    expect(() => inspectHouseholdRecoveryReferences(input)).toThrow("Recovery references require review");
  });
  it("fails closed on missing subjects/resources/households and duplicate identities", () => {
    for (const mutate of [
      (x: ReturnType<typeof fixture>) => { x.authUsers.pop(); },
      (x: ReturnType<typeof fixture>) => { x.accounts.pop(); },
      (x: ReturnType<typeof fixture>) => { x.households.pop(); },
      (x: ReturnType<typeof fixture>) => { x.accounts.push(x.accounts[0]!); },
      (x: ReturnType<typeof fixture>) => { x.householdMemberships.push(x.householdMemberships[0]!); },
    ]) { const input = fixture(); mutate(input); expect(() => inspectHouseholdRecoveryReferences(input)).toThrow(); }
  });
});
