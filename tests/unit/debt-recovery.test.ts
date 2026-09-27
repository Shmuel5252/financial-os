import { BSON, Long, ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { debtRecoveryFixture } from "../helpers/debt-recovery-fixture";

const project = (row: Document) => initialRecoverySchemas.debtStrategyScenarios?.project(row);
it("preserves exact immutable hypothetical debt evidence with its existing integrity hash", () => {
  const row = debtRecoveryFixture(); expect(project(row)).toEqual(row);
  expect(BSON.serialize(project(row)!)).toEqual(BSON.serialize(row));
  expect(row.input.debts[0].balance.amountMinor.toString()).toBe("9007199254740993");
});
it("rejects foreign audit or mismatched canonical debt references", () => {
  const row = debtRecoveryFixture();
  expect(() => project({ ...row, userId: new ObjectId() })).toThrow();
  expect(() => project({ ...row, debtReferences: [{ id: new ObjectId(), version: 1 }] })).toThrow();
  expect(() => project({ ...row, debtReferences: [...row.debtReferences, ...row.debtReferences] })).toThrow();
});
it("rejects tampered evidence and unknown nested fields without rewriting them", () => {
  const row = debtRecoveryFixture();
  expect(() => project({ ...row, inputHash: "b".repeat(64) })).toThrow();
  expect(() => project({ ...row, name: "Changed evidence" })).toThrow();
  row.comparison.results[0].unknown = true; expect(() => project(row)).toThrow();
});
it("rejects lossy or unsigned money, mixed currencies and unsupported policy", () => {
  const row = debtRecoveryFixture();
  row.input.extraPayment.amountMinor = 0; expect(() => project(row)).toThrow();
  row.input.extraPayment.amountMinor = Long.fromNumber(0, true); expect(() => project(row)).toThrow();
  row.input.extraPayment.amountMinor = Long.ZERO; row.comparison.currency = "USD"; expect(() => project(row)).toThrow();
  row.comparison.currency = "ILS"; row.comparison.policyVersion = "unreviewed"; expect(() => project(row)).toThrow();
});
