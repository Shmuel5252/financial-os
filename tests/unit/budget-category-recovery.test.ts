import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

function category(system = false): Document {
  const _id = new ObjectId(); const owner = new ObjectId(); const at = new Date("2026-09-27T00:00:00Z");
  const settings = { hidden: false, label: "Synthetic category", rolloverPolicy: "reset", sortOrder: 80 };
  return { _id, userId: owner, categoryId: system ? "system:food" : `custom:${_id.toHexString()}`,
    ...(system ? {} : { idempotencyKeyHash: "c".repeat(64), idempotencyPayloadHash: "d".repeat(64) }),
    kind: system ? "system" : "custom", systemKey: system ? "food" : null, ...settings,
    createdAt: at, updatedAt: at, version: 1,
    auditTrail: [{ action: system ? "updated" : "created", actorUserId: owner, at, revision: 1,
      before: system ? { ...settings, label: null } : null, after: settings }] };
}
const project = (row: Document) => initialRecoverySchemas.budgetCategories?.project(row);
const correction = (row: Document) => initialRecoverySchemas.budgetCategoryCorrections?.project(row);

describe("budget category recovery", () => {
  it("refuses custom categories without the original retry evidence", () => {
    const row = category();
    delete row.idempotencyKeyHash; delete row.idempotencyPayloadHash;
    expect(() => project(row)).toThrow();
  });
  it("preserves both custom creation and first persisted system update byte-for-byte", () => {
    for (const row of [category(), category(true)]) {
      expect(project(row)).toEqual(row);
      expect(BSON.serialize(project(row)!)).toEqual(BSON.serialize(row));
    }
  });
  it("rejects foreign audit actors, identity conflicts and broken history", () => {
    const row = category();
    for (const invalid of [ { ...row, categoryId: `custom:${new ObjectId().toHexString()}` },
      { ...row, version: 2 }, { ...row, hidden: true },
      { ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] },
      { ...row, auditTrail: [{ ...row.auditTrail[0], before: row.auditTrail[0].after }] },
      { ...category(true), systemKey: "housing" } ]) expect(() => project(invalid)).toThrow();
  });
  it("preserves connected updates but refuses unknown fields and disconnected before snapshots", () => {
    const row = category(); const before = row.auditTrail[0].after;
    row.hidden = true; row.version = 2;
    row.auditTrail.push({ ...row.auditTrail[0], action: "updated", revision: 2, before, after: { ...before, hidden: true } });
    expect(project(row)).toEqual(row);
    expect(() => project({ ...row, unknown: true })).toThrow();
    row.auditTrail[1].before = { ...before, hidden: true };
    expect(() => project(row)).toThrow();
    row.auditTrail[1].before = before; row.auditTrail[1].after.unknown = true;
    expect(() => project(row)).toThrow();
  });
  it("preserves immutable correction ownership and rejects unexpected or malformed evidence", () => {
    const owner = new ObjectId();
    const row = { _id: new ObjectId(), userId: owner, actorUserId: owner, at: new Date(),
      fromCategoryId: null, toCategoryId: "system:food", transactionId: new ObjectId(),
      reason: "Synthetic correction", idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64) };
    expect(correction(row)).toEqual(row);
    expect(BSON.serialize(correction(row)!)).toEqual(BSON.serialize(row));
    for (const invalid of [{ ...row, actorUserId: new ObjectId() }, { ...row, transactionId: "invalid" },
      { ...row, toCategoryId: "invalid" }, { ...row, unknown: true }, { ...row, idempotencyKeyHash: "invalid" }]) {
      expect(() => correction(invalid)).toThrow();
    }
  });
});
