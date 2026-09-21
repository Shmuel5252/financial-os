import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { evaluateNotificationFacts } from "@/lib/domain/notifications/notification-policy";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { projectRecoveryNotification, quarantineNotifications } from "@/lib/operations/notification-recovery";

function fixture() {
  const owner = new ObjectId(); const key = { version: 1, material: randomBytes(32) };
  const row = { ...evaluateNotificationFacts([{ kind: "budget", sourceReference: "synthetic-budget", sourceVersion: "1", unallocatedMinor: -1n }])[0]!,
    _id: new ObjectId(), userId: owner, createdAt: new Date(0), updatedAt: new Date(0), version: 1, schemaVersion: 1, inAppState: "unread",
    auditTrail: [{ action: "created", actorUserId: owner, at: new Date(0), revision: 1 }], email: { state: "pending", acceptedAt: null,
      attempts: 0, claimExpiresAt: null, deliveredAt: null, errorCategory: null, notBeforeAt: null, providerMessageId: "synthetic-delivery-reference" } };
  const ledger = { environment: "isolated-test" as const, keys: [key], now: 1000, ledgerReadAt: 1000, maxLedgerAgeMs: 0,
    authoritativeRevision: 1, suppliedRevision: 1, receipts: [] };
  return { row, owner, key, ledger, users: [{ _id: owner }] };
}
describe("notification recovery replay boundary", () => {
  it("disables every claimable state and strips provider polling references without mutating source", () => {
    const { row, users, ledger } = fixture(); const before = BSON.serialize(row);
    expect(projectRecoveryNotification(row).email).not.toHaveProperty("providerMessageId");
    for (const state of ["pending", "deferred", "failed", "sending"]) {
      const result = quarantineNotifications([{ ...row, email: { ...row.email, state, claimExpiresAt: new Date(10), notBeforeAt: new Date(10) } }], users, ledger);
      expect(result.preserved[0]!.email).toMatchObject({ state: "not_requested", providerMessageId: null, claimExpiresAt: null, notBeforeAt: null });
      expect(result.preserved[0]!.auditTrail).toEqual(row.auditTrail); expect(result.preserved[0]!.version).toBe(2);
      expect(result.releaseAllowed).toBe(false); expect(result.evidence.replayDisabled).toBe(1);
      expect(quarantineNotifications(result.preserved, users, ledger).preserved).toEqual(result.preserved);
    }
    expect(BSON.serialize(row)).toEqual(before);
  });
  it("preserves terminal history, suppresses erased ownership and returns no identifiers in evidence", () => {
    const { row, owner, key, users, ledger } = fixture();
    for (const state of ["sent", "delivered", "not_requested"]) {
      const result = quarantineNotifications([{ ...row, email: { ...row.email, state } }], users, ledger);
      expect(result.preserved[0]!.email.state).toBe(state); expect(result.preserved[0]!.email.providerMessageId).toBeNull();
      expect(JSON.stringify(result.evidence)).not.toContain(owner.toHexString());
    }
    expect(quarantineNotifications([row], users, { ...ledger,
      receipts: [beginDeletion({ kind: "user", userId: owner.toHexString() }, "isolated-test", randomUUID(), 100, key)] }).preserved).toEqual([]);
  });
  it("fails closed on unknown fields/errors, foreign audit, duplicates and stale state", () => {
    const { row, users, ledger } = fixture();
    expect(() => projectRecoveryNotification({ ...row, extra: true })).toThrow();
    expect(() => projectRecoveryNotification({ ...row, email: { ...row.email, extra: true } })).toThrow();
    expect(() => projectRecoveryNotification({ ...row, email: { ...row.email, errorCategory: "SYNTHETIC_PRIVATE_RESPONSE" } })).toThrow();
    expect(() => projectRecoveryNotification({ ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] })).toThrow();
    expect(() => quarantineNotifications([row], [], ledger)).toThrow();
    expect(() => quarantineNotifications([row, { ...row, _id: new ObjectId() }], users, ledger)).toThrow();
    expect(() => quarantineNotifications([], users, { ...ledger, suppliedRevision: 0 })).toThrow();
    expect(() => quarantineNotifications([{ ...row, version: Number.MAX_SAFE_INTEGER }], users, ledger)).toThrow();
  });
});
