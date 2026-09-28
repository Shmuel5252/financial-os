import { BSON, ObjectId } from "mongodb";
import { expect, it } from "vitest";
import { progressRecoveryFixture } from "../helpers/progress-recovery-fixture";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const event = (row: ReturnType<typeof progressRecoveryFixture>["event"]) => initialRecoverySchemas.progressJourneyEvents?.project(row);
const preference = (row: ReturnType<typeof progressRecoveryFixture>["preference"]) => initialRecoverySchemas.progressJourneyPreferences?.project(row);
it("preserves backfill/correction evidence BSON without regenerating achievements", () => {
  const { event: row } = progressRecoveryFixture();
  expect(event(row)).toEqual(row); expect(BSON.serialize(event(row)!)).toEqual(BSON.serialize(row));
  expect(event({ ...row, eventKind: "correction", supersedesId: new ObjectId() })).toBeDefined();
  expect(() => event({ ...row, eventKind: "correction" })).toThrow();
  expect(() => event({ ...row, supersedesId: new ObjectId() })).toThrow();
  expect(() => event({ ...row, eventKind: "correction", supersedesId: row._id })).toThrow();
});
it("rejects foreign event audit, unsupported version and hidden source fields", () => {
  const { event: row } = progressRecoveryFixture();
  expect(() => event({ ...row, userId: new ObjectId() })).toThrow();
  expect(() => event({ ...row, policyVersion: "unsupported" })).toThrow();
  expect(() => event({ ...row, createdAt: new Date(0) })).toThrow();
  row.sourceReferences[0].unexpected = true; expect(() => event(row)).toThrow();
});
it("preserves independent current preferences and audited revisions without replaying consent", () => {
  const { preference: row } = progressRecoveryFixture();
  expect(preference(row)).toEqual(row); expect(BSON.serialize(preference(row)!)).toEqual(BSON.serialize(row));
  row.version = 2; row.celebrationsEnabled = true;
  row.auditTrail.push({ ...row.auditTrail[0], action: "updated", revision: 2 });
  expect(preference(row)).toEqual(row);
  expect(() => preference({ ...row, version: 3 })).toThrow();
  expect(() => preference({ ...row, userId: new ObjectId() })).toThrow();
  expect(() => preference({ ...row, streaksEnabled: "true" })).toThrow();
  expect(() => preference({ ...row, unexpected: true })).toThrow();
});
