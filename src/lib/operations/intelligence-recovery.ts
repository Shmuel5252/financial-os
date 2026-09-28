/** Stored review-only intelligence evidence; no recalculation or correction replay. */
import "server-only";
import { createHash } from "node:crypto";
import { Long, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { budgetCategoryIdSchema } from "@/lib/budgets/budget";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { TRANSACTION_INTELLIGENCE_ENGINE_VERSION, TRANSACTION_INTELLIGENCE_POLICY_VERSION,
  TRANSACTION_INTELLIGENCE_RULESET_VERSION, TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS,
  TRANSACTION_INTELLIGENCE_MAX_INPUTS, TRANSACTION_INTELLIGENCE_MAX_SIGNALS,
  transactionIntelligenceSignalKindSchema, transactionIntelligenceExplanationCodeSchema,
  transactionIntelligenceReviewDecisionSchema } from "@/lib/transaction-intelligence/transaction-intelligence";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const signalId = z.string().regex(/^[a-f0-9]{32}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.object({ amountMinor: z.instanceof(Long).refine(value => !value.unsigned), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const evidence = z.object({ amount, confirmedCategoryId: budgetCategoryIdSchema.nullable(), date: calendarDateSchema,
  normalizedMerchant: z.string().nullable(), rawMerchant: z.string().nullable(), transactionId: id }).strict();
const signal = z.object({ amount, baselineAmount: amount.nullable(), confidenceBps: z.number().int().min(0).max(10000),
  evidence: z.array(evidence).min(1).max(12), explanationCode: transactionIntelligenceExplanationCodeSchema,
  id: signalId, kind: transactionIntelligenceSignalKindSchema, normalizedMerchant: z.string().nullable(),
  periodDays: z.number().int().positive().nullable(), suggestedCategoryId: budgetCategoryIdSchema.nullable(), transactionId: id }).strict();
const run = z.object({ _id: id, userId: id, createdAt: z.date(), schemaVersion: z.literal(1),
  analyzedThroughDate: calendarDateSchema.nullable(), inputCount: count.max(TRANSACTION_INTELLIGENCE_MAX_INPUTS), inputHash: hash,
  idempotencyKeyHash: hash, idempotencyPayloadHash: hash,
  engineVersion: z.literal(TRANSACTION_INTELLIGENCE_ENGINE_VERSION), policyVersion: z.literal(TRANSACTION_INTELLIGENCE_POLICY_VERSION),
  rulesetVersion: z.literal(TRANSACTION_INTELLIGENCE_RULESET_VERSION), reviewThresholdBps: z.literal(TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS),
  omittedLowConfidenceCount: count, truncatedSignalCount: count, signals: z.array(signal).max(TRANSACTION_INTELLIGENCE_MAX_SIGNALS),
  merchantGroups: z.array(z.object({ latestRawMerchant: z.string(), normalizedMerchant: z.string(), occurrenceCount: count.min(1),
    transactionIds: z.array(id).min(1).max(12) }).strict()).max(200),
  audit: z.object({ action: z.literal("transaction_intelligence_analyzed"), actorId: id, at: z.date(),
    changedFields: z.tuple([z.literal("signals"), z.literal("merchantGroups")]), source: z.literal("deterministic_rules") }).strict(),
}).strict();
const review = z.object({ _id: id, userId: id, at: z.date(), schemaVersion: z.literal(1), sequence: count.min(1),
  runId: id, signalId, decision: transactionIntelligenceReviewDecisionSchema, categoryCorrectionId: id.nullable(),
  idempotencyKeyHash: hash, idempotencyPayloadHash: hash,
  audit: z.object({ action: z.literal("transaction_intelligence_reviewed"), actorId: id, at: z.date(),
    changedFields: z.tuple([z.literal("decision")]), source: z.literal("user") }).strict(),
}).strict();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (): never => { throw new Error("Transaction intelligence recovery requires review"); };
export function projectRecoveryIntelligenceRun(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = run.parse(input);
    if (!row.audit.actorId.equals(row.userId) || row.audit.at.getTime() !== row.createdAt.getTime()
      || row.idempotencyPayloadHash !== digest(`phase10-run|${row.inputHash}`)) return fail();
    const seen = new Set<string>();
    for (const item of row.signals) {
      const ids = item.evidence.map(value => value.transactionId.toHexString()).sort();
      if (seen.has(item.id) || item.id !== digest(`${item.kind}|${item.transactionId.toHexString()}|${ids.join(",")}`).slice(0, 32)
        || (item.baselineAmount !== null && item.baselineAmount.currency !== item.amount.currency)
        || item.confidenceBps < row.reviewThresholdBps) return fail();
      seen.add(item.id);
    }
    // Category history may legitimately contain other currencies: never infer FX or impose a global currency.
    // Stored evidence is bounded, so the original inputHash and historical inference cannot be reconstructed here.
    return input;
  } catch { return fail(); }
}
export function projectRecoveryIntelligenceReview(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = review.parse(input);
    if (!row.audit.actorId.equals(row.userId) || row.audit.at.getTime() !== row.at.getTime()
      || (row.decision !== "confirmed" && row.categoryCorrectionId !== null)) return fail();
    // The writer hashes original runId spelling before BSON normalizes it. Preserve the opaque hash:
    // canonical lowercase reconstruction would reject valid historical uppercase/mixed-case requests.
    // The authenticated package protects byte integrity; this is not original request-hash verification.
    // Source run/signal/correction ownership and review ordering are separate quarantine checks.
    return input;
  } catch { return fail(); }
}
