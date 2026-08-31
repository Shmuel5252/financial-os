import { z } from "zod";

import {
  moneyInputSchema,
  parseMajorMoney,
} from "@/lib/domain/money/money-input";
import {
  money,
  serializeMoney,
  type Money,
  type SerializedMoney,
} from "@/lib/domain/money/money";
import { InputValidationError } from "@/lib/errors/application-error";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const systemBudgetCategoryKeys = [
  "housing",
  "utilities",
  "insurance",
  "communications",
  "children",
  "subscriptions",
  "transport",
  "food",
  "debt_payment",
  "savings",
  "vehicle",
  "entertainment",
  "shopping",
  "restaurants",
  "other",
] as const;

export type SystemBudgetCategoryKey =
  (typeof systemBudgetCategoryKeys)[number];

export const rolloverPolicySchema = z.enum(["reset", "carry"]);
export type RolloverPolicy = z.infer<typeof rolloverPolicySchema>;

export const calendarMonthSchema = z
  .string()
  .regex(/^([1-9]\d{3})-(0[1-9]|1[0-2])$/);

const customCategoryIdPattern = /^custom:[0-9a-f]{24}$/i;
const systemCategoryIdPattern = /^system:[a-z_]+$/;

export const budgetCategoryIdSchema = z.string().refine((value) => {
  if (customCategoryIdPattern.test(value)) {
    return true;
  }
  if (!systemCategoryIdPattern.test(value)) {
    return false;
  }
  return systemBudgetCategoryKeys.includes(
    value.slice("system:".length) as SystemBudgetCategoryKey,
  );
}, "Expected a valid budget category identifier.");

export function systemCategoryId(
  key: SystemBudgetCategoryKey,
): `system:${SystemBudgetCategoryKey}` {
  return `system:${key}`;
}

export function systemCategoryKey(
  categoryId: string,
): SystemBudgetCategoryKey | null {
  if (!categoryId.startsWith("system:")) {
    return null;
  }
  const key = categoryId.slice("system:".length);
  return systemBudgetCategoryKeys.includes(key as SystemBudgetCategoryKey)
    ? (key as SystemBudgetCategoryKey)
    : null;
}

const nonNegativeMoneyInputSchema = moneyInputSchema.transform(
  (value, context) => {
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
  },
);

export const budgetMonthQuerySchema = z.object({
  month: calendarMonthSchema,
});

export const createBudgetCategoryCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  rolloverPolicy: rolloverPolicySchema.default("reset"),
});

export const updateBudgetCategoryCommandSchema = z.object({
  categoryId: budgetCategoryIdSchema,
  expectedVersion: z.number().int().min(0),
  hidden: z.boolean(),
  label: z.string().trim().min(1).max(80),
  rolloverPolicy: rolloverPolicySchema,
  sortOrder: z.number().int().min(0).max(10_000),
});

const allocationInputSchema = z.object({
  amount: nonNegativeMoneyInputSchema,
  categoryId: budgetCategoryIdSchema,
});

export const saveBudgetPeriodCommandSchema = z
  .object({
    allocations: z.array(allocationInputSchema).max(100),
    calendarMonth: calendarMonthSchema,
    expectedVersion: z.number().int().positive().nullable(),
  })
  .superRefine((value, context) => {
    const categoryIds = value.allocations.map((item) => item.categoryId);
    if (new Set(categoryIds).size !== categoryIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each category may be allocated only once.",
        path: ["allocations"],
      });
    }
  });

export const closeBudgetPeriodCommandSchema = z.object({
  calendarMonth: calendarMonthSchema,
  expectedVersion: z.number().int().positive(),
});

export const createBudgetCorrectionCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
  toCategoryId: budgetCategoryIdSchema,
  transactionId: z.string().regex(/^[0-9a-f]{24}$/i),
});

export const budgetScenarioCommandSchema = z.object({
  additionalExpense: nonNegativeMoneyInputSchema,
  additionalIncome: nonNegativeMoneyInputSchema,
  expenseReduction: nonNegativeMoneyInputSchema,
  investmentProceeds: nonNegativeMoneyInputSchema,
  targetBalance: nonNegativeMoneyInputSchema.nullable(),
  uncertainIncome: nonNegativeMoneyInputSchema,
});

export type BudgetCategory = Readonly<{
  categoryId: string;
  hidden: boolean;
  kind: "custom" | "system";
  label: string | null;
  rolloverPolicy: RolloverPolicy;
  sortOrder: number;
  systemKey: SystemBudgetCategoryKey | null;
  version: number;
}>;

export type BudgetAllocation = Readonly<{
  amount: Money;
  categoryId: string;
}>;

export type BudgetPeriodStatus = "closed" | "open";

export type BudgetPeriod = Readonly<{
  allocations: readonly BudgetAllocation[];
  calendarMonth: string;
  carryIn: readonly BudgetAllocation[];
  closedAt: Date | null;
  closingSnapshot: BudgetCalculation | null;
  createdAt: Date;
  currency: string;
  id: string;
  status: BudgetPeriodStatus;
  updatedAt: Date;
  version: number;
}>;

export type BudgetCorrection = Readonly<{
  at: Date;
  fromCategoryId: string | null;
  id: string;
  reason: string;
  toCategoryId: string;
  transactionId: string;
}>;

export type BudgetActivity = Readonly<{
  amount: Money;
  categoryId: string | null;
  date: string;
  id: string;
  kind: "expense" | "refund";
}>;

export type BudgetPlannedOutflow = Readonly<{
  amount: Money;
  categoryId: string | null;
  date: string;
  id: string;
}>;

export type BudgetCategoryCalculation = Readonly<{
  allocation: Money;
  carryIn: Money;
  carryOut: Money;
  categoryId: string;
  forecastRemaining: Money;
  forecastSpent: Money;
  remaining: Money;
  rolloverPolicy: RolloverPolicy;
  spent: Money;
}>;

export type BudgetCalculation = Readonly<{
  allocated: Money;
  calendarMonth: string;
  categorizedForecastSpent: Money;
  categorizedSpent: Money;
  confirmedIncome: Money;
  lines: readonly BudgetCategoryCalculation[];
  totalForecastSpent: Money;
  totalSpent: Money;
  unallocated: Money;
  uncategorizedForecastSpent: Money;
  uncategorizedSpent: Money;
  uncertainIncome: Money;
}>;

export type BudgetScenarioResult = Readonly<{
  additionalIncomeNeededToTarget: Money;
  baseConfirmedPosition: Money;
  delta: Money;
  gapToTarget: Money;
  hypothetical: true;
  scenarioPosition: Money;
  spendingReductionNeededToTarget: Money;
  targetBalance: Money;
}>;

const budgetDomainMoneySchema = z
  .object({
    amountMinor: z.bigint(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .transform((value) => money(value.amountMinor, value.currency));

const budgetCategoryCalculationSchema = z.object({
  allocation: budgetDomainMoneySchema,
  carryIn: budgetDomainMoneySchema,
  carryOut: budgetDomainMoneySchema,
  categoryId: budgetCategoryIdSchema,
  forecastRemaining: budgetDomainMoneySchema,
  forecastSpent: budgetDomainMoneySchema,
  remaining: budgetDomainMoneySchema,
  rolloverPolicy: rolloverPolicySchema,
  spent: budgetDomainMoneySchema,
});

export const budgetCalculationSchema = z.object({
  allocated: budgetDomainMoneySchema,
  calendarMonth: calendarMonthSchema,
  categorizedForecastSpent: budgetDomainMoneySchema,
  categorizedSpent: budgetDomainMoneySchema,
  confirmedIncome: budgetDomainMoneySchema,
  lines: z.array(budgetCategoryCalculationSchema).max(100),
  totalForecastSpent: budgetDomainMoneySchema,
  totalSpent: budgetDomainMoneySchema,
  unallocated: budgetDomainMoneySchema,
  uncategorizedForecastSpent: budgetDomainMoneySchema,
  uncategorizedSpent: budgetDomainMoneySchema,
  uncertainIncome: budgetDomainMoneySchema,
});

export type BudgetCategoryView = Omit<BudgetCategory, never>;

export type BudgetAllocationView = Readonly<{
  amount: SerializedMoney;
  categoryId: string;
}>;

export type BudgetCategoryCalculationView = Readonly<{
  allocation: SerializedMoney;
  carryIn: SerializedMoney;
  carryOut: SerializedMoney;
  categoryId: string;
  forecastRemaining: SerializedMoney;
  forecastSpent: SerializedMoney;
  remaining: SerializedMoney;
  rolloverPolicy: RolloverPolicy;
  spent: SerializedMoney;
}>;

export type BudgetCalculationView = Readonly<{
  allocated: SerializedMoney;
  calendarMonth: string;
  categorizedForecastSpent: SerializedMoney;
  categorizedSpent: SerializedMoney;
  confirmedIncome: SerializedMoney;
  lines: readonly BudgetCategoryCalculationView[];
  totalForecastSpent: SerializedMoney;
  totalSpent: SerializedMoney;
  unallocated: SerializedMoney;
  uncategorizedForecastSpent: SerializedMoney;
  uncategorizedSpent: SerializedMoney;
  uncertainIncome: SerializedMoney;
}>;

export type BudgetActivityView = Readonly<{
  amount: SerializedMoney;
  categoryId: string | null;
  correctionCount: number;
  date: string;
  id: string;
  kind: "expense" | "refund";
  merchant: string | null;
  sourceCategoryId: string | null;
}>;

export type BudgetPeriodView = Readonly<{
  allocations: readonly BudgetAllocationView[];
  calendarMonth: string;
  carryIn: readonly BudgetAllocationView[];
  closedAt: string | null;
  closingSnapshot: BudgetCalculationView | null;
  currency: string;
  id: string | null;
  status: BudgetPeriodStatus;
  version: number | null;
}>;

export type BudgetView = Readonly<{
  activities: readonly BudgetActivityView[];
  calculation: BudgetCalculationView;
  categories: readonly BudgetCategoryView[];
  coreForecast: Readonly<{
    calculatedAt: string;
    confirmedEndingBalance: SerializedMoney;
    evaluationEndDate: string;
    safeToSpend: SerializedMoney;
    safetyMargin: SerializedMoney;
    shortfall: SerializedMoney;
  }> | null;
  currentCalendarMonth: string;
  period: BudgetPeriodView;
}>;

export type BudgetScenarioView = Readonly<{
  additionalIncomeNeededToTarget: SerializedMoney;
  baseConfirmedPosition: SerializedMoney;
  delta: SerializedMoney;
  gapToTarget: SerializedMoney;
  hypothetical: true;
  scenarioPosition: SerializedMoney;
  spendingReductionNeededToTarget: SerializedMoney;
  targetBalance: SerializedMoney;
}>;

export function parseBudgetMonth(input: unknown): string {
  return parseUntrusted(budgetMonthQuerySchema, input).month;
}

export function parseBudgetCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseUntrusted(schema, input);
}

export function validateBudgetMoneyCurrency(
  values: readonly Money[],
  currency: string,
): void {
  if (values.some((value) => value.currency !== currency)) {
    throw new InputValidationError([
      { field: "currency", message: `Use the profile currency ${currency}.` },
    ]);
  }
}

export function toBudgetCalculationView(
  calculation: BudgetCalculation,
): BudgetCalculationView {
  return {
    allocated: serializeMoney(calculation.allocated),
    calendarMonth: calculation.calendarMonth,
    categorizedForecastSpent: serializeMoney(
      calculation.categorizedForecastSpent,
    ),
    categorizedSpent: serializeMoney(calculation.categorizedSpent),
    confirmedIncome: serializeMoney(calculation.confirmedIncome),
    lines: calculation.lines.map((line) => ({
      allocation: serializeMoney(line.allocation),
      carryIn: serializeMoney(line.carryIn),
      carryOut: serializeMoney(line.carryOut),
      categoryId: line.categoryId,
      forecastRemaining: serializeMoney(line.forecastRemaining),
      forecastSpent: serializeMoney(line.forecastSpent),
      remaining: serializeMoney(line.remaining),
      rolloverPolicy: line.rolloverPolicy,
      spent: serializeMoney(line.spent),
    })),
    totalForecastSpent: serializeMoney(calculation.totalForecastSpent),
    totalSpent: serializeMoney(calculation.totalSpent),
    unallocated: serializeMoney(calculation.unallocated),
    uncategorizedForecastSpent: serializeMoney(
      calculation.uncategorizedForecastSpent,
    ),
    uncategorizedSpent: serializeMoney(calculation.uncategorizedSpent),
    uncertainIncome: serializeMoney(calculation.uncertainIncome),
  };
}

export function toBudgetAllocationView(
  allocation: BudgetAllocation,
): BudgetAllocationView {
  return {
    amount: serializeMoney(allocation.amount),
    categoryId: allocation.categoryId,
  };
}

export function toBudgetScenarioView(
  result: BudgetScenarioResult,
): BudgetScenarioView {
  return {
    additionalIncomeNeededToTarget: serializeMoney(
      result.additionalIncomeNeededToTarget,
    ),
    baseConfirmedPosition: serializeMoney(result.baseConfirmedPosition),
    delta: serializeMoney(result.delta),
    gapToTarget: serializeMoney(result.gapToTarget),
    hypothetical: true,
    scenarioPosition: serializeMoney(result.scenarioPosition),
    spendingReductionNeededToTarget: serializeMoney(
      result.spendingReductionNeededToTarget,
    ),
    targetBalance: serializeMoney(result.targetBalance),
  };
}

export function zeroMoney(currency: string): Money {
  return money(0n, currency);
}
