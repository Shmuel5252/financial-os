import { ObjectId } from "mongodb";
import { expect, it } from "vitest";
import { debtRecoveryFixture } from "../helpers/debt-recovery-fixture";
import { inspectDebtRecoveryLinks as inspect } from "@/lib/operations/debt-recovery-links";

function fixture() {
  const scenario = debtRecoveryFixture(); const at = scenario.createdAt;
  const loan = { _id: scenario.debtReferences[0].id, userId: scenario.userId, createdAt: at, updatedAt: at, deletedAt: null,
    version: 1, schemaVersion: 2, source: { kind: "manual" }, auditTrail: [], fields: { name: "Synthetic loan",
      annualInterestRateBps: 0, endDate: null, nextPaymentDate: "2026-10-01", monthlyPayment: scenario.input.debts[0].balance,
      originalAmount: scenario.input.debts[0].balance, remainingBalance: scenario.input.debts[0].balance } };
  return { scenario, loan };
}
it("matches declared loan identity and revision without authorizing historical scenario release", () => {
  const { scenario, loan } = fixture();
  expect(inspect([scenario], [loan])).toEqual({ policy: "debt-recovery-links-v1", releaseAllowed: false, matched: 1,
    unresolved: { missing: 0, changed: 0, inactive: 0, historicalScenarios: 1 } });
});
it("keeps missing, changed and inactive loan evidence explicitly unresolved", () => {
  const { scenario, loan } = fixture();
  for (const [loans, unresolved] of [[[], { missing: 1, changed: 0, inactive: 0, historicalScenarios: 1 }],
    [[{ ...loan, version: 2 }], { missing: 0, changed: 1, inactive: 0, historicalScenarios: 1 }],
    [[{ ...loan, deletedAt: new Date() }], { missing: 0, changed: 0, inactive: 1, historicalScenarios: 1 }]] as const) {
    expect(inspect([scenario], [...loans])).toEqual({ policy: "debt-recovery-links-v1", releaseAllowed: false, matched: 0, unresolved });
  }
});
it("rejects foreign ownership, duplicate identities and malformed supplied evidence", () => {
  const { scenario, loan } = fixture();
  expect(() => inspect([scenario], [{ ...loan, userId: new ObjectId() }])).toThrow();
  expect(() => inspect([scenario, { ...scenario, _id: new ObjectId() }], [loan])).toThrow();
  expect(() => inspect([scenario], [loan, loan])).toThrow();
  expect(() => inspect([scenario], [{ ...loan, unexpected: true }])).toThrow();
});
