import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { filterInvitationDeletionQuarantine } from "@/lib/operations/invitation-deletion-quarantine";

function fixture() {
  const owner = new ObjectId(); const member = new ObjectId(); const household = new ObjectId();
  const graph = { authUsers: [{ _id: owner }, { _id: member }], accounts: [], goals: [], householdMemberships: [], householdResourceShares: [],
    households: [{ _id: household, ownerUserId: owner, name: "Synthetic", status: "active", auditTrail: [], createdAt: new Date(0), updatedAt: new Date(0),
      version: 1, schemaVersion: 1, policyVersion: "household-policy-v1", idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64) }] };
  const common = { householdId: household, invitedByUserId: owner, createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date(2000),
    version: 1, schemaVersion: 1, invitationPolicyVersion: "household-invitation-v1", tokenHash: "b".repeat(64),
    inviteeEmailHash: "a".repeat(64), inviteeHint: "SYNTHETIC_PRIVATE_RECIPIENT", auditTrail: [] };
  const rows = [{ ...common, _id: new ObjectId(), acceptedByUserId: member, status: "accepted" },
    { ...common, _id: new ObjectId(), acceptedByUserId: null, status: "pending" }];
  const key = { version: 1, material: randomBytes(32) };
  const ledger = (subject: ObjectId) => ({ environment: "isolated-test" as const, keys: [key], now: 1000, ledgerReadAt: 1000,
    maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
    receipts: [beginDeletion({ kind: "user", userId: subject.toHexString() }, "isolated-test", randomUUID(), 100, key)] });
  return { graph, rows, ledger, owner, member };
}
describe("invitation deletion quarantine", () => {
  it("excludes erased registered invitees and strips unregistered recipient data without altering source", () => {
    const { graph, rows, ledger, member } = fixture(); const before = BSON.serialize({ rows });
    const result = filterInvitationDeletionQuarantine(rows, graph, ledger(member));
    expect(result.preserved).toHaveLength(1); expect(result.preserved[0]!.acceptedByUserId).toBeNull();
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_RECIPIENT"); expect(JSON.stringify(result)).not.toContain(member.toHexString());
    expect(result.evidence.excluded).toBe(1); expect(result.releaseAllowed).toBe(false);
    expect(BSON.serialize({ rows })).toEqual(before);
  });
  it("removes a deleted owner's invitations and rejects foreign issuers, duplicates and stale state", () => {
    const { graph, rows, ledger, owner, member } = fixture();
    expect(filterInvitationDeletionQuarantine(rows, graph, ledger(owner)).preserved).toEqual([]);
    expect(() => filterInvitationDeletionQuarantine([{ ...rows[0], invitedByUserId: member }], graph, ledger(owner))).toThrow();
    expect(() => filterInvitationDeletionQuarantine([...rows, rows[0]!], graph, ledger(owner))).toThrow();
    expect(() => filterInvitationDeletionQuarantine(rows, graph, { ...ledger(owner), suppliedRevision: 0 })).toThrow();
  });
});
