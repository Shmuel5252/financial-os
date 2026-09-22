import { BSON, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { evaluateNotificationFacts } from "@/lib/domain/notifications/notification-policy";
import { inspectNotificationRecoverySources as inspect } from "@/lib/operations/notification-recovery";
function fixture() {
  const owner = new ObjectId(); const sourceId = new ObjectId();
  const row = { ...evaluateNotificationFacts([{ kind: "budget", sourceReference: sourceId.toHexString(), sourceVersion: "2/2026-09", unallocatedMinor: -1n }])[0]!,
    _id: new ObjectId(), userId: owner, createdAt: new Date("2026-09-22T00:00:00Z"), updatedAt: new Date("2026-09-22T00:00:00Z"),
    version: 1, schemaVersion: 1, inAppState: "unread", auditTrail: [], email: { state: "not_requested", acceptedAt: null,
      attempts: 0, claimExpiresAt: null, deliveredAt: null, errorCategory: null, notBeforeAt: null } };
  const sources = { budgetPeriods: [{ _id: sourceId, userId: owner, version: 2, calendarMonth: "2026-09" }], forecastSnapshots: [], goalProgress: [] };
  return { owner, sourceId, row, sources };
}
describe("notification source reference recovery", () => {
  it("matches exact owner/version without mutating BSON or claiming financial recomputation", () => {
    const { row, sources } = fixture(); const before = BSON.serialize({ row, sources });
    expect(inspect([row], sources)).toEqual({ releaseAllowed: false, policy: "notification-source-review-v1", matched: 1,
      unresolved: { missing: 0, changedVersion: 0, unsavedBudget: 0 } });
    expect(BSON.serialize({ row, sources })).toEqual(before);
  });
  it("does not substitute a current or missing budget for historical notification evidence", () => {
    const { row, sources } = fixture();
    expect(inspect([row], { ...sources, budgetPeriods: [] })?.unresolved).toEqual({ missing: 1, changedVersion: 0, unsavedBudget: 0 });
    expect(inspect([row], { ...sources, budgetPeriods: [{ ...sources.budgetPeriods[0], version: 3 }] })?.unresolved)
      .toEqual({ missing: 0, changedVersion: 1, unsavedBudget: 0 });
    expect(inspect([{ ...row, sourceReference: "period:2026-09", sourceVersion: "0/2026-09" }], sources)?.unresolved)
      .toEqual({ missing: 0, changedVersion: 0, unsavedBudget: 1 });
  });
  it("refuses foreign-owner and ambiguous source identities with bounded errors", () => {
    const { row, sources } = fixture();
    expect(() => inspect([row], { ...sources, budgetPeriods: [{ ...sources.budgetPeriods[0], userId: new ObjectId() }] })).toThrow("Notification source recovery requires review");
    expect(() => inspect([row], { ...sources, budgetPeriods: [...sources.budgetPeriods, sources.budgetPeriods[0]!] })).toThrow();
    expect(() => inspect([{ ...row, sourceReference: "period:2026-99" }], sources)).toThrow();
  });
  it("compares forecast and goal evidence by the exact version/time contract", () => {
    const { row, owner, sourceId } = fixture(); const at = new Date("2026-09-21T00:00:00Z");
    const sources = { budgetPeriods: [], forecastSnapshots: [{ _id: sourceId, userId: owner, calculatedAt: at,
      result: { engineVersion: "forecast/1", policyVersion: "forecast-policy/1" } }],
      goalProgress: [{ _id: sourceId, userId: owner, evaluatedAt: at, engineVersion: "goal/1", policyVersion: "goal-policy/1" }] };
    const rows = [{ ...row, sourceKind: "forecast", sourceVersion: "forecast/1/forecast-policy/1/2026-09-21T00:00:00.000Z" },
      { ...row, _id: new ObjectId(), sourceKind: "goal_progress", sourceVersion: "goal/1/goal-policy/1/2026-09-21T00:00:00.000Z" }];
    expect(inspect(rows, sources)?.matched).toBe(2);
    expect(() => inspect([row, row], { budgetPeriods: [], forecastSnapshots: [], goalProgress: [] })).toThrow();
  });
});
