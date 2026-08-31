import { z } from "zod";

import type {
  InstallmentFrequency,
  PurchaseCharge,
  PurchaseInputMode,
  PurchaseSimulationResult,
} from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import {
  PURCHASE_SIMULATION_ENGINE_VERSION,
  PURCHASE_SIMULATION_POLICY_VERSION,
} from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { moneyInputSchema } from "@/lib/domain/money/money-input";
import {
  money,
  serializeMoney,
  type Money,
  type SerializedMoney,
} from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import type { FinancialSnapshotFreshnessReason } from "@/lib/financial-engine/financial-engine-snapshot-freshness";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);

export const purchaseChargeCommandSchema = z.object({
  amount: moneyInputSchema,
  kind: z.enum(["fee", "interest"]),
  label: z.string().trim().min(1).max(80),
  provenance: z.object({
    kind: z.literal("user_reported"),
    note: z.string().trim().max(240).nullable().default(null),
  }),
});

const purchaseCommandFields = {
  charges: z.array(purchaseChargeCommandSchema).max(8).default([]),
  inputMode: z.enum(["one_time", "installments"]),
  installmentCount: z.number().int().min(1).max(60),
  installmentFrequency: z.literal("monthly").default("monthly"),
  proposedDate: calendarDateSchema,
  sourceSnapshotId: objectIdSchema,
  totalPurchasePrice: moneyInputSchema,
} as const;

export const evaluatePurchaseCommandSchema = z.object(purchaseCommandFields);

export const savePurchaseSimulationCommandSchema = z.object({
  ...purchaseCommandFields,
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(1).max(80).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

export const purchaseSimulationPageQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type EvaluatePurchaseCommand = z.infer<
  typeof evaluatePurchaseCommandSchema
>;
export type SavePurchaseSimulationCommand = z.infer<
  typeof savePurchaseSimulationCommandSchema
>;

export type PurchaseSimulationParameters = Readonly<{
  charges: readonly PurchaseCharge[];
  inputMode: PurchaseInputMode;
  installmentCount: number;
  installmentFrequency: InstallmentFrequency;
  proposedDate: string;
  sourceSnapshotId: string;
  totalPurchasePrice: Money;
}>;

export type PurchaseBudgetPeriodReference = Readonly<{
  calendarMonth: string;
  id: string;
  version: number;
}>;

export type PurchaseSimulationEvaluation = Readonly<{
  budgetPeriodReference: PurchaseBudgetPeriodReference | null;
  dataFreshness: "FRESH" | "STALE";
  freshnessReasons: readonly FinancialSnapshotFreshnessReason[];
  result: PurchaseSimulationResult;
  sourceSnapshot: Readonly<{
    calculatedAt: Date;
    engineVersion: string;
    id: string;
    inputHash: string;
    policyVersion: string;
    sourceManifestId: string;
  }>;
  timeZone: string;
}>;

export type SavedPurchaseSimulation = Readonly<{
  createdAt: Date;
  evaluation: PurchaseSimulationEvaluation;
  id: string;
  input: PurchaseSimulationParameters;
  name: string | null;
  note: string | null;
  schemaVersion: 1;
}>;

export type PurchaseChargeView = Readonly<{
  amount: SerializedMoney;
  kind: "fee" | "interest";
  label: string;
  provenance: Readonly<{
    kind: "user_reported";
    note: string | null;
  }>;
}>;

export type PurchaseSimulationResultView = Readonly<{
  charges: readonly PurchaseChargeView[];
  engineVersion: string;
  evaluationEndDate: string;
  evaluationHorizonDays: number;
  evaluationStartDate: string;
  explanationCodes: PurchaseSimulationResult["explanationCodes"];
  finalConfirmedBalance: SerializedMoney;
  installmentSchedule: readonly Readonly<{
    amount: SerializedMoney;
    calendarDate: string;
    number: number;
  }>[];
  minimumConfirmedBalance: SerializedMoney;
  minimumConfirmedBalanceAt: string;
  minimumSafeCapacity: SerializedMoney;
  minimumSafeCapacityAt: string;
  obligationsCoverable: boolean;
  openingConfirmedBalance: SerializedMoney;
  policyVersion: string;
  riskClassification: PurchaseSimulationResult["riskClassification"];
  saferDate: string | null;
  saferDateSearchDays: number;
  safetyMarginAtMinimumCapacity: SerializedMoney;
  timeline: readonly Readonly<{
    amount: SerializedMoney;
    calendarDate: string;
    confirmedBalance: SerializedMoney;
    eventId: string;
    expectedBalance: SerializedMoney;
    kind: PurchaseSimulationResult["timeline"][number]["kind"];
    proposedPurchase: boolean;
    safeCapacity: SerializedMoney;
    safetyMargin: SerializedMoney;
    source: PurchaseSimulationResult["timeline"][number]["source"];
  }>[];
  timelineTruncated: boolean;
  totalPurchasePrice: SerializedMoney;
  trueFinancedCost: SerializedMoney;
}>;

export type PurchaseSimulationEvaluationView = Readonly<{
  budgetPeriodReference: PurchaseBudgetPeriodReference | null;
  dataFreshness: "FRESH" | "STALE";
  freshnessReasons: readonly FinancialSnapshotFreshnessReason[];
  result: PurchaseSimulationResultView;
  sourceSnapshot: Readonly<{
    calculatedAt: string;
    engineVersion: string;
    id: string;
    inputHash: string;
    policyVersion: string;
    sourceManifestId: string;
  }>;
  timeZone: string;
}>;

export type SavedPurchaseSimulationView = Readonly<{
  createdAt: string;
  evaluation: PurchaseSimulationEvaluationView;
  id: string;
  input: Readonly<{
    charges: readonly PurchaseChargeView[];
    inputMode: PurchaseInputMode;
    installmentCount: number;
    installmentFrequency: InstallmentFrequency;
    proposedDate: string;
    sourceSnapshotId: string;
    totalPurchasePrice: SerializedMoney;
  }>;
  name: string | null;
  note: string | null;
  schemaVersion: 1;
}>;

export type PurchaseSimulationCenterView = Readonly<{
  baseline: Readonly<{
    calculatedAt: string;
    dataFreshness: "FRESH" | "STALE";
    evaluationDate: string;
    freshnessReasons: readonly FinancialSnapshotFreshnessReason[];
    horizonEndDate: string;
    id: string;
  }> | null;
  currency: string;
  requiredBaselineHorizonDays: number;
  saved: readonly SavedPurchaseSimulationView[];
  timeZone: string;
}>;

const domainMoneySchema = z
  .object({
    amountMinor: z.bigint(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .transform((value) => money(value.amountMinor, value.currency));

export const purchaseChargeDomainSchema = z.object({
  amount: domainMoneySchema,
  kind: z.enum(["fee", "interest"]),
  label: z.string().min(1).max(80),
  provenance: z.object({
    kind: z.literal("user_reported"),
    note: z.string().max(240).nullable(),
  }),
});

const purchaseInstallmentDomainSchema = z.object({
  amount: domainMoneySchema,
  calendarDate: calendarDateSchema,
  number: z.number().int().min(1).max(60),
});

const purchaseTimelinePointDomainSchema = z.object({
  amount: domainMoneySchema,
  calendarDate: calendarDateSchema,
  confirmedBalance: domainMoneySchema,
  eventId: z.string().min(1),
  expectedBalance: domainMoneySchema,
  kind: z.enum([
    "confirmed_income",
    "margin_boundary",
    "obligation",
    "uncertain_income",
  ]),
  proposedPurchase: z.boolean(),
  safeCapacity: domainMoneySchema,
  safetyMargin: domainMoneySchema,
  source: z.enum([
    "credit_card",
    "income_source",
    "loan",
    "policy",
    "proposed_purchase",
    "recurring_expense",
    "recurring_transaction",
  ]),
});

export const purchaseSimulationResultDomainSchema = z.object({
  charges: z.array(purchaseChargeDomainSchema).max(8),
  engineVersion: z.literal(PURCHASE_SIMULATION_ENGINE_VERSION),
  evaluationEndDate: calendarDateSchema,
  evaluationHorizonDays: z.number().int().min(1).max(366),
  evaluationStartDate: calendarDateSchema,
  explanationCodes: z.array(
    z.enum([
      "confirmed_obligation_uncovered",
      "minimum_at_or_above_margin",
      "minimum_below_margin_non_negative",
      "negative_projected_balance",
    ]),
  ),
  finalConfirmedBalance: domainMoneySchema,
  installmentSchedule: z.array(purchaseInstallmentDomainSchema).min(1).max(60),
  minimumConfirmedBalance: domainMoneySchema,
  minimumConfirmedBalanceAt: calendarDateSchema,
  minimumSafeCapacity: domainMoneySchema,
  minimumSafeCapacityAt: calendarDateSchema,
  obligationsCoverable: z.boolean(),
  openingConfirmedBalance: domainMoneySchema,
  policyVersion: z.literal(PURCHASE_SIMULATION_POLICY_VERSION),
  riskClassification: z.enum(["CAUTION", "SAFE", "UNSAFE"]),
  saferDate: calendarDateSchema.nullable(),
  saferDateSearchDays: z.number().int().min(1).max(365),
  safetyMarginAtMinimumCapacity: domainMoneySchema,
  timeline: z.array(purchaseTimelinePointDomainSchema),
  totalPurchasePrice: domainMoneySchema,
  trueFinancedCost: domainMoneySchema,
});

export const purchaseSimulationParametersDomainSchema = z.object({
  charges: z.array(purchaseChargeDomainSchema).max(8),
  inputMode: z.enum(["one_time", "installments"]),
  installmentCount: z.number().int().min(1).max(60),
  installmentFrequency: z.literal("monthly"),
  proposedDate: calendarDateSchema,
  sourceSnapshotId: objectIdSchema,
  totalPurchasePrice: domainMoneySchema,
});

export const purchaseSimulationEvaluationDomainSchema = z.object({
  budgetPeriodReference: z
    .object({
      calendarMonth: z.string().regex(/^\d{4}-\d{2}$/),
      id: objectIdSchema,
      version: z.number().int().positive(),
    })
    .nullable(),
  dataFreshness: z.enum(["FRESH", "STALE"]),
  freshnessReasons: z.array(
    z.enum([
      "manifest_unavailable",
      "new_calendar_day",
      "profile_changed",
      "source_changed",
    ]),
  ),
  result: purchaseSimulationResultDomainSchema,
  sourceSnapshot: z.object({
    calculatedAt: z.date(),
    engineVersion: z.string().min(1),
    id: objectIdSchema,
    inputHash: z.string().regex(/^[0-9a-f]{64}$/),
    policyVersion: z.string().min(1),
    sourceManifestId: objectIdSchema,
  }),
  timeZone: z.string().min(1),
});

export function parsePurchaseCommand<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  return parseUntrusted(schema, input);
}

function chargeView(charge: PurchaseCharge): PurchaseChargeView {
  return {
    ...charge,
    amount: serializeMoney(charge.amount),
  };
}

export function toPurchaseSimulationResultView(
  result: PurchaseSimulationResult,
): PurchaseSimulationResultView {
  const timeline = result.timeline.slice(0, 200);
  return {
    charges: result.charges.map(chargeView),
    engineVersion: result.engineVersion,
    evaluationEndDate: result.evaluationEndDate,
    evaluationHorizonDays: result.evaluationHorizonDays,
    evaluationStartDate: result.evaluationStartDate,
    explanationCodes: result.explanationCodes,
    finalConfirmedBalance: serializeMoney(result.finalConfirmedBalance),
    installmentSchedule: result.installmentSchedule.map((installment) => ({
      ...installment,
      amount: serializeMoney(installment.amount),
    })),
    minimumConfirmedBalance: serializeMoney(result.minimumConfirmedBalance),
    minimumConfirmedBalanceAt: result.minimumConfirmedBalanceAt,
    minimumSafeCapacity: serializeMoney(result.minimumSafeCapacity),
    minimumSafeCapacityAt: result.minimumSafeCapacityAt,
    obligationsCoverable: result.obligationsCoverable,
    openingConfirmedBalance: serializeMoney(result.openingConfirmedBalance),
    policyVersion: result.policyVersion,
    riskClassification: result.riskClassification,
    saferDate: result.saferDate,
    saferDateSearchDays: result.saferDateSearchDays,
    safetyMarginAtMinimumCapacity: serializeMoney(
      result.safetyMarginAtMinimumCapacity,
    ),
    timeline: timeline.map((point) => ({
      ...point,
      amount: serializeMoney(point.amount),
      confirmedBalance: serializeMoney(point.confirmedBalance),
      expectedBalance: serializeMoney(point.expectedBalance),
      safeCapacity: serializeMoney(point.safeCapacity),
      safetyMargin: serializeMoney(point.safetyMargin),
    })),
    timelineTruncated: result.timeline.length > timeline.length,
    totalPurchasePrice: serializeMoney(result.totalPurchasePrice),
    trueFinancedCost: serializeMoney(result.trueFinancedCost),
  };
}

export function toPurchaseSimulationEvaluationView(
  evaluation: PurchaseSimulationEvaluation,
): PurchaseSimulationEvaluationView {
  return {
    ...evaluation,
    result: toPurchaseSimulationResultView(evaluation.result),
    sourceSnapshot: {
      ...evaluation.sourceSnapshot,
      calculatedAt: evaluation.sourceSnapshot.calculatedAt.toISOString(),
    },
  };
}

export function toSavedPurchaseSimulationView(
  saved: SavedPurchaseSimulation,
): SavedPurchaseSimulationView {
  return {
    ...saved,
    createdAt: saved.createdAt.toISOString(),
    evaluation: toPurchaseSimulationEvaluationView(saved.evaluation),
    input: {
      ...saved.input,
      charges: saved.input.charges.map(chargeView),
      totalPurchasePrice: serializeMoney(saved.input.totalPurchasePrice),
    },
  };
}
