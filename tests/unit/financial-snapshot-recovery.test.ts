import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

function fixture(engine: boolean, amount = 9007199254740993n): Document {
  const owner = new ObjectId(); const at = new Date("2026-09-22T00:00:00Z");
  const common = { _id: new ObjectId(), userId: owner, idempotencyKeyHash: "a".repeat(64), schemaVersion: 1 };
  if (!engine) return { ...common, kind: "source_manifest", capturedAt: at, primaryCurrency: "ILS",
    sources: [{ section: "accounts", records: [{ id: new ObjectId().toHexString(), updatedAt: at, version: 1 }] }],
    auditTrail: [{ action: "created", actorUserId: owner, at, changedFields: ["primaryCurrency", "sources"], revision: 1, source: "manual" }] };
  const zero = money(0n, "ILS"); const high = money(amount, "ILS");
  const result = calculateFinancialEngine({ accountBalance: high, availableCash: high, actualMonthlyExpenses: zero, actualMonthlyIncome: zero,
    asOf: "2026-09-22T00:00:00.000Z", creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero, events: [], horizonDays: 30,
    monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
  return { ...common, kind: "engine_result", calculatedAt: at, engineVersion: result.engineVersion, policyVersion: result.policyVersion,
    inputHash: "b".repeat(64), sourceManifestId: new ObjectId(), result: toStoredDomainValue(result),
    auditTrail: [{ action: "calculated", actorUserId: owner, at, changedFields: ["inputHash", "result", "sourceManifestId"], revision: 1, source: "financial_engine" }] };
}
const project = (row: Document) => initialRecoverySchemas.financialSnapshots?.project(row);
describe.each([false, true])("financial snapshot engine=%s recovery", engine => {
  it("preserves exact BSON and kind without rewriting financial truth", () => {
    const row = fixture(engine); const before = BSON.serialize(row);
    expect(project(row)).toEqual(row); expect(BSON.serialize(project(row)!)).toEqual(before);
    if (engine) {
      const negative = fixture(true, -9007199254740993n);
      expect(BSON.serialize(project(negative)!)).toEqual(BSON.serialize(negative));
    }
  });
  it("refuses unknown kind/fields and foreign audit ownership", () => {
    const row = fixture(engine);
    expect(() => project({ ...row, kind: "unreviewed" })).toThrow();
    expect(() => project({ ...row, unexpected: true })).toThrow();
    expect(() => project({ ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] })).toThrow();
  });
});
describe("financial source boundaries", () => {
  it("rejects duplicate/unknown manifest references instead of normalizing them", () => {
    const row = fixture(false);
    expect(() => project({ ...row, sources: [row.sources[0], row.sources[0]] })).toThrow();
    expect(() => project({ ...row, sources: [{ ...row.sources[0], records: [row.sources[0].records[0], row.sources[0].records[0]] }] })).toThrow();
    row.sources[0].records[0].unexpected = true; expect(() => project(row)).toThrow();
  });
  it("rejects mismatched engine versions, currency and hidden nested fields", () => {
    const row = fixture(true);
    expect(() => project({ ...row, engineVersion: "unexpected" })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, currency: "USD" } })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, accountBalance: { amountMinor: 1, currency: "ILS" } } })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, accountBalance: { amountMinor: Long.fromBigInt(1n, true), currency: "ILS" } } })).toThrow();
    expect(() => project({ ...row, result: { ...row.result, timeline: [{ ...row.result.timeline[0], amount: { ...row.result.timeline[0].amount, currency: "USD" } }] } })).toThrow();
    row.result.credit.used.unexpected = true; expect(() => project(row)).toThrow();
  });
});
