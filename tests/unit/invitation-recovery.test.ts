import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { materializeInertRecoveryInvitation, projectRecoveryInvitation } from "@/lib/operations/invitation-recovery";

function fixture() { return { _id: new ObjectId(), householdId: new ObjectId(), acceptedByUserId: null,
  invitedByUserId: new ObjectId(), auditTrail: [], createdAt: new Date(0), updatedAt: new Date(0),
  expiresAt: new Date(1000), invitationPolicyVersion: "household-invitation-v1", schemaVersion: 1,
  inviteeEmailHash: "a".repeat(64), inviteeHint: "synthetic", status: "pending", version: 1, tokenHash: "b".repeat(64) }; }
describe("token-free invitation recovery", () => {
  it("filters verifier and active lookup key without mutating source or history", () => {
    const row = fixture(); const source = { ...row, activeInviteKey: `${row.householdId.toHexString()}:${row.inviteeEmailHash}` };
    const before = JSON.stringify(source); const filtered = projectRecoveryInvitation(source);
    expect(filtered).not.toHaveProperty("tokenHash"); expect(filtered).not.toHaveProperty("activeInviteKey");
    expect(projectRecoveryInvitation(filtered)).toEqual(filtered); expect(JSON.stringify(source)).toBe(before);
  });
  it("revokes pending invitations and generates unique non-hash markers without credentials", () => {
    const row = fixture(); const filtered = projectRecoveryInvitation(row);
    const result = materializeInertRecoveryInvitation(filtered, new Date(500));
    expect(result.status).toBe("revoked"); expect(result.version).toBe(2);
    expect(result.tokenHash).not.toMatch(/^[a-f0-9]{64}$/);
    expect(result.auditTrail).toHaveLength(1); expect(result.auditTrail[0].actorUserId).toBeNull();
    expect(materializeInertRecoveryInvitation(filtered, new Date(500))).toEqual(result);
    const again = materializeInertRecoveryInvitation(projectRecoveryInvitation(result), new Date(600));
    expect(again).toEqual(result);
    expect(filtered.status).toBe("pending");
  });
  it("preserves accepted history while making its old verifier unavailable", () => {
    const row = { ...fixture(), status: "accepted", acceptedByUserId: new ObjectId() };
    const result = materializeInertRecoveryInvitation(projectRecoveryInvitation(row), new Date(500));
    expect(result.status).toBe("accepted"); expect(result.acceptedByUserId).toEqual(row.acceptedByUserId);
    expect(result.version).toBe(1); expect(result.tokenHash).not.toBe(row.tokenHash);
  });
  it("rejects unknown sensitive fields, mismatched keys, nonfiltered input and invalid clocks", () => {
    const row = fixture();
    for (const altered of [{ ...row, sessionToken: "SYNTHETIC_NOT_A_TOKEN" }, { ...row, tokenHash: "invalid" },
      { ...row, activeInviteKey: "mismatch" }, { ...row, auditTrail: [{ unexpected: true }] }])
      expect(() => projectRecoveryInvitation(altered)).toThrow();
    expect(() => materializeInertRecoveryInvitation(row, new Date(500))).toThrow();
    expect(() => materializeInertRecoveryInvitation(projectRecoveryInvitation(row), new Date(-1))).toThrow();
  });
});
