import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { calculateForecast, calculateForecastScenario } from "@/lib/domain/forecasts/forecast-engine";
import { money } from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

function fixture(scenario = false): Document {
  const zero = money(0n, "ILS"); const balance = money(9007199254740993n, "ILS");
  const baseline = calculateFinancialEngine({ accountBalance: balance, availableCash: balance, actualMonthlyExpenses: zero,
    actualMonthlyIncome: zero, asOf: "2026-09-01T10:00:00.000Z", creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero,
    events: [], horizonDays: 30, monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
  const result = calculateForecast({ baseline, dataFreshness: "FRESH", freshnessReasons: [], horizonDays: 30,
    intelligenceEvidence: [{ amount: money(1n, "ILS"), periodDays: 30, reviewState: "confirmed", sourceReference: "synthetic-pattern", sourceVersion: "1",
      evidence: ["2026-06-01", "2026-07-01", "2026-07-31", "2026-08-30"].map(date => ({ amount: money(1n, "ILS"), date: calendarDateSchema.parse(date) })) }],
    sourceReferencePrefix: "synthetic" });
  const owner = new ObjectId(); const at = new Date("2026-09-01T10:00:00Z");
  const common = { _id: new ObjectId(), userId: owner, calculatedAt: at, idempotencyKeyHash: "a".repeat(64), inputHash: "b".repeat(64), schemaVersion: 1,
    auditTrail: [{ action: "calculated", actorUserId: owner, at, changedFields: scenario ? ["forecastId", "result", "name", "note"] : ["result", "sourceSnapshotId", "intelligenceRunId"],
      revision: 1, source: scenario ? "forecast_scenario" : "forecast" }] };
  return scenario ? { ...common, forecastId: new ObjectId(), name: "Synthetic scenario", note: null,
    result: toStoredDomainValue(calculateForecastScenario(result, [{ amount: money(1n, "ILS"), calendarDate: result.evaluationDate, kind: "additional_expense" }])) } :
    { ...common, sourceSnapshotId: new ObjectId(), intelligenceRunId: null, result: toStoredDomainValue(result) };
}

describe.each(["forecastSnapshots", "forecastScenarios"] as const)("%s recovery projection", collection => {
  const project = (row: Document) => initialRecoverySchemas[collection]?.project(row);
  const create = () => fixture(collection === "forecastScenarios");
  it("preserves BSON, source IDs and exact money without recomputing truth", () => {
    const row = create(); const before = BSON.serialize(row);
    expect(project(row)).toEqual(row); expect(BSON.serialize(project(row)!)).toEqual(before);
  });
  it("rejects unknown root/nested fields rather than silently stripping them", () => {
    const row = create();
    expect(() => project({ ...row, unexpected: true })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, unexpected: true } })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, projectedEndBalance: { ...row.result.projectedEndBalance, unexpected: true } } })).toThrow();
    const nested = collection === "forecastScenarios" ? row.result.adjustments[0] : row.result.events[0].provenance;
    expect(nested).toBeDefined(); nested.unexpected = true;
    expect(() => project(row)).toThrow();
  });
  it("rejects foreign or malformed audit and wrong same-currency evidence", () => {
    const row = create();
    expect(() => project({ ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] })).toThrow();
    expect(() => project({ ...row, auditTrail: [] })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, currency: "USD" } })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, projectedEndBalance: { amountMinor: 1, currency: "ILS" } } })).toThrow();
    row.result.timeline[0].amount.currency = "USD";
    expect(() => project(row)).toThrow();
  });
});
