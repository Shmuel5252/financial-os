import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { filterHouseholdDeletionQuarantine } from "@/lib/operations/household-deletion-quarantine";

function fixture() {
  const owner = new ObjectId(); const member = new ObjectId(); const account = new ObjectId(); const household = new ObjectId();
  const common = { createdAt: new Date(0), updatedAt: new Date(0), version: 1, policyVersion: "household-policy-v1", schemaVersion: 1, auditTrail: [] };
  const graph = { authUsers: [{ _id: owner }, { _id: member }], accounts: [{ _id: account, userId: member }], goals: [],
    households: [{ ...common, _id: household, ownerUserId: owner, name: "Synthetic household", status: "active",
      idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64), auditTrail: [{ action: "resource_shared",
        actorUserId: member, targetUserId: null, resourceId: account, resourceKind: "account", at: new Date(0), changedFields: ["status"], revision: 1 }] }],
    householdMemberships: [{ ...common, _id: new ObjectId(), householdId: household, userId: member,
      activatedByInvitationId: new ObjectId(), displayNameSnapshot: "Synthetic member", endedAt: null, joinedAt: new Date(0), membershipEpoch: 1, status: "active" }],
    householdResourceShares: [{ ...common, _id: new ObjectId(), householdId: household, ownerUserId: member,
      ownerMembershipEpoch: 1, resourceId: account, resourceKind: "account", status: "shared" }] };
  const key = { version: 1, material: randomBytes(32) };
  const ledger = (id: ObjectId) => ({ environment: "isolated-test" as const, keys: [key], now: 1000,
    ledgerReadAt: 1000, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
    receipts: [beginDeletion({ kind: "user", userId: id.toHexString() }, "isolated-test", randomUUID(), 100, key)] });
  return { graph, ledger, owner, member };
}
describe("partial household deletion quarantine", () => {
  it("removes erased member linkage and their audit content, not the surviving household or source truth", () => {
    const { graph, ledger, member } = fixture(); const before = BSON.serialize(graph);
    const context = ledger(member); const result = filterHouseholdDeletionQuarantine(graph, context);
    expect(result.collections.households).toHaveLength(1);
    expect(result.collections.households[0]!.auditTrail).toEqual([]);
    expect(result.collections.households[0]!.version).toBe(2);
    expect(result.collections.householdMemberships).toEqual([]); expect(result.collections.householdResourceShares).toEqual([]);
    expect(result.evidence.redactedAuditEvents).toBe(1); expect(result.releaseAllowed).toBe(false);
    expect(JSON.stringify(result.evidence)).not.toContain(member.toHexString());
    expect(BSON.serialize(graph)).toEqual(before);
    expect(filterHouseholdDeletionQuarantine(graph, context)).toEqual(result);
  });
  it("ends a deleted owner's sharing without deleting another member's independent financial input", () => {
    const { graph, ledger, owner } = fixture(); const before = BSON.serialize(graph.accounts[0]!);
    const result = filterHouseholdDeletionQuarantine(graph, ledger(owner));
    expect(Object.values(result.collections).every(rows => rows.length === 0)).toBe(true);
    expect(BSON.serialize(graph.accounts[0]!)).toEqual(before);
  });
  it("preserves unrelated subjects byte-for-byte and rejects stale ledger or forged ownership", () => {
    const { graph, ledger, owner } = fixture(); const result = filterHouseholdDeletionQuarantine(graph, ledger(new ObjectId()));
    expect(BSON.serialize(result.collections.households[0]!)).toEqual(BSON.serialize(graph.households[0]!));
    expect(() => filterHouseholdDeletionQuarantine(graph, { ...ledger(owner), suppliedRevision: 0 })).toThrow();
    graph.householdResourceShares[0]!.ownerUserId = owner;
    expect(() => filterHouseholdDeletionQuarantine(graph, ledger(owner))).toThrow();
  });
});
