import { createHash } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { calculateDebtStrategies, type DebtStrategyInput } from "@/lib/domain/debt-strategies/debt-strategy-engine";
import { money } from "@/lib/domain/money/money";
import { stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";

export function debtRecoveryFixture(owner = new ObjectId(), debtId = new ObjectId()): Document {
  const at = new Date("2026-09-01T10:00:00Z"); const provenance = { kind: "contract" as const, note: "Synthetic contract" };
  const input: DebtStrategyInput = { customPriority: [debtId.toHexString()], evaluationDate: "2026-09-01",
    extraPayment: money(0n, "ILS"), extraPaymentStartDate: "2026-10-01", debts: [{ id: debtId.toHexString(), sourceVersion: 1,
      label: "Synthetic debt", balance: money(9007199254740993n, "ILS"), firstPaymentDate: "2026-10-01",
      minimumPayment: { kind: "fixed", amount: money(9007199254740993n, "ILS"), provenance },
      interest: { kind: "none", provenance }, prepayment: { kind: "free", provenance }, fees: [], feesKnown: true,
      feesProvenance: provenance, allocationOrder: { order: ["fees", "interest", "principal"], provenance } }] };
  const comparison = calculateDebtStrategies(input); const name = "Synthetic strategy"; const note = null;
  return { _id: new ObjectId(), userId: owner, createdAt: at, schemaVersion: 1, input: toStoredDomainValue(input),
    comparison: toStoredDomainValue(comparison), debtReferences: [{ id: debtId, version: 1 }], name, note,
    idempotencyKeyHash: "a".repeat(64),
    inputHash: createHash("sha256").update(JSON.stringify(stableSerializableDomainValue({ input, comparison, name, note })), "utf8").digest("hex"),
    auditTrail: [{ action: "saved", actorUserId: owner, at, revision: 1, source: "debt_strategy", changedFields: ["input", "comparison", "name", "note"] }] };
}
