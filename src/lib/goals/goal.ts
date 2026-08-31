import { z } from "zod";

import { moneyInputSchema, parseMajorMoney } from "@/lib/domain/money/money-input";
import { money, serializeMoney, type Money, type SerializedMoney } from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import { InputValidationError } from "@/lib/errors/application-error";
import type { SerializedDomainValue } from "@/lib/onboarding/manual-record";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const GOAL_ENGINE_VERSION = "goal-engine/1.0.0" as const;
export const GOAL_POLICY_VERSION = "goal-policy/2026-08-31" as const;
export const DEFAULT_SUSTAINED_SUCCESS_DAYS = 30;

const recordIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const uniqueRecordIdsSchema = z
  .array(recordIdSchema)
  .min(1)
  .max(50)
  .refine((values) => new Set(values).size === values.length, "Record scope must not contain duplicates.");
const optionalUniqueRecordIdsSchema = z
  .array(recordIdSchema)
  .max(50)
  .refine((values) => new Set(values).size === values.length, "Record scope must not contain duplicates.");
const categoryIdsSchema = z
  .array(z.string().min(1).max(80))
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length, "Category scope must not contain duplicates.");

function nonNegativeMoneyInput() {
  return moneyInputSchema.transform((value, context) => {
    try {
      const parsed = parseMajorMoney(value);
      if (parsed.amountMinor < 0n) {
        context.addIssue({ code: "custom", message: "Amount cannot be negative." });
        return z.NEVER;
      }
      return parsed;
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid money amount.",
      });
      return z.NEVER;
    }
  });
}

const fundScopeSchema = z.object({
  recordIds: uniqueRecordIdsSchema,
  source: z.enum(["accounts", "savings"]),
});

export const goalDefinitionConfigurationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("debt_free"),
    liabilityIds: uniqueRecordIdsSchema,
  }),
  z.object({
    accountIds: uniqueRecordIdsSchema,
    kind: z.literal("no_overdraft"),
    sustainedSuccessDays: z.number().int().min(1).max(366).default(DEFAULT_SUSTAINED_SUCCESS_DAYS),
  }),
  z.object({
    accountIds: uniqueRecordIdsSchema,
    cardIds: optionalUniqueRecordIdsSchema,
    horizonDays: z.number().int().min(1).max(366).default(30),
    kind: z.literal("no_credit_dependency"),
    liabilityIds: optionalUniqueRecordIdsSchema,
    sustainedSuccessDays: z.number().int().min(1).max(366).default(DEFAULT_SUSTAINED_SUCCESS_DAYS),
  }),
  z.object({
    fundScope: fundScopeSchema,
    kind: z.literal("emergency_fund"),
    targetBasis: z.discriminatedUnion("kind", [
      z.object({ amount: nonNegativeMoneyInput(), kind: z.literal("explicit_amount") }),
      z.object({
        essentialCategoryIds: categoryIdsSchema,
        kind: z.literal("months_of_essential_expenses"),
        months: z.number().int().min(1).max(36),
      }),
    ]),
  }),
  z.object({
    fundScope: fundScopeSchema,
    kind: z.literal("savings_target"),
    targetAmount: nonNegativeMoneyInput(),
  }),
  z.object({
    categoryIds: categoryIdsSchema,
    kind: z.literal("monthly_spending"),
    spendingCeiling: nonNegativeMoneyInput(),
  }),
  z.object({
    direction: z.enum(["decrease", "increase"]),
    kind: z.literal("custom"),
    metricLabel: z.string().trim().min(1).max(100),
    targetAmount: nonNegativeMoneyInput(),
  }),
]);

export const createGoalDefinitionCommandSchema = z.object({
  configuration: goalDefinitionConfigurationSchema,
  expectedDefinitionVersion: z.number().int().min(1).nullable(),
  expectedGoalRecordVersion: z.number().int().min(1),
  goalId: recordIdSchema,
  idempotencyKey: z.string().uuid(),
  targetDate: calendarDateSchema.nullable(),
});

export const evaluateGoalCommandSchema = z.object({
  goalId: recordIdSchema,
  idempotencyKey: z.string().uuid(),
  manualCurrentValue: nonNegativeMoneyInput().optional(),
});

export type GoalDefinitionConfiguration = z.infer<typeof goalDefinitionConfigurationSchema>;
export type CreateGoalDefinitionCommand = z.infer<typeof createGoalDefinitionCommandSchema>;
export type EvaluateGoalCommand = z.infer<typeof evaluateGoalCommandSchema>;

export type GoalDirection = "decrease" | "increase";
export type GoalVerification = "insufficient_data" | "manual_unverified" | "verified";
export type GoalLifecycleStatus =
  | "active"
  | "completed"
  | "insufficient_data"
  | "manual_unverified"
  | "regressed"
  | "target_reached_pending_confirmation";
export type GoalTrend = "improving" | "initial" | "regressing" | "unchanged";

export type GoalReportedEvidence = Readonly<{
  capturedAt: Date;
  currentValue: Money;
  goalRecordVersion: number;
  startingValue: Money;
  targetAmount: Money;
}>;

export type GoalDefinition = Readonly<{
  configuration: GoalDefinitionConfiguration;
  createdAt: Date;
  goalId: string;
  id: string;
  reportedEvidence: GoalReportedEvidence;
  targetDate: string | null;
  version: number;
}>;

export type GoalEvidenceSource = Readonly<{
  id: string;
  kind: "budget_period" | "engine_snapshot" | "goal_record" | "manual_record";
  version: number | null;
}>;

export type GoalMetricFact = Readonly<{
  key: string;
  value: Money;
}>;

export type GoalProgressResult = Readonly<{
  baselineValue: Money;
  completedAt: string | null;
  currentValue: Money;
  direction: GoalDirection;
  maintainedNow: boolean;
  normalizedProgressBasisPoints: number;
  qualifiedSince: string | null;
  rawProgressBasisPoints: string;
  remainingGap: Money;
  status: GoalLifecycleStatus;
  targetValue: Money;
  trend: GoalTrend;
  verification: GoalVerification;
}>;

export type GoalProgressEvidence = Readonly<{
  createdAt: Date;
  engineVersion: typeof GOAL_ENGINE_VERSION;
  evaluatedAt: Date;
  evaluationDate: string;
  evidenceHash: string;
  goalDefinitionId: string;
  goalId: string;
  goalVersion: number;
  id: string;
  metricFacts: readonly GoalMetricFact[];
  milestonesCrossed: readonly number[];
  policyVersion: typeof GOAL_POLICY_VERSION;
  reason: "baseline_established" | "evaluation" | "material_version_created";
  result: GoalProgressResult;
  sourceReferences: readonly GoalEvidenceSource[];
  timeZone: string;
}>;

export type GoalDefinitionView = Readonly<{
  configuration: SerializedDomainValue;
  createdAt: string;
  goalId: string;
  id: string;
  reportedEvidence: Readonly<{
    capturedAt: string;
    currentValue: SerializedMoney;
    goalRecordVersion: number;
    startingValue: SerializedMoney;
    targetAmount: SerializedMoney;
  }>;
  targetDate: string | null;
  version: number;
}>;

export type GoalProgressEvidenceView = Readonly<{
  createdAt: string;
  engineVersion: string;
  evaluatedAt: string;
  evaluationDate: string;
  goalDefinitionId: string;
  goalId: string;
  goalVersion: number;
  id: string;
  metricFacts: readonly Readonly<{ key: string; value: SerializedMoney }>[];
  milestonesCrossed: readonly number[];
  policyVersion: string;
  reason: GoalProgressEvidence["reason"];
  result: Omit<GoalProgressResult, "baselineValue" | "currentValue" | "remainingGap" | "targetValue"> &
    Readonly<{
      baselineValue: SerializedMoney;
      currentValue: SerializedMoney;
      remainingGap: SerializedMoney;
      targetValue: SerializedMoney;
    }>;
  sourceReferences: readonly GoalEvidenceSource[];
  timeZone: string;
}>;

export type GoalSourceOptionView = Readonly<{
  amount: SerializedMoney;
  id: string;
  label: string;
  metadata: string;
}>;

export type GoalCenterItemView = Readonly<{
  definition: GoalDefinitionView | null;
  history: readonly GoalProgressEvidenceView[];
  latestProgress: GoalProgressEvidenceView | null;
  reported: Readonly<{
    currentValue: SerializedMoney;
    id: string;
    priority: number;
    startingValue: SerializedMoney;
    targetAmount: SerializedMoney;
    targetDate: string | null;
    title: string;
    type: GoalDefinitionConfiguration["kind"];
    version: number;
  }>;
}>;

export type GoalCenterView = Readonly<{
  categories: readonly Readonly<{
    id: string;
    label: string | null;
    systemKey: string | null;
  }>[];
  currency: string;
  goals: readonly GoalCenterItemView[];
  sources: Readonly<{
    accounts: readonly GoalSourceOptionView[];
    cards: readonly GoalSourceOptionView[];
    liabilities: readonly GoalSourceOptionView[];
    savings: readonly GoalSourceOptionView[];
  }>;
}>;

function serializeDomainValue(value: unknown): SerializedDomainValue {
  if (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "bigint" &&
    typeof value.currency === "string"
  ) {
    return serializeMoney(value as Money);
  }
  if (Array.isArray(value)) return value.map(serializeDomainValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeDomainValue(item)]));
  }
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return value as null | boolean | number | string;
  }
  throw new RangeError("Unsupported goal domain value.");
}

export function toGoalDefinitionView(definition: GoalDefinition): GoalDefinitionView {
  return {
    configuration: serializeDomainValue(definition.configuration),
    createdAt: definition.createdAt.toISOString(),
    goalId: definition.goalId,
    id: definition.id,
    reportedEvidence: {
      capturedAt: definition.reportedEvidence.capturedAt.toISOString(),
      currentValue: serializeMoney(definition.reportedEvidence.currentValue),
      goalRecordVersion: definition.reportedEvidence.goalRecordVersion,
      startingValue: serializeMoney(definition.reportedEvidence.startingValue),
      targetAmount: serializeMoney(definition.reportedEvidence.targetAmount),
    },
    targetDate: definition.targetDate,
    version: definition.version,
  };
}

export function toGoalProgressEvidenceView(evidence: GoalProgressEvidence): GoalProgressEvidenceView {
  return {
    createdAt: evidence.createdAt.toISOString(),
    engineVersion: evidence.engineVersion,
    evaluatedAt: evidence.evaluatedAt.toISOString(),
    evaluationDate: evidence.evaluationDate,
    goalDefinitionId: evidence.goalDefinitionId,
    goalId: evidence.goalId,
    goalVersion: evidence.goalVersion,
    id: evidence.id,
    metricFacts: evidence.metricFacts.map((fact) => ({ key: fact.key, value: serializeMoney(fact.value) })),
    milestonesCrossed: evidence.milestonesCrossed,
    policyVersion: evidence.policyVersion,
    reason: evidence.reason,
    result: {
      ...evidence.result,
      baselineValue: serializeMoney(evidence.result.baselineValue),
      currentValue: serializeMoney(evidence.result.currentValue),
      remainingGap: serializeMoney(evidence.result.remainingGap),
      targetValue: serializeMoney(evidence.result.targetValue),
    },
    sourceReferences: evidence.sourceReferences,
    timeZone: evidence.timeZone,
  };
}

export function parseGoalCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    return parseUntrusted(schema, input);
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw error;
  }
}

export const goalDomainMoneySchema = z
  .object({ amountMinor: z.bigint(), currency: z.string().regex(/^[A-Z]{3}$/) })
  .transform((value) => money(value.amountMinor, value.currency));

export const goalDefinitionConfigurationDomainSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("debt_free"), liabilityIds: uniqueRecordIdsSchema }),
  z.object({
    accountIds: uniqueRecordIdsSchema,
    kind: z.literal("no_overdraft"),
    sustainedSuccessDays: z.number().int().min(1).max(366),
  }),
  z.object({
    accountIds: uniqueRecordIdsSchema,
    cardIds: optionalUniqueRecordIdsSchema,
    horizonDays: z.number().int().min(1).max(366),
    kind: z.literal("no_credit_dependency"),
    liabilityIds: optionalUniqueRecordIdsSchema,
    sustainedSuccessDays: z.number().int().min(1).max(366),
  }),
  z.object({
    fundScope: fundScopeSchema,
    kind: z.literal("emergency_fund"),
    targetBasis: z.discriminatedUnion("kind", [
      z.object({ amount: goalDomainMoneySchema, kind: z.literal("explicit_amount") }),
      z.object({
        essentialCategoryIds: categoryIdsSchema,
        kind: z.literal("months_of_essential_expenses"),
        months: z.number().int().min(1).max(36),
      }),
    ]),
  }),
  z.object({
    fundScope: fundScopeSchema,
    kind: z.literal("savings_target"),
    targetAmount: goalDomainMoneySchema,
  }),
  z.object({
    categoryIds: categoryIdsSchema,
    kind: z.literal("monthly_spending"),
    spendingCeiling: goalDomainMoneySchema,
  }),
  z.object({
    direction: z.enum(["decrease", "increase"]),
    kind: z.literal("custom"),
    metricLabel: z.string().trim().min(1).max(100),
    targetAmount: goalDomainMoneySchema,
  }),
]);
