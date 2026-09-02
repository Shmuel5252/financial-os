import { z } from "zod";

import {
  DEBT_STRATEGY_ENGINE_VERSION,
  DEBT_STRATEGY_MAX_DEBTS,
  DEBT_STRATEGY_POLICY_VERSION,
  type DebtStrategyComparison,
  type DebtStrategyDebt,
  type DebtStrategyInput,
} from "@/lib/domain/debt-strategies/debt-strategy-engine";
import { moneyInputSchema } from "@/lib/domain/money/money-input";
import { money, serializeMoney, type SerializedMoney } from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const provenanceSchema = z.object({
  kind: z.enum(["assumption", "contract", "user_reported"]),
  note: z.string().trim().max(240).nullable().default(null),
});
const rateSchema = z.object({
  annualRateBps: z.number().int().min(-100_000).max(100_000),
  effectiveDate: calendarDateSchema,
  provenance: provenanceSchema,
});
const interestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("none"), provenance: provenanceSchema }),
  z.object({
    accrualConvention: z.enum(["actual_360", "actual_365", "monthly_compounded"]),
    kind: z.literal("fixed_rate"),
    rateApplication: z.enum(["effective_date", "payment_date", "period_start"]),
    rates: z.array(rateSchema).length(1),
  }),
  z.object({
    accrualConvention: z.enum(["actual_360", "actual_365", "monthly_compounded"]),
    kind: z.literal("variable_rate"),
    rateApplication: z.enum(["effective_date", "payment_date", "period_start"]),
    rates: z.array(rateSchema).min(1).max(24),
  }),
]);
const minimumSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ amount: moneyInputSchema, kind: z.literal("fixed"), provenance: provenanceSchema }),
  z.object({
    basis: z.enum(["principal", "total_due"]),
    floor: moneyInputSchema,
    kind: z.literal("formula"),
    percentageBps: z.number().int().min(0).max(100_000),
    provenance: provenanceSchema,
  }),
]);
const prepaymentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("free"), provenance: provenanceSchema }),
  z.object({ amount: moneyInputSchema, kind: z.literal("fixed_fee"), provenance: provenanceSchema }),
  z.object({
    kind: z.literal("percentage_of_principal"),
    percentageBps: z.number().int().min(0).max(100_000),
    provenance: provenanceSchema,
  }),
]);

export const debtTermCommandSchema = z.object({
  allocationOrder: z.object({
    order: z.array(z.enum(["fees", "interest", "principal"])).length(3),
    provenance: provenanceSchema,
  }).nullable(),
  fees: z.array(z.object({
    amount: moneyInputSchema,
    dueDate: calendarDateSchema,
    label: z.string().trim().min(1).max(80),
    provenance: provenanceSchema,
  })).max(24).default([]),
  feesKnown: z.boolean(),
  feesProvenance: provenanceSchema.nullable(),
  firstPaymentDate: calendarDateSchema,
  interest: interestSchema,
  loanId: objectIdSchema,
  minimumPayment: minimumSchema,
  prepayment: prepaymentSchema,
}).strict();

const commandFields = {
  customPriority: z.array(objectIdSchema).max(DEBT_STRATEGY_MAX_DEBTS).default([]),
  debtTerms: z.array(debtTermCommandSchema).min(1).max(DEBT_STRATEGY_MAX_DEBTS),
  extraPayment: moneyInputSchema,
  extraPaymentStartDate: calendarDateSchema,
} as const;

export const evaluateDebtStrategyCommandSchema = z.object(commandFields).strict();
export const saveDebtStrategyCommandSchema = z.object({
  ...commandFields,
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(1).max(80).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
}).strict();
export const debtStrategyPageQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type EvaluateDebtStrategyCommand = z.infer<typeof evaluateDebtStrategyCommandSchema>;
export type SaveDebtStrategyCommand = z.infer<typeof saveDebtStrategyCommandSchema>;

export type SavedDebtStrategy = Readonly<{
  comparison: DebtStrategyComparison;
  createdAt: Date;
  id: string;
  input: DebtStrategyInput;
  name: string | null;
  note: string | null;
  schemaVersion: 1;
}>;

export type DebtStrategyComparisonView = Readonly<{
  assessments: DebtStrategyComparison["assessments"];
  calculationCompleteness: DebtStrategyComparison["calculationCompleteness"];
  currency: string;
  engineVersion: string;
  evaluationDate: string;
  extraPayment: SerializedMoney;
  extraPaymentStartDate: string;
  policyVersion: string;
  requiredMonthlyPayment: SerializedMoney;
  results: readonly Readonly<{
    calculationCompleteness: DebtStrategyComparison["calculationCompleteness"];
    costComparable: boolean;
    costSavedVersusBaseline: SerializedMoney | null;
    excludedDebtIds: readonly string[];
    payoffDate: string | null;
    payoffOrder: DebtStrategyComparison["results"][number]["payoffOrder"];
    payoffReached: boolean;
    scheduledPaymentTotal: SerializedMoney;
    strategy: DebtStrategyComparison["results"][number]["strategy"];
    timeSavedDaysVersusBaseline: number | null;
    timeline: readonly Readonly<{
      calendarDate: string;
      debtId: string;
      feesAfter: SerializedMoney;
      feesAssessed: SerializedMoney;
      interestAccrued: SerializedMoney;
      interestAfter: SerializedMoney;
      kind: "extra" | "scheduled";
      payment: SerializedMoney;
      principalAfter: SerializedMoney;
    }>[];
    timelineTruncated: boolean;
    totalInterest: SerializedMoney;
    totalKnownFees: SerializedMoney;
    totalRepayment: SerializedMoney;
  }>[];
}>;

export type DebtStrategyCenterView = Readonly<{
  currency: string;
  evaluationDate: string;
  loans: readonly Readonly<{
    id: string;
    label: string;
    monthlyPayment: SerializedMoney;
    nextPaymentDate: string;
    remainingBalance: SerializedMoney;
    reportedAnnualInterestRateBps: number;
    version: number;
  }>[];
  saved: readonly Readonly<{
    comparison: DebtStrategyComparisonView;
    createdAt: string;
    id: string;
    name: string | null;
    note: string | null;
  }>[];
  timeZone: string;
}>;

const domainMoneySchema = z.object({
  amountMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).transform((value) => money(value.amountMinor, value.currency));
const domainProvenanceSchema = provenanceSchema.required({ note: true });
const domainRateSchema = rateSchema.extend({ provenance: domainProvenanceSchema });
const domainInterestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("none"), provenance: domainProvenanceSchema }),
  z.object({
    accrualConvention: z.enum(["actual_360", "actual_365", "monthly_compounded"]),
    kind: z.literal("fixed_rate"),
    rateApplication: z.enum(["effective_date", "payment_date", "period_start"]),
    rates: z.array(domainRateSchema).length(1),
  }),
  z.object({
    accrualConvention: z.enum(["actual_360", "actual_365", "monthly_compounded"]),
    kind: z.literal("variable_rate"),
    rateApplication: z.enum(["effective_date", "payment_date", "period_start"]),
    rates: z.array(domainRateSchema).min(1).max(24),
  }),
]);
const domainMinimumSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ amount: domainMoneySchema, kind: z.literal("fixed"), provenance: domainProvenanceSchema }),
  z.object({
    basis: z.enum(["principal", "total_due"]),
    floor: domainMoneySchema,
    kind: z.literal("formula"),
    percentageBps: z.number().int(),
    provenance: domainProvenanceSchema,
  }),
]);
const domainPrepaymentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("free"), provenance: domainProvenanceSchema }),
  z.object({ amount: domainMoneySchema, kind: z.literal("fixed_fee"), provenance: domainProvenanceSchema }),
  z.object({ kind: z.literal("percentage_of_principal"), percentageBps: z.number().int(), provenance: domainProvenanceSchema }),
]);

export const debtStrategyDebtDomainSchema: z.ZodType<DebtStrategyDebt> = z.object({
  allocationOrder: z.object({
    order: z.array(z.enum(["fees", "interest", "principal"])).length(3),
    provenance: domainProvenanceSchema,
  }).nullable(),
  balance: domainMoneySchema,
  fees: z.array(z.object({
    amount: domainMoneySchema,
    dueDate: calendarDateSchema,
    label: z.string(),
    provenance: domainProvenanceSchema,
  })),
  feesKnown: z.boolean(),
  feesProvenance: domainProvenanceSchema.nullable(),
  firstPaymentDate: calendarDateSchema,
  id: objectIdSchema,
  interest: domainInterestSchema,
  label: z.string().min(1),
  minimumPayment: domainMinimumSchema,
  prepayment: domainPrepaymentSchema,
  sourceVersion: z.number().int().positive(),
});

export const debtStrategyInputDomainSchema: z.ZodType<DebtStrategyInput> = z.object({
  customPriority: z.array(objectIdSchema),
  debts: z.array(debtStrategyDebtDomainSchema).min(1).max(DEBT_STRATEGY_MAX_DEBTS),
  evaluationDate: calendarDateSchema,
  extraPayment: domainMoneySchema,
  extraPaymentStartDate: calendarDateSchema,
});

const paymentPointDomainSchema = z.object({
  calendarDate: calendarDateSchema,
  debtId: objectIdSchema,
  feesAfter: domainMoneySchema,
  feesAssessed: domainMoneySchema,
  interestAccrued: domainMoneySchema,
  interestAfter: domainMoneySchema,
  kind: z.enum(["extra", "scheduled"]),
  payment: domainMoneySchema,
  principalAfter: domainMoneySchema,
});
const debtStrategyResultDomainSchema = z.object({
  calculationCompleteness: z.enum(["assumption_based", "insufficient_information", "verified"]),
  costComparable: z.boolean(),
  costSavedVersusBaseline: domainMoneySchema.nullable(),
  excludedDebtIds: z.array(objectIdSchema),
  payoffDate: calendarDateSchema.nullable(),
  payoffOrder: z.array(z.object({ debtId: objectIdSchema, payoffDate: calendarDateSchema })),
  payoffReached: z.boolean(),
  scheduledPaymentTotal: domainMoneySchema,
  strategy: z.enum(["avalanche", "baseline", "custom", "snowball"]),
  timeSavedDaysVersusBaseline: z.number().int().nullable(),
  timeline: z.array(paymentPointDomainSchema),
  totalInterest: domainMoneySchema,
  totalKnownFees: domainMoneySchema,
  totalRepayment: domainMoneySchema,
});
export const debtStrategyComparisonDomainSchema: z.ZodType<DebtStrategyComparison> = z.object({
  assessments: z.array(z.object({
    completeness: z.enum(["assumption_based", "insufficient_information", "verified"]),
    debtId: objectIdSchema,
    reasons: z.array(z.enum([
      "assumption_terms",
      "missing_applicable_rate",
      "unknown_allocation_order",
      "unknown_fee_terms",
      "unknown_interest_model",
      "unknown_minimum_payment",
      "unknown_prepayment_terms",
    ])),
  })),
  calculationCompleteness: z.enum(["assumption_based", "insufficient_information", "verified"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  engineVersion: z.literal(DEBT_STRATEGY_ENGINE_VERSION),
  evaluationDate: calendarDateSchema,
  extraPayment: domainMoneySchema,
  extraPaymentStartDate: calendarDateSchema,
  policyVersion: z.literal(DEBT_STRATEGY_POLICY_VERSION),
  requiredMonthlyPayment: domainMoneySchema,
  results: z.array(debtStrategyResultDomainSchema).length(4),
});

export function parseDebtStrategyCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseUntrusted(schema, input);
}

export function toDebtStrategyComparisonView(comparison: DebtStrategyComparison): DebtStrategyComparisonView {
  return {
    ...comparison,
    extraPayment: serializeMoney(comparison.extraPayment),
    requiredMonthlyPayment: serializeMoney(comparison.requiredMonthlyPayment),
    results: comparison.results.map((result) => {
      const timeline = result.timeline.slice(0, 240);
      return {
        ...result,
        costSavedVersusBaseline: result.costSavedVersusBaseline === null ? null : serializeMoney(result.costSavedVersusBaseline),
        scheduledPaymentTotal: serializeMoney(result.scheduledPaymentTotal),
        timeline: timeline.map((point) => ({
          ...point,
          feesAfter: serializeMoney(point.feesAfter),
          feesAssessed: serializeMoney(point.feesAssessed),
          interestAccrued: serializeMoney(point.interestAccrued),
          interestAfter: serializeMoney(point.interestAfter),
          payment: serializeMoney(point.payment),
          principalAfter: serializeMoney(point.principalAfter),
        })),
        timelineTruncated: timeline.length < result.timeline.length,
        totalInterest: serializeMoney(result.totalInterest),
        totalKnownFees: serializeMoney(result.totalKnownFees),
        totalRepayment: serializeMoney(result.totalRepayment),
      };
    }),
  };
}

function serializeDebt(debt: DebtStrategyDebt) {
  return {
    ...debt,
    balance: serializeMoney(debt.balance),
    fees: debt.fees.map((fee) => ({ ...fee, amount: serializeMoney(fee.amount) })),
    minimumPayment: debt.minimumPayment.kind === "fixed"
      ? { ...debt.minimumPayment, amount: serializeMoney(debt.minimumPayment.amount) }
      : debt.minimumPayment.kind === "formula"
        ? { ...debt.minimumPayment, floor: serializeMoney(debt.minimumPayment.floor) }
        : debt.minimumPayment,
    prepayment: debt.prepayment.kind === "fixed_fee"
      ? { ...debt.prepayment, amount: serializeMoney(debt.prepayment.amount) }
      : debt.prepayment,
  };
}

export function toSavedDebtStrategyView(saved: SavedDebtStrategy) {
  return {
    comparison: toDebtStrategyComparisonView(saved.comparison),
    createdAt: saved.createdAt.toISOString(),
    id: saved.id,
    input: {
      ...saved.input,
      debts: saved.input.debts.map(serializeDebt),
      extraPayment: serializeMoney(saved.input.extraPayment),
    },
    name: saved.name,
    note: saved.note,
    schemaVersion: saved.schemaVersion,
  };
}

export type SavedDebtStrategyView = ReturnType<typeof toSavedDebtStrategyView>;

export function assertDebtStrategyVersions(comparison: DebtStrategyComparison): void {
  if (comparison.engineVersion !== DEBT_STRATEGY_ENGINE_VERSION || comparison.policyVersion !== DEBT_STRATEGY_POLICY_VERSION) {
    throw new RangeError("Stored debt-strategy calculation version is invalid.");
  }
}
