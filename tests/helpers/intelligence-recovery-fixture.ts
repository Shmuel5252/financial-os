import { createHash } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { money } from "@/lib/domain/money/money";
import { toStoredMoney } from "@/lib/db/money-mapper";
import { calculateTransactionIntelligence } from "@/lib/domain/transaction-intelligence/transaction-intelligence-engine";
import { hashTransactionIntelligenceInputs } from "@/lib/transaction-intelligence/transaction-intelligence-service";
import { TRANSACTION_INTELLIGENCE_ENGINE_VERSION, TRANSACTION_INTELLIGENCE_POLICY_VERSION,
  TRANSACTION_INTELLIGENCE_RULESET_VERSION, TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS } from "@/lib/transaction-intelligence/transaction-intelligence";

export const intelligenceDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export function intelligenceRecoveryFixture(owner = new ObjectId(), transactionIds = [new ObjectId(), new ObjectId()], accountId = new ObjectId().toHexString()) {
  const at = new Date("2026-09-28T00:00:00Z");
  const inputs = transactionIds.map(id => ({ id: id.toHexString(), accountId, amount: money(9007199254740993n, "ILS"),
    confirmedCategoryId: "system:other", date: "2026-09-28", merchant: "Synthetic merchant", sourceKind: "manual" as const,
    type: "expense" as const, updatedAt: at.toISOString(), version: 1 }));
  const calculation = calculateTransactionIntelligence(inputs);
  const metadata = { engineVersion: TRANSACTION_INTELLIGENCE_ENGINE_VERSION, policyVersion: TRANSACTION_INTELLIGENCE_POLICY_VERSION,
    rulesetVersion: TRANSACTION_INTELLIGENCE_RULESET_VERSION, reviewThresholdBps: TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS,
    inputHash: hashTransactionIntelligenceInputs(inputs) };
  const run: Document = { _id: new ObjectId(), userId: owner, createdAt: at, schemaVersion: 1,
    ...calculation, ...metadata, idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: intelligenceDigest(`phase10-run|${metadata.inputHash}`),
    audit: { action: "transaction_intelligence_analyzed", actorId: owner, at, changedFields: ["signals", "merchantGroups"], source: "deterministic_rules" },
    signals: calculation.signals.map(signal => ({ ...signal, amount: toStoredMoney(signal.amount), baselineAmount: signal.baselineAmount === null ? null : toStoredMoney(signal.baselineAmount),
      transactionId: new ObjectId(signal.transactionId), evidence: signal.evidence.map(item => ({ ...item, amount: toStoredMoney(item.amount), transactionId: new ObjectId(item.transactionId) })) })),
    merchantGroups: calculation.merchantGroups.map(group => ({ ...group, transactionIds: group.transactionIds.map(id => new ObjectId(id)) })) };
  const reviewInput = { categoryCorrectionId: null, decision: "dismissed" as const, runId: run._id.toHexString(), signalId: calculation.signals[0]!.id };
  const review: Document = { _id: new ObjectId(), userId: owner, at, schemaVersion: 1, sequence: 1, ...reviewInput, runId: run._id,
    idempotencyKeyHash: "b".repeat(64), idempotencyPayloadHash: intelligenceDigest(JSON.stringify(reviewInput)),
    audit: { action: "transaction_intelligence_reviewed", actorId: owner, at, changedFields: ["decision"], source: "user" } };
  return { run, review, calculation, metadata, reviewInput };
}
