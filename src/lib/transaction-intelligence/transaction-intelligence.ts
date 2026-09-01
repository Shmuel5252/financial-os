import { z } from "zod";

import type { Money, SerializedMoney } from "@/lib/domain/money/money";
import { serializeMoney } from "@/lib/domain/money/money";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const TRANSACTION_INTELLIGENCE_ENGINE_VERSION = "transaction-intelligence-v1";
export const TRANSACTION_INTELLIGENCE_RULESET_VERSION = "merchant-rules-v1";
export const TRANSACTION_INTELLIGENCE_POLICY_VERSION = "review-only-v1";
export const TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS = 6_000;
export const TRANSACTION_INTELLIGENCE_MAX_INPUTS = 1_000;
export const TRANSACTION_INTELLIGENCE_MAX_SIGNALS = 200;

export const transactionIntelligenceSignalKindSchema = z.enum([
  "amount_anomaly",
  "category_suggestion",
  "possible_duplicate",
  "recurring_candidate",
  "subscription_candidate",
  "subscription_increase",
  "unusual_merchant",
]);

export const transactionIntelligenceExplanationCodeSchema = z.enum([
  "CATEGORY_CURATED_MERCHANT",
  "CATEGORY_CONFIRMED_HISTORY",
  "DUPLICATE_EXACT_MATCH",
  "RECURRING_CALENDAR_PATTERN",
  "SUBSCRIPTION_CALENDAR_PATTERN",
  "AMOUNT_DEVIATES_FROM_MERCHANT_MEDIAN",
  "SUBSCRIPTION_PRICE_INCREASE",
  "NEW_MERCHANT_HIGH_AMOUNT",
]);

export const transactionIntelligenceReviewDecisionSchema = z.enum([
  "confirmed",
  "dismissed",
  "reopened",
]);

export type TransactionIntelligenceSignalKind = z.infer<
  typeof transactionIntelligenceSignalKindSchema
>;
export type TransactionIntelligenceExplanationCode = z.infer<
  typeof transactionIntelligenceExplanationCodeSchema
>;
export type TransactionIntelligenceReviewDecision = z.infer<
  typeof transactionIntelligenceReviewDecisionSchema
>;

export type TransactionIntelligenceInput = Readonly<{
  accountId: string;
  amount: Money;
  confirmedCategoryId: string | null;
  date: string;
  id: string;
  merchant: string | null;
  sourceKind: "manual";
  type: "expense" | "income" | "refund" | "transfer";
  updatedAt: string;
  version: number;
}>;

export type TransactionIntelligenceEvidence = Readonly<{
  amount: Money;
  confirmedCategoryId: string | null;
  date: string;
  normalizedMerchant: string | null;
  rawMerchant: string | null;
  transactionId: string;
}>;

export type TransactionIntelligenceSignal = Readonly<{
  amount: Money;
  baselineAmount: Money | null;
  confidenceBps: number;
  evidence: readonly TransactionIntelligenceEvidence[];
  explanationCode: TransactionIntelligenceExplanationCode;
  id: string;
  kind: TransactionIntelligenceSignalKind;
  normalizedMerchant: string | null;
  periodDays: number | null;
  suggestedCategoryId: string | null;
  transactionId: string;
}>;

export type TransactionIntelligenceMerchantGroup = Readonly<{
  latestRawMerchant: string;
  normalizedMerchant: string;
  occurrenceCount: number;
  transactionIds: readonly string[];
}>;

export type TransactionIntelligenceCalculation = Readonly<{
  analyzedThroughDate: string | null;
  inputCount: number;
  merchantGroups: readonly TransactionIntelligenceMerchantGroup[];
  omittedLowConfidenceCount: number;
  signals: readonly TransactionIntelligenceSignal[];
  truncatedSignalCount: number;
}>;

export type TransactionIntelligenceRun = Readonly<{
  analyzedThroughDate: string | null;
  createdAt: Date;
  engineVersion: string;
  id: string;
  inputCount: number;
  inputHash: string;
  merchantGroups: readonly TransactionIntelligenceMerchantGroup[];
  omittedLowConfidenceCount: number;
  policyVersion: string;
  reviewThresholdBps: number;
  rulesetVersion: string;
  signals: readonly TransactionIntelligenceSignal[];
  truncatedSignalCount: number;
}>;

export type TransactionIntelligenceReview = Readonly<{
  at: Date;
  categoryCorrectionId: string | null;
  decision: TransactionIntelligenceReviewDecision;
  id: string;
  runId: string;
  sequence: number;
  signalId: string;
}>;

export type TransactionIntelligenceEvidenceView = Readonly<{
  amount: SerializedMoney;
  confirmedCategoryId: string | null;
  date: string;
  normalizedMerchant: string | null;
  rawMerchant: string | null;
}>;

export type TransactionIntelligenceSignalView = Readonly<{
  amount: SerializedMoney;
  baselineAmount: SerializedMoney | null;
  confidenceBps: number;
  currentDecision: TransactionIntelligenceReviewDecision | null;
  evidence: readonly TransactionIntelligenceEvidenceView[];
  explanationCode: TransactionIntelligenceExplanationCode;
  id: string;
  kind: TransactionIntelligenceSignalKind;
  normalizedMerchant: string | null;
  periodDays: number | null;
  suggestedCategoryId: string | null;
}>;

export type TransactionIntelligenceRunView = Readonly<{
  analyzedThroughDate: string | null;
  createdAt: string;
  engineVersion: string;
  id: string;
  inputCount: number;
  merchantGroups: readonly Readonly<{
    latestRawMerchant: string;
    normalizedMerchant: string;
    occurrenceCount: number;
  }>[];
  omittedLowConfidenceCount: number;
  policyVersion: string;
  reviewThresholdBps: number;
  rulesetVersion: string;
  signals: readonly TransactionIntelligenceSignalView[];
  truncatedSignalCount: number;
}>;

export type TransactionIntelligenceReviewView = Readonly<{
  at: string;
  categoryCorrectionId: string | null;
  decision: TransactionIntelligenceReviewDecision;
  id: string;
  runId: string;
  sequence: number;
  signalId: string;
}>;

export const analyzeTransactionsCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
}).strict();

export const reviewTransactionIntelligenceCommandSchema = z.object({
  decision: transactionIntelligenceReviewDecisionSchema,
  expectedDecision: transactionIntelligenceReviewDecisionSchema.nullable(),
  idempotencyKey: z.string().uuid(),
  runId: z.string().regex(/^[0-9a-f]{24}$/i),
  signalId: z.string().regex(/^[0-9a-f]{32}$/),
}).strict();

export function parseTransactionIntelligenceCommand<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  return parseUntrusted(schema, input);
}

export function toTransactionIntelligenceRunView(
  run: TransactionIntelligenceRun,
  reviews: readonly TransactionIntelligenceReview[],
): TransactionIntelligenceRunView {
  const currentReviews = new Map<string, TransactionIntelligenceReview>();
  for (const review of reviews) {
    currentReviews.set(review.signalId, review);
  }

  return {
    analyzedThroughDate: run.analyzedThroughDate,
    createdAt: run.createdAt.toISOString(),
    engineVersion: run.engineVersion,
    id: run.id,
    inputCount: run.inputCount,
    merchantGroups: run.merchantGroups.map((group) => ({
      latestRawMerchant: group.latestRawMerchant,
      normalizedMerchant: group.normalizedMerchant,
      occurrenceCount: group.occurrenceCount,
    })),
    omittedLowConfidenceCount: run.omittedLowConfidenceCount,
    policyVersion: run.policyVersion,
    reviewThresholdBps: run.reviewThresholdBps,
    rulesetVersion: run.rulesetVersion,
    signals: run.signals.map((signal) => ({
      amount: serializeMoney(signal.amount),
      baselineAmount:
        signal.baselineAmount === null
          ? null
          : serializeMoney(signal.baselineAmount),
      confidenceBps: signal.confidenceBps,
      currentDecision: currentReviews.get(signal.id)?.decision ?? null,
      evidence: signal.evidence.map((item) => ({
        amount: serializeMoney(item.amount),
        confirmedCategoryId: item.confirmedCategoryId,
        date: item.date,
        normalizedMerchant: item.normalizedMerchant,
        rawMerchant: item.rawMerchant,
      })),
      explanationCode: signal.explanationCode,
      id: signal.id,
      kind: signal.kind,
      normalizedMerchant: signal.normalizedMerchant,
      periodDays: signal.periodDays,
      suggestedCategoryId: signal.suggestedCategoryId,
    })),
    truncatedSignalCount: run.truncatedSignalCount,
  };
}

export function toTransactionIntelligenceReviewView(
  review: TransactionIntelligenceReview,
): TransactionIntelligenceReviewView {
  return {
    ...review,
    at: review.at.toISOString(),
  };
}
