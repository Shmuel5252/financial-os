import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

function fixture(): Document {
  const owner = new ObjectId(); const at = new Date("2026-09-22T00:00:00Z");
  const allocations = [{ categoryId: "system:food", amount: { amountMinor: Long.fromString("9007199254740993"), currency: "ILS" } }];
  return { _id: new ObjectId(), userId: owner, allocations, carryIn: [], calendarMonth: "2026-09", currency: "ILS",
    closedAt: null, closingSnapshot: null, createdAt: at, updatedAt: at, status: "open", version: 1,
    auditTrail: [{ action: "created", actorUserId: owner, allocationsAfter: allocations, allocationsBefore: null, at, revision: 1 }] };
}
const project = (row: Document) => initialRecoverySchemas.budgetPeriods?.project(row);
describe("strict budget-period recovery", () => {
  it("preserves exact BSON and immutable owner audit", () => {
    const row = fixture(); const before = BSON.serialize(row);
    expect(project(row)).toEqual(row); expect(BSON.serialize(project(row)!)).toEqual(before);
  });
  it("refuses fields outside the stored contract, including nested money fields", () => {
    const row = fixture();
    expect(() => project({ ...row, unexpected: true })).toThrow();
    row.allocations[0].amount.unexpected = true;
    expect(() => project(row)).toThrow();
  });
  it("refuses foreign audit, broken revision chains and changed allocation history", () => {
    const row = fixture();
    expect(() => project({ ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] })).toThrow();
    expect(() => project({ ...row, version: 2 })).toThrow();
    expect(() => project({ ...row, allocations: [] })).toThrow();
    const updated = { ...row, version: 2, allocations: [], auditTrail: [...row.auditTrail,
      { ...row.auditTrail[0], action: "updated", allocationsBefore: row.allocations, allocationsAfter: [], revision: 2 }] };
    expect(project(updated)).toEqual(updated);
    updated.auditTrail[1].allocationsBefore = [];
    expect(() => project(updated)).toThrow();
  });
  it("refuses lossy money, mixed currency and duplicate allocation categories", () => {
    const row = fixture();
    expect(() => project({ ...row, currency: "USD" })).toThrow();
    expect(() => project({ ...row, allocations: [row.allocations[0], row.allocations[0]] })).toThrow();
    row.allocations[0].amount.amountMinor = 1;
    expect(() => project(row)).toThrow();
  });
  it("refuses closed periods without reviewed closing evidence", () => {
    const row = fixture();
    expect(() => project({ ...row, status: "closed", closedAt: row.updatedAt })).toThrow();
    expect(() => project({ ...row, closingSnapshot: { unexpected: true } })).toThrow();
  });
  it("checks nested closing evidence without normalizing unknown fields or currency", () => {
    const row = fixture(); const zero = { amountMinor: Long.ZERO, currency: "ILS" };
    row.status = "closed"; row.closedAt = row.updatedAt; row.version = 2;
    row.auditTrail.push({ ...row.auditTrail[0], action: "closed", allocationsBefore: row.allocations, revision: 2 });
    row.closingSnapshot = { calendarMonth: "2026-09", allocated: row.allocations[0].amount,
      categorizedForecastSpent: zero, categorizedSpent: zero, confirmedIncome: row.allocations[0].amount,
      lines: [], totalForecastSpent: zero, totalSpent: zero, unallocated: zero, uncategorizedForecastSpent: zero,
      uncategorizedSpent: zero, uncertainIncome: zero };
    expect(project(row)).toEqual(row);
    expect(() => project({ ...row, closingSnapshot: { ...row.closingSnapshot, calendarMonth: "2026-10" } })).toThrow();
    expect(() => project({ ...row, closingSnapshot: { ...row.closingSnapshot, unallocated: { ...zero, currency: "USD" } } })).toThrow();
    expect(() => project({ ...row, closingSnapshot: { ...row.closingSnapshot, unallocated: { ...zero, unexpected: true } } })).toThrow();
  });
});
