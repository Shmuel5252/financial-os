import { z } from "zod";

import {
  addCalendarDays,
  calendarDateAtInstant,
  calendarMonth,
  compareCalendarDates,
  isCalendarDateWithin,
  nextCalendarMonthStart,
} from "@/lib/domain/financial-engine/financial-calendar";
import {
  addMoney,
  money,
  multiplyMoneyByRatio,
  roundRatioHalfEven,
  subtractMoney,
  type Money,
} from "@/lib/domain/money/money";
import {
  calendarDateSchema,
  ianaTimeZoneSchema,
  utcInstantSchema,
  type CalendarDate,
} from "@/lib/domain/time/financial-time";

export const FINANCIAL_ENGINE_VERSION = "1.0.0";
export const FINANCIAL_POLICY_VERSION = "2026-08-31";
export const DEFAULT_HORIZON_DAYS = 30;

export type FinancialEventKind =
  | "confirmed_income"
  | "obligation"
  | "uncertain_income";

export type FinancialEventSource =
  | "credit_card"
  | "income_source"
  | "loan"
  | "recurring_expense"
  | "recurring_transaction";

export type FinancialEngineEvent = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  id: string;
  kind: FinancialEventKind;
  occurredAt: string | null;
  source: FinancialEventSource;
}>;

export type SafetyMarginPolicy =
  | Readonly<{ amount: Money; kind: "fixed" }>
  | Readonly<{ basisPoints: number; kind: "income_percentage" }>;

export type MonthlyConfirmedIncome = Readonly<{
  amount: Money;
  calendarMonth: string;
}>;

export type FinancialEngineInput = Readonly<{
  accountBalance: Money;
  actualMonthlyExpenses: Money;
  actualMonthlyIncome: Money;
  asOf: string;
  availableCash: Money;
  creditLimit: Money;
  creditUsed: Money;
  currency: string;
  debtBalance: Money;
  events: readonly FinancialEngineEvent[];
  horizonDays: number;
  monthlyConfirmedIncomeBasis: readonly MonthlyConfirmedIncome[];
  safetyMargin: SafetyMarginPolicy;
  savingsBalance: Money;
  timeZone: string;
}>;

export type FinancialTimelinePoint = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  confirmedBalance: Money;
  eventId: string;
  expectedBalance: Money;
  kind: FinancialEventKind | "margin_boundary";
  occurredAt: string | null;
  safeCapacity: Money;
  safetyMargin: Money;
  source: FinancialEventSource | "policy";
}>;

export type FinancialEngineResult = Readonly<{
  accountBalance: Money;
  asOf: string;
  availableCash: Money;
  credit: Readonly<{
    limit: Money;
    used: Money;
    utilizationBasisPoints: string | null;
  }>;
  currency: string;
  debtBalance: Money;
  engineVersion: typeof FINANCIAL_ENGINE_VERSION;
  evaluationDate: CalendarDate;
  futureConfirmedBalance: Money;
  futureExpectedBalance: Money;
  horizonDays: number;
  horizonEndDate: CalendarDate;
  minimumConfirmedBalance: Money;
  monthly: Readonly<{
    actualExpenses: Money;
    actualIncome: Money;
    actualNetCashFlow: Money;
    calendarMonth: string;
    confirmedIncomeBasis: Money;
    confirmedForecastIncome: Money;
    forecastNetCashFlow: Money;
    scheduledObligations: Money;
    uncertainForecastIncome: Money;
  }>;
  policyVersion: typeof FINANCIAL_POLICY_VERSION;
  safeToSpend: Money;
  safetyMarginAtEvaluation: Money;
  savingsBalance: Money;
  shortfall: Money;
  timeline: readonly FinancialTimelinePoint[];
  totals: Readonly<{
    confirmedIncome: Money;
    obligations: Money;
    uncertainIncome: Money;
  }>;
}>;

const domainMoneySchema = z
  .object({
    amountMinor: z.bigint(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .transform((value) => money(value.amountMinor, value.currency));

const timelinePointSchema = z.object({
  amount: domainMoneySchema,
  calendarDate: calendarDateSchema,
  confirmedBalance: domainMoneySchema,
  eventId: z.string().min(1),
  expectedBalance: domainMoneySchema,
  kind: z.enum([
    "confirmed_income",
    "obligation",
    "uncertain_income",
    "margin_boundary",
  ]),
  occurredAt: utcInstantSchema.nullable(),
  safeCapacity: domainMoneySchema,
  safetyMargin: domainMoneySchema,
  source: z.enum([
    "credit_card",
    "income_source",
    "loan",
    "recurring_expense",
    "recurring_transaction",
    "policy",
  ]),
});

export const financialEngineResultSchema = z.object({
  accountBalance: domainMoneySchema,
  asOf: utcInstantSchema,
  availableCash: domainMoneySchema,
  credit: z.object({
    limit: domainMoneySchema,
    used: domainMoneySchema,
    utilizationBasisPoints: z.string().regex(/^\d+$/).nullable(),
  }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  debtBalance: domainMoneySchema,
  engineVersion: z.literal(FINANCIAL_ENGINE_VERSION),
  evaluationDate: calendarDateSchema,
  futureConfirmedBalance: domainMoneySchema,
  futureExpectedBalance: domainMoneySchema,
  horizonDays: z.number().int().min(1).max(366),
  horizonEndDate: calendarDateSchema,
  minimumConfirmedBalance: domainMoneySchema,
  monthly: z.object({
    actualExpenses: domainMoneySchema,
    actualIncome: domainMoneySchema,
    actualNetCashFlow: domainMoneySchema,
    calendarMonth: z.string().regex(/^\d{4}-\d{2}$/),
    confirmedIncomeBasis: domainMoneySchema,
    confirmedForecastIncome: domainMoneySchema,
    forecastNetCashFlow: domainMoneySchema,
    scheduledObligations: domainMoneySchema,
    uncertainForecastIncome: domainMoneySchema,
  }),
  policyVersion: z.literal(FINANCIAL_POLICY_VERSION),
  safeToSpend: domainMoneySchema,
  safetyMarginAtEvaluation: domainMoneySchema,
  savingsBalance: domainMoneySchema,
  shortfall: domainMoneySchema,
  timeline: z.array(timelinePointSchema),
  totals: z.object({
    confirmedIncome: domainMoneySchema,
    obligations: domainMoneySchema,
    uncertainIncome: domainMoneySchema,
  }),
});

type CalculationItem =
  | FinancialEngineEvent
  | Readonly<{
      amount: Money;
      calendarDate: CalendarDate;
      id: string;
      kind: "margin_boundary";
      occurredAt: null;
      source: "policy";
    }>;

function zero(currency: string): Money {
  return money(0n, currency);
}

function ensureCurrency(value: Money, currency: string, field: string): void {
  if (value.currency !== currency) {
    throw new RangeError(`${field} must use the engine currency.`);
  }
}

function validateInput(input: FinancialEngineInput): void {
  utcInstantSchema.parse(input.asOf);
  ianaTimeZoneSchema.parse(input.timeZone);

  if (
    !Number.isInteger(input.horizonDays) ||
    input.horizonDays < 1 ||
    input.horizonDays > 366
  ) {
    throw new RangeError("Horizon days must be between 1 and 366.");
  }

  const monetaryInputs: readonly Readonly<{
    field: string;
    value: Money;
  }>[] = [
    { field: "accountBalance", value: input.accountBalance },
    { field: "actualMonthlyExpenses", value: input.actualMonthlyExpenses },
    { field: "actualMonthlyIncome", value: input.actualMonthlyIncome },
    { field: "availableCash", value: input.availableCash },
    { field: "creditLimit", value: input.creditLimit },
    { field: "creditUsed", value: input.creditUsed },
    { field: "debtBalance", value: input.debtBalance },
    { field: "savingsBalance", value: input.savingsBalance },
  ];

  for (const { field, value } of monetaryInputs) {
    ensureCurrency(value, input.currency, field);
  }

  for (const { field, value } of monetaryInputs.filter(({ field }) =>
    [
      "actualMonthlyExpenses",
      "actualMonthlyIncome",
      "creditLimit",
      "creditUsed",
      "debtBalance",
      "savingsBalance",
    ].includes(field),
  )) {
    if (value.amountMinor < 0n) {
      throw new RangeError(`${field} cannot be negative.`);
    }
  }

  if (
    input.safetyMargin.kind === "income_percentage" &&
    (!Number.isInteger(input.safetyMargin.basisPoints) ||
      input.safetyMargin.basisPoints < 0 ||
      input.safetyMargin.basisPoints > 10_000)
  ) {
    throw new RangeError("Safety-margin basis points are invalid.");
  }

  if (input.safetyMargin.kind === "fixed") {
    ensureCurrency(input.safetyMargin.amount, input.currency, "safetyMargin");
    if (input.safetyMargin.amount.amountMinor < 0n) {
      throw new RangeError("A fixed safety margin cannot be negative.");
    }
  }

  const ids = new Set<string>();
  for (const event of input.events) {
    if (ids.has(event.id)) {
      throw new RangeError("Financial event IDs must be unique.");
    }
    ids.add(event.id);
    ensureCurrency(event.amount, input.currency, "event.amount");
    if (event.amount.amountMinor <= 0n) {
      throw new RangeError("Financial event amounts must be positive.");
    }
    calendarDateSchema.parse(event.calendarDate);
    if (event.occurredAt !== null) {
      utcInstantSchema.parse(event.occurredAt);
      if (
        calendarDateAtInstant(event.occurredAt, input.timeZone) !==
        event.calendarDate
      ) {
        throw new RangeError("Event timestamp and calendar date disagree.");
      }
    }
  }

  const incomeMonths = new Set<string>();
  for (const monthlyIncome of input.monthlyConfirmedIncomeBasis) {
    if (!/^\d{4}-\d{2}$/.test(monthlyIncome.calendarMonth)) {
      throw new RangeError("Confirmed-income month is invalid.");
    }
    ensureCurrency(monthlyIncome.amount, input.currency, "monthlyIncome");
    if (monthlyIncome.amount.amountMinor < 0n) {
      throw new RangeError("Confirmed monthly income cannot be negative.");
    }
    if (incomeMonths.has(monthlyIncome.calendarMonth)) {
      throw new RangeError("Confirmed-income months must be unique.");
    }
    incomeMonths.add(monthlyIncome.calendarMonth);
  }
}

function eventRank(item: CalculationItem): number {
  switch (item.kind) {
    case "margin_boundary":
      return 0;
    case "obligation":
      return 1;
    case "confirmed_income":
      return 2;
    case "uncertain_income":
      return 3;
  }
}

function compareItems(left: CalculationItem, right: CalculationItem): number {
  const dateComparison = compareCalendarDates(
    left.calendarDate,
    right.calendarDate,
  );
  if (dateComparison !== 0) {
    return dateComparison;
  }

  if (left.occurredAt !== null && right.occurredAt !== null) {
    const timestampComparison =
      new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    if (timestampComparison !== 0) {
      return timestampComparison;
    }
  }

  const rankComparison = eventRank(left) - eventRank(right);
  return rankComparison === 0 ? left.id.localeCompare(right.id) : rankComparison;
}

function monthlyIncomeFor(
  input: FinancialEngineInput,
  date: CalendarDate,
): Money {
  const targetMonth = calendarMonth(date);
  return (
    input.monthlyConfirmedIncomeBasis.find(
      (entry) => entry.calendarMonth === targetMonth,
    )?.amount ?? zero(input.currency)
  );
}

function safetyMarginFor(
  input: FinancialEngineInput,
  date: CalendarDate,
): Money {
  if (input.safetyMargin.kind === "fixed") {
    return input.safetyMargin.amount;
  }

  return multiplyMoneyByRatio(
    monthlyIncomeFor(input, date),
    BigInt(input.safetyMargin.basisPoints),
    10_000n,
  );
}

function addBoundaries(
  start: CalendarDate,
  end: CalendarDate,
  currency: string,
): readonly CalculationItem[] {
  const result: CalculationItem[] = [];
  let next = nextCalendarMonthStart(start);

  while (next <= end) {
    result.push({
      amount: zero(currency),
      calendarDate: next,
      id: `margin:${next}`,
      kind: "margin_boundary",
      occurredAt: null,
      source: "policy",
    });
    next = nextCalendarMonthStart(next);
  }

  if (end !== start && !result.some((item) => item.calendarDate === end)) {
    result.push({
      amount: zero(currency),
      calendarDate: end,
      id: `horizon:${end}`,
      kind: "margin_boundary",
      occurredAt: null,
      source: "policy",
    });
  }

  return result;
}

function sumEvents(
  events: readonly FinancialEngineEvent[],
  kind: FinancialEventKind,
  currency: string,
): Money {
  return events
    .filter((event) => event.kind === kind)
    .reduce((total, event) => addMoney(total, event.amount), zero(currency));
}

export function calculateFinancialEngine(
  input: FinancialEngineInput,
): FinancialEngineResult {
  validateInput(input);
  const evaluationDate = calendarDateAtInstant(input.asOf, input.timeZone);
  const horizonEndDate = addCalendarDays(
    evaluationDate,
    input.horizonDays - 1,
  );
  const events = input.events.filter((event) =>
    isCalendarDateWithin(
      event.calendarDate,
      evaluationDate,
      horizonEndDate,
    ),
  );
  const items = [
    ...events,
    ...addBoundaries(evaluationDate, horizonEndDate, input.currency),
  ].sort(compareItems);
  let confirmedBalance = input.availableCash;
  let expectedBalance = input.availableCash;
  let minimumConfirmedBalance = input.availableCash;
  const startingMargin = safetyMarginFor(input, evaluationDate);
  let minimumCapacity = subtractMoney(input.availableCash, startingMargin);
  const timeline: FinancialTimelinePoint[] = [];

  for (const item of items) {
    if (item.kind === "confirmed_income") {
      confirmedBalance = addMoney(confirmedBalance, item.amount);
      expectedBalance = addMoney(expectedBalance, item.amount);
    } else if (item.kind === "uncertain_income") {
      expectedBalance = addMoney(expectedBalance, item.amount);
    } else if (item.kind === "obligation") {
      confirmedBalance = subtractMoney(confirmedBalance, item.amount);
      expectedBalance = subtractMoney(expectedBalance, item.amount);
    }

    if (confirmedBalance.amountMinor < minimumConfirmedBalance.amountMinor) {
      minimumConfirmedBalance = confirmedBalance;
    }

    const safetyMargin = safetyMarginFor(input, item.calendarDate);
    const safeCapacity = subtractMoney(confirmedBalance, safetyMargin);
    if (safeCapacity.amountMinor < minimumCapacity.amountMinor) {
      minimumCapacity = safeCapacity;
    }

    timeline.push({
      amount: item.amount,
      calendarDate: item.calendarDate,
      confirmedBalance,
      eventId: item.id,
      expectedBalance,
      kind: item.kind,
      occurredAt: item.occurredAt,
      safeCapacity,
      safetyMargin,
      source: item.source,
    });
  }

  const confirmedIncome = sumEvents(
    events,
    "confirmed_income",
    input.currency,
  );
  const uncertainIncome = sumEvents(
    events,
    "uncertain_income",
    input.currency,
  );
  const obligations = sumEvents(events, "obligation", input.currency);
  const evaluationMonth = calendarMonth(evaluationDate);
  const monthEvents = events.filter(
    (event) => calendarMonth(event.calendarDate) === evaluationMonth,
  );
  const monthConfirmedIncomeBasis = monthlyIncomeFor(input, evaluationDate);
  const monthConfirmedIncome = sumEvents(
    monthEvents,
    "confirmed_income",
    input.currency,
  );
  const monthUncertainIncome = sumEvents(
    monthEvents,
    "uncertain_income",
    input.currency,
  );
  const monthObligations = sumEvents(
    monthEvents,
    "obligation",
    input.currency,
  );
  const safeToSpend = money(
    minimumCapacity.amountMinor > 0n ? minimumCapacity.amountMinor : 0n,
    input.currency,
  );
  const shortfall = money(
    minimumCapacity.amountMinor < 0n ? -minimumCapacity.amountMinor : 0n,
    input.currency,
  );
  const utilizationBasisPoints =
    input.creditLimit.amountMinor === 0n
      ? null
      : roundRatioHalfEven(
          input.creditUsed.amountMinor * 10_000n,
          input.creditLimit.amountMinor,
        ).toString();

  return financialEngineResultSchema.parse({
    accountBalance: input.accountBalance,
    asOf: input.asOf,
    availableCash: input.availableCash,
    credit: {
      limit: input.creditLimit,
      used: input.creditUsed,
      utilizationBasisPoints,
    },
    currency: input.currency,
    debtBalance: input.debtBalance,
    engineVersion: FINANCIAL_ENGINE_VERSION,
    evaluationDate,
    futureConfirmedBalance: confirmedBalance,
    futureExpectedBalance: expectedBalance,
    horizonDays: input.horizonDays,
    horizonEndDate,
    minimumConfirmedBalance,
    monthly: {
      actualExpenses: input.actualMonthlyExpenses,
      actualIncome: input.actualMonthlyIncome,
      actualNetCashFlow: subtractMoney(
        input.actualMonthlyIncome,
        input.actualMonthlyExpenses,
      ),
      calendarMonth: evaluationMonth,
      confirmedIncomeBasis: monthConfirmedIncomeBasis,
      confirmedForecastIncome: monthConfirmedIncome,
      forecastNetCashFlow: subtractMoney(
        monthConfirmedIncome,
        monthObligations,
      ),
      scheduledObligations: monthObligations,
      uncertainForecastIncome: monthUncertainIncome,
    },
    policyVersion: FINANCIAL_POLICY_VERSION,
    safeToSpend,
    safetyMarginAtEvaluation: startingMargin,
    savingsBalance: input.savingsBalance,
    shortfall,
    timeline,
    totals: {
      confirmedIncome,
      obligations,
      uncertainIncome,
    },
  });
}
