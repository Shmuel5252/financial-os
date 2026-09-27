import { BSON, Long, ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { calculatePurchaseSimulation } from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { money } from "@/lib/domain/money/money";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

function fixture(): Document {
  const owner = new ObjectId(); const snapshot = new ObjectId(); const at = new Date("2026-09-01T10:00:00Z");
  const zero = money(0n, "ILS"); const balance = money(9007199254740993n, "ILS");
  const baseline = calculateFinancialEngine({ accountBalance: balance, availableCash: balance, actualMonthlyExpenses: zero,
    actualMonthlyIncome: zero, asOf: at.toISOString(), creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero,
    events: [], horizonDays: 210, monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
  const input = { charges: [], inputMode: "installments" as const, installmentCount: 3, installmentFrequency: "monthly" as const,
    proposedDate: "2026-09-01", sourceSnapshotId: snapshot.toHexString(), totalPurchasePrice: money(100n, "ILS") };
  const result = calculatePurchaseSimulation({ ...input, baseline, evaluationHorizonDays: 120, saferDateSearchDays: 90 });
  const evaluation = { budgetPeriodReference: null, dataFreshness: "STALE", freshnessReasons: ["new_calendar_day"], result,
    sourceSnapshot: { id: snapshot.toHexString(), calculatedAt: at, engineVersion: baseline.engineVersion, policyVersion: baseline.policyVersion,
      inputHash: "a".repeat(64), sourceManifestId: new ObjectId().toHexString() }, timeZone: "Asia/Jerusalem" };
  return { _id: new ObjectId(), userId: owner, sourceSnapshotId: snapshot, createdAt: at, schemaVersion: 1,
    idempotencyKeyHash: "b".repeat(64), inputHash: "c".repeat(64), name: "Synthetic simulation", note: null,
    input: toStoredDomainValue(input), evaluation: toStoredDomainValue(evaluation), auditTrail: [{ action: "saved", actorUserId: owner,
      at, changedFields: ["input", "evaluation", "name", "note"], revision: 1, source: "purchase_simulation" }] };
}
const project = (row: Document) => initialRecoverySchemas.purchaseSimulations?.project(row);
it("preserves exact saved hypothetical evidence, stale status and installment remainder", () => {
  const row = fixture(); expect(project(row)).toEqual(row);
  expect(BSON.serialize(project(row)!)).toEqual(BSON.serialize(row));
  expect(row.evaluation.result.installmentSchedule.map((item: Document) => item.amount.amountMinor.toString())).toEqual(["34", "33", "33"]);
});
it("rejects foreign audit and contradictory snapshot provenance", () => {
  const row = fixture();
  expect(() => project({ ...row, sourceSnapshotId: new ObjectId() })).toThrow();
  expect(() => project({ ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] })).toThrow();
  row.evaluation.sourceSnapshot.id = new ObjectId().toHexString(); expect(() => project(row)).toThrow();
});
it("rejects nested unknown fields, numeric money and currency drift without normalization", () => {
  const row = fixture();
  expect(() => project({ ...row, unexpected: true })).toThrow();
  row.input.totalPurchasePrice.unexpected = true; expect(() => project(row)).toThrow(); delete row.input.totalPurchasePrice.unexpected;
  row.input.totalPurchasePrice.amountMinor = 100; expect(() => project(row)).toThrow();
  row.input.totalPurchasePrice.amountMinor = Long.fromNumber(100, true); expect(() => project(row)).toThrow();
  row.input.totalPurchasePrice.amountMinor = Long.fromNumber(100); row.evaluation.result.finalConfirmedBalance.currency = "USD";
  expect(() => project(row)).toThrow();
});
it("refuses inconsistent financed cost or installment totals", () => {
  const row = fixture(); row.evaluation.result.installmentSchedule[0].amount.amountMinor = Long.fromNumber(35);
  expect(() => project(row)).toThrow();
  row.evaluation.result.installmentSchedule[0].amount.amountMinor = Long.fromNumber(34);
  row.evaluation.result.trueFinancedCost.amountMinor = Long.fromNumber(101); expect(() => project(row)).toThrow();
});
it("refuses zero explicit charges even when stored totals agree", () => {
  const row = fixture();
  const charge = { amount: { amountMinor: Long.ZERO, currency: "ILS" }, kind: "fee", label: "Synthetic fee",
    provenance: { kind: "user_reported", note: null } };
  row.input.charges = [charge]; row.evaluation.result.charges = [charge];
  expect(() => project(row)).toThrow();
});
it("refuses a one-installment installment mode even with a matching schedule", () => {
  const row = fixture(); row.input.installmentCount = 1;
  row.evaluation.result.installmentSchedule = [{ amount: row.input.totalPurchasePrice, calendarDate: "2026-09-01", number: 1 }];
  expect(() => project(row)).toThrow();
});
it("refuses blank explicit charge provenance labels accepted by the loose storage schema", () => {
  const row = fixture(); const charge = { amount: { amountMinor: Long.ONE, currency: "ILS" }, kind: "fee", label: "   ",
    provenance: { kind: "user_reported", note: null } };
  row.input.charges = [charge]; row.evaluation.result.charges = [charge];
  row.evaluation.result.trueFinancedCost.amountMinor = Long.fromNumber(101);
  row.evaluation.result.installmentSchedule[1].amount.amountMinor = Long.fromNumber(34);
  expect(() => project(row)).toThrow();
});
