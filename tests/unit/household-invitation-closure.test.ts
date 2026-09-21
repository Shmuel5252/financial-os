import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { inspectHouseholdInvitationClosure, prepareHouseholdInvitationQuarantine } from "@/lib/operations/household-invitation-closure";

function fixture() {
  const owner = new ObjectId(); const member = new ObjectId(); const household = new ObjectId(); const invitation = new ObjectId();
  const common = { createdAt: new Date(0), updatedAt: new Date(0), version: 1, schemaVersion: 1, auditTrail: [] };
  const graph = { authUsers: [{ _id: owner }, { _id: member }], accounts: [], goals: [], householdResourceShares: [],
    households: [{ ...common, _id: household, ownerUserId: owner, name: "SYNTHETIC_SHARED_LABEL", status: "active",
      policyVersion: "household-policy-v1", idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64) }],
    householdMemberships: [{ ...common, _id: new ObjectId(), householdId: household, userId: member,
      activatedByInvitationId: invitation, displayNameSnapshot: "Synthetic", endedAt: null, joinedAt: new Date(0),
      membershipEpoch: 2, status: "active", policyVersion: "household-policy-v1" }] };
  const invitations = [{ ...common, _id: invitation, householdId: household, invitedByUserId: owner,
    acceptedByUserId: member, status: "accepted", expiresAt: new Date(2000), invitationPolicyVersion: "household-invitation-v1" }];
  const key = { version: 1, material: randomBytes(32) };
  const ledger = (subject: ObjectId) => ({ environment: "isolated-test" as const, keys: [key], now: 1000, ledgerReadAt: 1000,
    maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
    receipts: [beginDeletion({ kind: "user", userId: subject.toHexString() }, "isolated-test", randomUUID(), 100, key)] });
  return { graph, invitations, ledger, member, owner };
}

describe("household invitation recovery closure", () => {
  it("accepts historical invitations without inventing current memberships and keeps source BSON unchanged", () => {
    const { graph, invitations, ledger } = fixture(); const history = [...invitations, { ...invitations[0]!, _id: new ObjectId() }];
    const before = BSON.serialize({ graph, history });
    expect(inspectHouseholdInvitationClosure(graph, history).membershipsChecked).toBe(1);
    const result = prepareHouseholdInvitationQuarantine(graph, history, ledger(new ObjectId()));
    expect(result.evidence.freeTextReviewRequired).toBe(false); expect(result.releaseAllowed).toBe(false);
    expect(BSON.serialize({ graph, history })).toEqual(before);
  });
  it("proves closure after erased-member pruning but does not certify surviving free text", () => {
    const { graph, invitations, ledger, member } = fixture();
    const result = prepareHouseholdInvitationQuarantine(graph, invitations, ledger(member));
    expect(result.collections.householdMemberships).toEqual([]); expect(result.collections.householdInvitations).toEqual([]);
    expect(result.collections.households).toHaveLength(1); expect(result.evidence.freeTextReviewRequired).toBe(true);
    expect(JSON.stringify(result.evidence)).not.toContain(member.toHexString());
    expect(JSON.stringify(result.evidence)).not.toContain("SYNTHETIC_SHARED_LABEL");
    expect(result.releaseAllowed).toBe(false);
  });
  it("ends deleted-owner linkage without mutating other owners' canonical input", () => {
    const { graph, invitations, ledger, owner } = fixture(); const before = BSON.serialize(graph);
    const result = prepareHouseholdInvitationQuarantine(graph, invitations, ledger(owner));
    expect(Object.values(result.collections).every(rows => rows.length === 0)).toBe(true);
    expect(BSON.serialize(graph)).toEqual(before);
  });
  it("rejects missing, foreign, duplicate and nonaccepted activation before filtering", () => {
    const { graph, invitations, ledger, owner } = fixture();
    expect(() => prepareHouseholdInvitationQuarantine(graph, [], ledger(owner))).toThrow();
    expect(() => inspectHouseholdInvitationClosure(graph, [{ ...invitations[0], acceptedByUserId: owner }])).toThrow();
    expect(() => inspectHouseholdInvitationClosure(graph, [{ ...invitations[0], status: "pending", acceptedByUserId: null }])).toThrow();
    expect(() => inspectHouseholdInvitationClosure({ ...graph, householdMemberships: [...graph.householdMemberships,
      { ...graph.householdMemberships[0]!, _id: new ObjectId() }] }, invitations)).toThrow();
    expect(() => inspectHouseholdInvitationClosure(graph, [...invitations, invitations[0]!])).toThrow();
    expect(() => prepareHouseholdInvitationQuarantine(graph, invitations, { ...ledger(owner), suppliedRevision: 0 })).toThrow();
  });
});
