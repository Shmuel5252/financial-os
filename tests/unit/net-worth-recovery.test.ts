import { createHash } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { fromStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { netWorthSnapshotFixture } from "../helpers/net-worth-recovery-fixture";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stableSerializableDomainValue(value))).digest("hex");
function fixture(): Document {
  const owner = new ObjectId(); const at = new Date("2026-09-28T00:00:00Z");
  const fields = { amount: { amountMinor: Long.fromString("9007199254740993"), currency: "ILS" }, category: "other_asset",
    effectiveAt: at.toISOString(), label: "Synthetic item", provenance: { kind: "user_entered", note: null },
    relationship: { kind: "standalone" }, side: "asset", valuationType: "user_estimate" };
  return { _id: new ObjectId(), userId: owner, createdAt: at, updatedAt: at, deletedAt: null, schemaVersion: 1, version: 1,
    fields, idempotencyKeyHash: "a".repeat(64), payloadHash: digest(fromStoredDomainValue(fields)),
    auditTrail: [{ action: "created", actorUserId: owner, at, changedFields: ["fields"], revision: 1, source: "net_worth_item" }] };
}
const project = (row: Document) => initialRecoverySchemas.netWorthItems?.project(row);
const snapshot = (row: Document) => initialRecoverySchemas.netWorthSnapshots?.project(row);
it("preserves explicit and automatic multi-currency snapshot evidence without FX", () => {
  const row = netWorthSnapshotFixture();
  expect(snapshot(row)).toEqual(row); expect(BSON.serialize(snapshot(row)!)).toEqual(BSON.serialize(row));
  expect(snapshot({ ...row, trigger: "material_change", automaticDate: row.statement.evaluationDate })).toBeDefined();
  expect(() => snapshot({ ...row, trigger: "material_change" })).toThrow();
  expect(() => snapshot({ ...row, automaticDate: row.statement.evaluationDate })).toThrow();
});
it("rejects changed fingerprint, foreign snapshot audit and hidden nested fields", () => {
  const row = netWorthSnapshotFixture();
  expect(() => snapshot({ ...row, userId: new ObjectId() })).toThrow();
  expect(() => snapshot({ ...row, stateFingerprint: "a".repeat(64) })).toThrow();
  row.statement.included[0].unexpected = true; expect(() => snapshot(row)).toThrow();
});
it("preserves exact net-worth item BSON and current field integrity", () => {
  const row = fixture(); expect(project(row)).toEqual(row); expect(BSON.serialize(project(row)!)).toEqual(BSON.serialize(row));
  expect(() => project({ ...row, payloadHash: "b".repeat(64) })).toThrow();
});
it("preserves updates and terminal deletion without reconstructing discarded field history", () => {
  const row = fixture(); row.fields.label = "Updated synthetic item";
  row.payloadHash = digest(fromStoredDomainValue(row.fields)); row.version = 2;
  row.auditTrail.push({ ...row.auditTrail[0], action: "updated", revision: 2 });
  expect(project(row)).toEqual(row);
  row.version = 3; row.deletedAt = row.updatedAt;
  row.auditTrail.push({ ...row.auditTrail[0], action: "deleted", changedFields: ["deletedAt"], revision: 3 });
  expect(project(row)).toEqual(row);
  expect(() => project({ ...row, deletedAt: null })).toThrow();
  row.version = 4; row.auditTrail.push({ ...row.auditTrail[1], revision: 4 });
  expect(() => project(row)).toThrow();
});
it("rejects foreign audit, broken revisions, unknown fields and lossy money", () => {
  const row = fixture();
  expect(() => project({ ...row, userId: new ObjectId() })).toThrow();
  expect(() => project({ ...row, version: 2 })).toThrow();
  expect(() => project({ ...row, unexpected: true })).toThrow();
  row.fields.amount.unexpected = true; expect(() => project(row)).toThrow(); delete row.fields.amount.unexpected;
  row.fields.amount.amountMinor = 5; expect(() => project(row)).toThrow();
});
