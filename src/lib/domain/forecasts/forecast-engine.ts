import { z } from "zod";

import {
  addCalendarDays,
  compareCalendarDates,
} from "@/lib/domain/financial-engine/financial-calendar";
import type {
  FinancialEngineResult,
  FinancialTimelinePoint,
} from "@/lib/domain/financial-engine/financial-engine";
import {
  addMoney,
  money,
  subtractMoney,
  type Money,
} from "@/lib/domain/money/money";
import {
  calendarDateSchema,
  type CalendarDate,
} from "@/lib/domain/time/financial-time";

export const FORECAST_ENGINE_VERSION = "forecast-engine-v1" as const;
export const FORECAST_POLICY_VERSION = "operational-forecast-2026-09-01" as const;
export const FORECAST_CONFIDENCE_VERSION = "forecast-confidence-v1" as const;
export const FORECAST_SCENARIO_ENGINE_VERSION = "forecast-scenario-v1" as const;
export const FORECAST_HORIZONS = [7, 30, 60, 90] as const;
export const DEFAULT_FORECAST_HORIZON = 30;

export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];
export type ForecastConfidence = "HIGH" | "LOW" | "MEDIUM";
export type ForecastTruthStatus = "confirmed" | "estimated";
export type ForecastEventType = "income" | "outflow";

export type ForecastRecurringEvidence = Readonly<{
  amount: Money;
  evidence: readonly Readonly<{
    amount: Money;
    date: CalendarDate;
  }>[];
  periodDays: number;
  reviewState: "confirmed" | "dismissed" | "reopened" | null;
  sourceReference: string;
  sourceVersion: string;
}>;

export type ForecastEvent = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  confidence: ForecastConfidence | null;
  id: string;
  provenance: Readonly<{
    evidenceCount: number;
    reviewed: boolean;
    sourceVersion: string;
  }>;
  source: "financial_engine" | "phase_3_uncertain_income" | "phase_10_recurrence";
  sourceReference: string;
  truthStatus: ForecastTruthStatus;
  type: ForecastEventType;
}>;

export type ForecastTimelinePoint = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  confirmedBalance: Money;
  eventId: string;
  projectedBalance: Money;
  safetyMargin: Money;
  truthStatus: ForecastTruthStatus;
  type: ForecastEventType | "margin_boundary";
}>;

export type ForecastResult = Readonly<{
  baseline: Money;
  confidence: ForecastConfidence;
  confidenceReasons: readonly ForecastConfidenceReason[];
  confidenceVersion: typeof FORECAST_CONFIDENCE_VERSION;
  confirmedEndBalance: Money;
  confirmedMinimumBalance: Money;
  currency: string;
  currentSafeToSpend: Money;
  dataFreshness: "FRESH" | "STALE";
  duplicateEstimatesSuppressed: number;
  engineVersion: typeof FORECAST_ENGINE_VERSION;
  estimatedEventCount: number;
  evaluationDate: CalendarDate;
  events: readonly ForecastEvent[];
  firstBelowSafetyMarginDate: CalendarDate | null;
  firstBelowZeroDate: CalendarDate | null;
  freshnessReasons: readonly string[];
  horizonDays: ForecastHorizon;
  horizonEndDate: CalendarDate;
  materialObligations: readonly Readonly<{
    amount: Money;
    calendarDate: CalendarDate;
    sourceReference: string;
  }>[];
  policyVersion: typeof FORECAST_POLICY_VERSION;
  projectedEndBalance: Money;
  projectedMinimumBalance: Money;
  projectedMinimumDate: CalendarDate;
  sourceEngineVersion: string;
  sourcePolicyVersion: string;
  timeline: readonly ForecastTimelinePoint[];
}>;

export type ForecastConfidenceReason =
  | "ALL_ESTIMATES_HIGH"
  | "ESTIMATE_LOW"
  | "ESTIMATES_MIXED"
  | "INSUFFICIENT_PREDICTIVE_EVIDENCE"
  | "SOURCE_STALE";

export type ForecastScenarioAdjustmentKind =
  | "additional_expense"
  | "additional_income"
  | "card_payment"
  | "expense_reduction"
  | "loan_payment"
  | "savings_transfer";

export type ForecastScenarioAdjustment = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  kind: ForecastScenarioAdjustmentKind;
}>;

export type ForecastScenarioResult = Readonly<{
  adjustments: readonly ForecastScenarioAdjustment[];
  baselineProjectedEndBalance: Money;
  currency: string;
  engineVersion: typeof FORECAST_SCENARIO_ENGINE_VERSION;
  firstBelowSafetyMarginDate: CalendarDate | null;
  firstBelowZeroDate: CalendarDate | null;
  forecastEngineVersion: typeof FORECAST_ENGINE_VERSION;
  forecastPolicyVersion: typeof FORECAST_POLICY_VERSION;
  horizonDays: ForecastHorizon;
  horizonEndDate: CalendarDate;
  policyVersion: typeof FORECAST_POLICY_VERSION;
  projectedEndBalance: Money;
  projectedEndDelta: Money;
  projectedMinimumBalance: Money;
  projectedMinimumDate: CalendarDate;
  timeline: readonly Readonly<{
    amount: Money;
    calendarDate: CalendarDate;
    kind: ForecastScenarioAdjustmentKind | "forecast_event" | "margin_boundary";
    projectedBalance: Money;
    safetyMargin: Money;
  }>[];
}>;

const domainMoneySchema = z.object({
  amountMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).transform((value) => money(value.amountMinor, value.currency));

const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

const forecastEventSchema = z.object({
  amount: domainMoneySchema,
  calendarDate: calendarDateSchema,
  confidence: confidenceSchema.nullable(),
  id: z.string().min(1),
  provenance: z.object({
    evidenceCount: z.number().int().min(0),
    reviewed: z.boolean(),
    sourceVersion: z.string().min(1),
  }),
  source: z.enum([
    "financial_engine",
    "phase_3_uncertain_income",
    "phase_10_recurrence",
  ]),
  sourceReference: z.string().min(1),
  truthStatus: z.enum(["confirmed", "estimated"]),
  type: z.enum(["income", "outflow"]),
});

export const forecastResultSchema: z.ZodType<ForecastResult> = z.object({
  baseline: domainMoneySchema,
  confidence: confidenceSchema,
  confidenceReasons: z.array(z.enum([
    "ALL_ESTIMATES_HIGH",
    "ESTIMATE_LOW",
    "ESTIMATES_MIXED",
    "INSUFFICIENT_PREDICTIVE_EVIDENCE",
    "SOURCE_STALE",
  ])),
  confidenceVersion: z.literal(FORECAST_CONFIDENCE_VERSION),
  confirmedEndBalance: domainMoneySchema,
  confirmedMinimumBalance: domainMoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  currentSafeToSpend: domainMoneySchema,
  dataFreshness: z.enum(["FRESH", "STALE"]),
  duplicateEstimatesSuppressed: z.number().int().min(0),
  engineVersion: z.literal(FORECAST_ENGINE_VERSION),
  estimatedEventCount: z.number().int().min(0),
  evaluationDate: calendarDateSchema,
  events: z.array(forecastEventSchema),
  firstBelowSafetyMarginDate: calendarDateSchema.nullable(),
  firstBelowZeroDate: calendarDateSchema.nullable(),
  freshnessReasons: z.array(z.string().min(1)),
  horizonDays: z.union([
    z.literal(7), z.literal(30), z.literal(60), z.literal(90),
  ]),
  horizonEndDate: calendarDateSchema,
  materialObligations: z.array(z.object({
    amount: domainMoneySchema,
    calendarDate: calendarDateSchema,
    sourceReference: z.string().min(1),
  })),
  policyVersion: z.literal(FORECAST_POLICY_VERSION),
  projectedEndBalance: domainMoneySchema,
  projectedMinimumBalance: domainMoneySchema,
  projectedMinimumDate: calendarDateSchema,
  sourceEngineVersion: z.string().min(1),
  sourcePolicyVersion: z.string().min(1),
  timeline: z.array(z.object({
    amount: domainMoneySchema,
    calendarDate: calendarDateSchema,
    confirmedBalance: domainMoneySchema,
    eventId: z.string().min(1),
    projectedBalance: domainMoneySchema,
    safetyMargin: domainMoneySchema,
    truthStatus: z.enum(["confirmed", "estimated"]),
    type: z.enum(["income", "outflow", "margin_boundary"]),
  })),
});

export const forecastScenarioResultSchema: z.ZodType<ForecastScenarioResult> = z.object({
  adjustments: z.array(z.object({
    amount: domainMoneySchema,
    calendarDate: calendarDateSchema,
    kind: z.enum([
      "additional_expense", "additional_income", "card_payment",
      "expense_reduction", "loan_payment", "savings_transfer",
    ]),
  })),
  baselineProjectedEndBalance: domainMoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  engineVersion: z.literal(FORECAST_SCENARIO_ENGINE_VERSION),
  firstBelowSafetyMarginDate: calendarDateSchema.nullable(),
  firstBelowZeroDate: calendarDateSchema.nullable(),
  forecastEngineVersion: z.literal(FORECAST_ENGINE_VERSION),
  forecastPolicyVersion: z.literal(FORECAST_POLICY_VERSION),
  horizonDays: z.union([
    z.literal(7), z.literal(30), z.literal(60), z.literal(90),
  ]),
  horizonEndDate: calendarDateSchema,
  policyVersion: z.literal(FORECAST_POLICY_VERSION),
  projectedEndBalance: domainMoneySchema,
  projectedEndDelta: domainMoneySchema,
  projectedMinimumBalance: domainMoneySchema,
  projectedMinimumDate: calendarDateSchema,
  timeline: z.array(z.object({
    amount: domainMoneySchema,
    calendarDate: calendarDateSchema,
    kind: z.enum([
      "additional_expense", "additional_income", "card_payment",
      "expense_reduction", "forecast_event", "loan_payment",
      "margin_boundary", "savings_transfer",
    ]),
    projectedBalance: domainMoneySchema,
    safetyMargin: domainMoneySchema,
  })),
});

function epochDay(date: CalendarDate): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
}

function median(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new RangeError("A median needs evidence.");
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

function maximumAmountDeviationWithin(
  values: readonly bigint[],
  center: bigint,
  basisPoints: bigint,
): boolean {
  if (center <= 0n) return false;
  return values.every((value) => {
    const deviation = value >= center ? value - center : center - value;
    return deviation * 10_000n <= center * basisPoints;
  });
}

function confidenceForEvidence(
  evidence: ForecastRecurringEvidence,
  evaluationDate: CalendarDate,
): ForecastConfidence {
  const observations = [...evidence.evidence].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  if (observations.length < 3) return "LOW";
  const latest = observations.at(-1)!;
  const recencyDays = epochDay(evaluationDate) - epochDay(latest.date);
  if (recencyDays < 0) return "LOW";
  const materialStaleness = Math.max(45, 2 * evidence.periodDays + 14);
  const gaps = observations.slice(1).map((item, index) =>
    epochDay(item.date) - epochDay(observations[index]!.date),
  );
  const maximumTimingDeviation = Math.max(
    ...gaps.map((gap) => Math.abs(gap - evidence.periodDays)),
  );
  const amounts = observations.map((item) => item.amount.amountMinor);
  const typicalAmount = median(amounts);
  if (
    recencyDays > materialStaleness ||
    maximumTimingDeviation > 7 ||
    !maximumAmountDeviationWithin(amounts, typicalAmount, 1_000n)
  ) return "LOW";
  const high =
    observations.length >= 5 &&
    recencyDays <= evidence.periodDays + 7 &&
    maximumTimingDeviation <= 3 &&
    maximumAmountDeviationWithin(amounts, typicalAmount, 500n) &&
    (evidence.reviewState === "confirmed" || observations.length >= 6);
  return high ? "HIGH" : "MEDIUM";
}

function validateCurrency(value: Money, currency: string, field: string) {
  if (value.currency !== currency) throw new RangeError(`${field} currency differs.`);
}

function eventFromEngine(
  point: FinancialTimelinePoint,
  index: number,
  sourceReferencePrefix: string,
): ForecastEvent | null {
  if (point.kind === "margin_boundary") return null;
  const confirmed = point.kind !== "uncertain_income";
  return {
    amount: point.amount,
    calendarDate: point.calendarDate,
    confidence: confirmed ? null : "LOW",
    id: `engine-${index + 1}`,
    provenance: {
      evidenceCount: 1,
      reviewed: confirmed,
      sourceVersion: FORECAST_POLICY_VERSION,
    },
    source: confirmed ? "financial_engine" : "phase_3_uncertain_income",
    sourceReference: `${sourceReferencePrefix}:${point.eventId}`,
    truthStatus: confirmed ? "confirmed" : "estimated",
    type: point.kind === "obligation" ? "outflow" : "income",
  };
}

function eventRank(event: ForecastEvent | Readonly<{ type: "margin_boundary" }>): number {
  if (event.type === "margin_boundary") return 0;
  if (event.type === "outflow") return 1;
  return 2;
}

function marginForDate(
  baseline: FinancialEngineResult,
  date: CalendarDate,
): Money {
  let applicable = baseline.safetyMarginAtEvaluation;
  for (const point of baseline.timeline) {
    if (point.calendarDate > date) break;
    applicable = point.safetyMargin;
  }
  return applicable;
}

export function calculateForecast(input: Readonly<{
  baseline: FinancialEngineResult;
  dataFreshness: "FRESH" | "STALE";
  freshnessReasons: readonly string[];
  horizonDays: ForecastHorizon;
  intelligenceEvidence: readonly ForecastRecurringEvidence[];
  sourceReferencePrefix: string;
}>): ForecastResult {
  if (!FORECAST_HORIZONS.includes(input.horizonDays)) {
    throw new RangeError("The operational forecast horizon is unsupported.");
  }
  if (input.baseline.horizonDays < input.horizonDays) {
    throw new RangeError("The source Financial Engine horizon is too short.");
  }
  const currency = input.baseline.currency;
  const horizonEndDate = addCalendarDays(
    input.baseline.evaluationDate,
    input.horizonDays - 1,
  );
  const engineEvents = input.baseline.timeline
    .filter((point) => point.calendarDate <= horizonEndDate)
    .map((point, index) => eventFromEngine(point, index, input.sourceReferencePrefix))
    .filter((event): event is ForecastEvent => event !== null);
  const confirmedKeys = new Set(
    engineEvents
      .filter((event) => event.truthStatus === "confirmed")
      .map((event) => [event.calendarDate, event.type, event.amount.currency,
        event.amount.amountMinor.toString()].join("|")),
  );
  const estimates: ForecastEvent[] = [];
  let suppressed = 0;
  for (const evidence of input.intelligenceEvidence) {
    if (evidence.reviewState === "dismissed") continue;
    if (!Number.isInteger(evidence.periodDays) || evidence.periodDays < 1 || evidence.periodDays > 366) {
      continue;
    }
    validateCurrency(evidence.amount, currency, "recurring evidence");
    for (const item of evidence.evidence) validateCurrency(item.amount, currency, "recurring evidence item");
    const ordered = [...evidence.evidence].sort((left, right) => left.date.localeCompare(right.date));
    if (ordered.length === 0) continue;
    const amount = money(median(ordered.map((item) => item.amount.amountMinor)), currency);
    let date = addCalendarDays(ordered.at(-1)!.date, evidence.periodDays);
    const confidence = confidenceForEvidence(evidence, input.baseline.evaluationDate);
    let sequence = 0;
    while (date < input.baseline.evaluationDate) date = addCalendarDays(date, evidence.periodDays);
    while (date <= horizonEndDate) {
      const duplicateKey = [date, "outflow", currency, amount.amountMinor.toString()].join("|");
      if (confirmedKeys.has(duplicateKey)) {
        suppressed += 1;
      } else {
        estimates.push({
          amount,
          calendarDate: date,
          confidence,
          id: `estimate-${estimates.length + 1}`,
          provenance: {
            evidenceCount: ordered.length,
            reviewed: evidence.reviewState === "confirmed",
            sourceVersion: evidence.sourceVersion,
          },
          source: "phase_10_recurrence",
          sourceReference: `${evidence.sourceReference}:${sequence + 1}`,
          truthStatus: "estimated",
          type: "outflow",
        });
      }
      sequence += 1;
      date = addCalendarDays(date, evidence.periodDays);
    }
  }
  const events = [...engineEvents, ...estimates].sort((left, right) =>
    compareCalendarDates(left.calendarDate, right.calendarDate) ||
    eventRank(left) - eventRank(right) || left.id.localeCompare(right.id),
  );
  const boundaries = input.baseline.timeline
    .filter((point) => point.kind === "margin_boundary" && point.calendarDate <= horizonEndDate)
    .map((point, index) => ({
      amount: point.amount,
      calendarDate: point.calendarDate,
      id: `boundary-${index + 1}`,
      truthStatus: "confirmed" as const,
      type: "margin_boundary" as const,
    }));
  const items = [...events, ...boundaries].sort((left, right) =>
    compareCalendarDates(left.calendarDate, right.calendarDate) ||
    eventRank(left) - eventRank(right) || left.id.localeCompare(right.id),
  );
  let confirmedBalance = input.baseline.availableCash;
  let projectedBalance = input.baseline.availableCash;
  let confirmedMinimumBalance = confirmedBalance;
  let projectedMinimumBalance = projectedBalance;
  let projectedMinimumDate = input.baseline.evaluationDate;
  let firstBelowSafetyMarginDate: CalendarDate | null =
    projectedBalance.amountMinor < input.baseline.safetyMarginAtEvaluation.amountMinor
      ? input.baseline.evaluationDate : null;
  let firstBelowZeroDate: CalendarDate | null =
    projectedBalance.amountMinor < 0n ? input.baseline.evaluationDate : null;
  const timeline: ForecastTimelinePoint[] = [];
  for (const item of items) {
    const safetyMargin = marginForDate(input.baseline, item.calendarDate);
    if (item.type !== "margin_boundary") {
      const delta = item.type === "income" ? item.amount : money(-item.amount.amountMinor, currency);
      projectedBalance = addMoney(projectedBalance, delta);
      if (item.truthStatus === "confirmed") confirmedBalance = addMoney(confirmedBalance, delta);
    }
    if (confirmedBalance.amountMinor < confirmedMinimumBalance.amountMinor) {
      confirmedMinimumBalance = confirmedBalance;
    }
    if (projectedBalance.amountMinor < projectedMinimumBalance.amountMinor) {
      projectedMinimumBalance = projectedBalance;
      projectedMinimumDate = item.calendarDate;
    }
    if (firstBelowSafetyMarginDate === null && projectedBalance.amountMinor < safetyMargin.amountMinor) {
      firstBelowSafetyMarginDate = item.calendarDate;
    }
    if (firstBelowZeroDate === null && projectedBalance.amountMinor < 0n) {
      firstBelowZeroDate = item.calendarDate;
    }
    timeline.push({
      amount: item.amount,
      calendarDate: item.calendarDate,
      confirmedBalance,
      eventId: item.id,
      projectedBalance,
      safetyMargin,
      truthStatus: item.truthStatus,
      type: item.type,
    });
  }
  const estimated = events.filter((event) => event.truthStatus === "estimated");
  const stale = input.dataFreshness === "STALE";
  let confidence: ForecastConfidence;
  let confidenceReasons: ForecastConfidenceReason[];
  if (stale) {
    confidence = "LOW";
    confidenceReasons = ["SOURCE_STALE"];
  } else if (estimated.length === 0 || estimates.length === 0) {
    confidence = "LOW";
    confidenceReasons = ["INSUFFICIENT_PREDICTIVE_EVIDENCE"];
  } else if (estimated.some((event) => event.confidence === "LOW")) {
    confidence = "LOW";
    confidenceReasons = ["ESTIMATE_LOW"];
  } else if (estimated.every((event) => event.confidence === "HIGH")) {
    confidence = "HIGH";
    confidenceReasons = ["ALL_ESTIMATES_HIGH"];
  } else {
    confidence = "MEDIUM";
    confidenceReasons = ["ESTIMATES_MIXED"];
  }
  const crossingDate = firstBelowZeroDate ?? firstBelowSafetyMarginDate;
  const materialObligations = crossingDate === null ? [] : events
    .filter((event) =>
      event.truthStatus === "confirmed" && event.type === "outflow" &&
      event.calendarDate <= crossingDate &&
      epochDay(event.calendarDate) >= epochDay(crossingDate) - 7,
    )
    .sort((left, right) =>
      left.amount.amountMinor > right.amount.amountMinor ? -1 :
        left.amount.amountMinor < right.amount.amountMinor ? 1 :
          left.calendarDate.localeCompare(right.calendarDate),
    )
    .slice(0, 5)
    .map((event) => ({
      amount: event.amount,
      calendarDate: event.calendarDate,
      sourceReference: event.sourceReference,
    }));
  return forecastResultSchema.parse({
    baseline: input.baseline.availableCash,
    confidence,
    confidenceReasons,
    confidenceVersion: FORECAST_CONFIDENCE_VERSION,
    confirmedEndBalance: confirmedBalance,
    confirmedMinimumBalance,
    currency,
    currentSafeToSpend: input.baseline.safeToSpend,
    dataFreshness: input.dataFreshness,
    duplicateEstimatesSuppressed: suppressed,
    engineVersion: FORECAST_ENGINE_VERSION,
    estimatedEventCount: estimated.length,
    evaluationDate: input.baseline.evaluationDate,
    events,
    firstBelowSafetyMarginDate,
    firstBelowZeroDate,
    freshnessReasons: input.freshnessReasons,
    horizonDays: input.horizonDays,
    horizonEndDate,
    materialObligations,
    policyVersion: FORECAST_POLICY_VERSION,
    projectedEndBalance: projectedBalance,
    projectedMinimumBalance,
    projectedMinimumDate,
    sourceEngineVersion: input.baseline.engineVersion,
    sourcePolicyVersion: input.baseline.policyVersion,
    timeline,
  });
}

function adjustmentIsPositive(kind: ForecastScenarioAdjustmentKind): boolean {
  return kind === "additional_income" || kind === "expense_reduction";
}

export function calculateForecastScenario(
  forecast: ForecastResult,
  adjustments: readonly ForecastScenarioAdjustment[],
): ForecastScenarioResult {
  for (const adjustment of adjustments) {
    validateCurrency(adjustment.amount, forecast.currency, "scenario adjustment");
    if (adjustment.amount.amountMinor <= 0n) throw new RangeError("Scenario amounts must be positive.");
    if (adjustment.calendarDate < forecast.evaluationDate || adjustment.calendarDate > forecast.horizonEndDate) {
      throw new RangeError("Scenario adjustment date is outside the forecast horizon.");
    }
  }
  const forecastItems = forecast.timeline.map((point) => ({
    amount: point.amount,
    calendarDate: point.calendarDate,
    kind: point.type === "margin_boundary" ? "margin_boundary" as const : "forecast_event" as const,
    order: point.type === "margin_boundary" ? 0 : point.type === "outflow" ? 1 : 2,
    signedAmount: point.type === "margin_boundary" ? money(0n, forecast.currency) :
      point.type === "income" ? point.amount : money(-point.amount.amountMinor, forecast.currency),
    safetyMargin: point.safetyMargin,
  }));
  const scenarioItems = adjustments.map((adjustment) => ({
    amount: adjustment.amount,
    calendarDate: adjustment.calendarDate,
    kind: adjustment.kind,
    order: adjustmentIsPositive(adjustment.kind) ? 2 : 1,
    signedAmount: adjustmentIsPositive(adjustment.kind)
      ? adjustment.amount : money(-adjustment.amount.amountMinor, forecast.currency),
    safetyMargin: money(0n, forecast.currency),
  }));
  const items = [...forecastItems, ...scenarioItems].sort((left, right) =>
    compareCalendarDates(left.calendarDate, right.calendarDate) ||
    left.order - right.order || left.kind.localeCompare(right.kind),
  );
  let projectedBalance = forecast.baseline;
  let projectedMinimumBalance = projectedBalance;
  let projectedMinimumDate = forecast.evaluationDate;
  let applicableMargin = forecast.timeline.at(0)?.safetyMargin ?? money(0n, forecast.currency);
  let firstBelowSafetyMarginDate: CalendarDate | null =
    projectedBalance.amountMinor < applicableMargin.amountMinor ? forecast.evaluationDate : null;
  let firstBelowZeroDate: CalendarDate | null = projectedBalance.amountMinor < 0n ? forecast.evaluationDate : null;
  const timeline: ForecastScenarioResult["timeline"][number][] = [];
  for (const item of items) {
    if (item.kind === "margin_boundary" || item.kind === "forecast_event") {
      applicableMargin = item.safetyMargin;
    }
    projectedBalance = addMoney(projectedBalance, item.signedAmount);
    if (projectedBalance.amountMinor < projectedMinimumBalance.amountMinor) {
      projectedMinimumBalance = projectedBalance;
      projectedMinimumDate = item.calendarDate;
    }
    if (firstBelowSafetyMarginDate === null && projectedBalance.amountMinor < applicableMargin.amountMinor) {
      firstBelowSafetyMarginDate = item.calendarDate;
    }
    if (firstBelowZeroDate === null && projectedBalance.amountMinor < 0n) firstBelowZeroDate = item.calendarDate;
    timeline.push({
      amount: item.amount,
      calendarDate: item.calendarDate,
      kind: item.kind,
      projectedBalance,
      safetyMargin: applicableMargin,
    });
  }
  return forecastScenarioResultSchema.parse({
    adjustments,
    baselineProjectedEndBalance: forecast.projectedEndBalance,
    currency: forecast.currency,
    engineVersion: FORECAST_SCENARIO_ENGINE_VERSION,
    firstBelowSafetyMarginDate,
    firstBelowZeroDate,
    forecastEngineVersion: forecast.engineVersion,
    forecastPolicyVersion: forecast.policyVersion,
    horizonDays: forecast.horizonDays,
    horizonEndDate: forecast.horizonEndDate,
    policyVersion: FORECAST_POLICY_VERSION,
    projectedEndBalance: projectedBalance,
    projectedEndDelta: subtractMoney(projectedBalance, forecast.projectedEndBalance),
    projectedMinimumBalance,
    projectedMinimumDate,
    timeline,
  });
}
