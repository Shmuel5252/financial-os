import { randomBytes } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { projectRecoveryNotificationPreference, quarantineNotificationPreferences } from "@/lib/operations/notification-preference-recovery";

function fixture() {
  const owner = new ObjectId();
  const row = { _id: new ObjectId(), userId: owner, version: 1, schemaVersion: 1, createdAt: new Date(0), updatedAt: new Date(0),
    auditTrail: [{ action: "created", actorUserId: owner, at: new Date(0), changedFields: ["emailEnabled"], revision: 1 }],
    emailEnabled: true, inAppEnabled: true, quietHours: { enabled: true, startHour: 22, endHour: 8 } };
  const ledger = { environment: "isolated-test" as const, keys: [{ version: 1, material: randomBytes(32) }], now: 1000, ledgerReadAt: 1000,
    maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1, receipts: [] };
  return { row, ledger, users: [{ _id: owner }] };
}
describe("notification preference recovery", () => {
  it("keeps source consent/audit immutable but disables email in quarantine with separate bounded evidence", () => {
    const { row, ledger, users } = fixture(); const before = BSON.serialize(row);
    expect(projectRecoveryNotificationPreference(row)).toBe(row);
    const result = quarantineNotificationPreferences([row], users, ledger);
    expect(result.preserved[0]!.emailEnabled).toBe(false); expect(result.preserved[0]!.version).toBe(2);
    expect(result.preserved[0]!.auditTrail).toEqual(row.auditTrail); expect(result.evidence.emailDisabled).toBe(1);
    expect(result.releaseAllowed).toBe(false); expect(JSON.stringify(result.evidence)).not.toContain(row.userId.toHexString());
    expect(BSON.serialize(row)).toEqual(before);
    expect(quarantineNotificationPreferences(result.preserved, users, ledger).preserved).toEqual(result.preserved);
  });
  it("rejects unknown nested data, foreign audit, duplicate/unknown ownership and unsafe clocks", () => {
    const { row, ledger, users } = fixture();
    expect(() => projectRecoveryNotificationPreference({ ...row, extra: "SYNTHETIC_PRIVATE_FIELD" })).toThrow();
    expect(() => projectRecoveryNotificationPreference({ ...row, quietHours: { ...row.quietHours, extra: true } })).toThrow();
    expect(() => projectRecoveryNotificationPreference({ ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] })).toThrow();
    expect(() => quarantineNotificationPreferences([row, { ...row, _id: new ObjectId() }], users, ledger)).toThrow();
    expect(() => quarantineNotificationPreferences([row], [], ledger)).toThrow();
    expect(() => quarantineNotificationPreferences([row], users, { ...ledger, now: -1 })).toThrow();
    expect(() => quarantineNotificationPreferences([{ ...row, version: Number.MAX_SAFE_INTEGER }], users, ledger)).toThrow();
    expect(() => quarantineNotificationPreferences([], users, { ...ledger, suppliedRevision: 0 })).toThrow();
  });
});
