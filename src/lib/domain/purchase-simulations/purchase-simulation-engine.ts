import {
  addCalendarDays,
  addCalendarMonthsClamped,
  compareCalendarDates,
} from "@/lib/domain/financial-engine/financial-calendar";
import type {
  FinancialEngineResult,
  FinancialEventKind,
  FinancialEventSource,
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

export const PURCHASE_SIMULATION_ENGINE_VERSION =
  "purchase-simulation/1.0.0" as const;
export const PURCHASE_SIMULATION_POLICY_VERSION =
  "purchase-policy/2026-09-01" as const;
export const PURCHASE_EVALUATION_HORIZON_DAYS = 30;
export const SAFER_DATE_SEARCH_DAYS = 90;
export const MAX_PROPOSED_DATE_OFFSET_DAYS = 90;
export const PURCHASE_BASELINE_HORIZON_DAYS =
  PURCHASE_EVALUATION_HORIZON_DAYS +
  SAFER_DATE_SEARCH_DAYS +
  MAX_PROPOSED_DATE_OFFSET_DAYS;

export type PurchaseRiskClassification = "CAUTION" | "SAFE" | "UNSAFE";
export type PurchaseInputMode = "installments" | "one_time";
export type InstallmentFrequency = "monthly";
export type PurchaseChargeKind = "fee" | "interest";

export type PurchaseCharge = Readonly<{
  amount: Money;
  kind: PurchaseChargeKind;
  label: string;
  provenance: Readonly<{
    kind: "user_reported";
    note: string | null;
  }>;
}>;

export type PurchaseInstallment = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  number: number;
}>;

export type PurchaseSimulationTimelinePoint = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  confirmedBalance: Money;
  eventId: string;
  expectedBalance: Money;
  kind: FinancialEventKind | "margin_boundary";
  proposedPurchase: boolean;
  safeCapacity: Money;
  safetyMargin: Money;
  source: FinancialEventSource | "policy" | "proposed_purchase";
}>;

export type PurchaseClassificationExplanationCode =
  | "confirmed_obligation_uncovered"
  | "minimum_at_or_above_margin"
  | "minimum_below_margin_non_negative"
  | "negative_projected_balance";

export type PurchaseSimulationInput = Readonly<{
  baseline: FinancialEngineResult;
  charges: readonly PurchaseCharge[];
  evaluationHorizonDays: number;
  installmentCount: number;
  installmentFrequency: InstallmentFrequency;
  inputMode: PurchaseInputMode;
  proposedDate: CalendarDate;
  saferDateSearchDays: number;
  totalPurchasePrice: Money;
}>;

export type PurchaseSimulationResult = Readonly<{
  charges: readonly PurchaseCharge[];
  engineVersion: typeof PURCHASE_SIMULATION_ENGINE_VERSION;
  evaluationEndDate: CalendarDate;
  evaluationHorizonDays: number;
  evaluationStartDate: CalendarDate;
  explanationCodes: readonly PurchaseClassificationExplanationCode[];
  finalConfirmedBalance: Money;
  installmentSchedule: readonly PurchaseInstallment[];
  minimumConfirmedBalance: Money;
  minimumConfirmedBalanceAt: CalendarDate;
  minimumSafeCapacity: Money;
  minimumSafeCapacityAt: CalendarDate;
  obligationsCoverable: boolean;
  openingConfirmedBalance: Money;
  policyVersion: typeof PURCHASE_SIMULATION_POLICY_VERSION;
  riskClassification: PurchaseRiskClassification;
  saferDate: CalendarDate | null;
  saferDateSearchDays: number;
  safetyMarginAtMinimumCapacity: Money;
  timeline: readonly PurchaseSimulationTimelinePoint[];
  totalPurchasePrice: Money;
  trueFinancedCost: Money;
}>;

type SimulationItem = Readonly<{
  amount: Money;
  calendarDate: CalendarDate;
  id: string;
  kind: FinancialEventKind | "margin_boundary";
  occurredAt: string | null;
  proposedPurchase: boolean;
  source: FinancialEventSource | "policy" | "proposed_purchase";
}>;

type DateEvaluation = Omit<
  PurchaseSimulationResult,
  | "charges"
  | "engineVersion"
  | "policyVersion"
  | "saferDate"
  | "saferDateSearchDays"
  | "totalPurchasePrice"
  | "trueFinancedCost"
>;

function ensureMoney(
  value: Money,
  currency: string,
  field: string,
  allowZero: boolean,
): void {
  if (value.currency !== currency) {
    throw new RangeError(`${field} must use the baseline currency.`);
  }
  if (allowZero ? value.amountMinor < 0n : value.amountMinor <= 0n) {
    throw new RangeError(`${field} must be positive.`);
  }
}

function validateInput(input: PurchaseSimulationInput): void {
  calendarDateSchema.parse(input.proposedDate);
  if (
    !Number.isInteger(input.evaluationHorizonDays) ||
    input.evaluationHorizonDays < 1 ||
    input.evaluationHorizonDays > 366
  ) {
    throw new RangeError("The purchase evaluation horizon is invalid.");
  }
  if (
    !Number.isInteger(input.saferDateSearchDays) ||
    input.saferDateSearchDays < 1 ||
    input.saferDateSearchDays > 365
  ) {
    throw new RangeError("The safer-date search horizon is invalid.");
  }
  if (
    !Number.isInteger(input.installmentCount) ||
    input.installmentCount < 1 ||
    input.installmentCount > 60
  ) {
    throw new RangeError("Installment count must be between 1 and 60.");
  }
  if (
    (input.inputMode === "one_time" && input.installmentCount !== 1) ||
    (input.inputMode === "installments" && input.installmentCount < 2)
  ) {
    throw new RangeError("The installment count does not match the input mode.");
  }
  if (input.installmentFrequency !== "monthly") {
    throw new RangeError("Only monthly installments are supported in Phase 7.");
  }
  ensureMoney(
    input.totalPurchasePrice,
    input.baseline.currency,
    "totalPurchasePrice",
    false,
  );
  if (input.charges.length > 8) {
    throw new RangeError("At most eight explicit charges may be supplied.");
  }
  for (const charge of input.charges) {
    ensureMoney(charge.amount, input.baseline.currency, "charge.amount", false);
    if (charge.label.trim().length === 0) {
      throw new RangeError("Every explicit charge requires a label.");
    }
  }
  if (input.proposedDate < input.baseline.evaluationDate) {
    throw new RangeError("The proposed date predates the source snapshot.");
  }
  if (
    input.proposedDate >
    addCalendarDays(
      input.baseline.evaluationDate,
      MAX_PROPOSED_DATE_OFFSET_DAYS,
    )
  ) {
    throw new RangeError("The proposed date is outside the Phase 7 input window.");
  }
  const requiredEndDate = addCalendarDays(
    input.proposedDate,
    input.saferDateSearchDays + input.evaluationHorizonDays - 1,
  );
  if (requiredEndDate > input.baseline.horizonEndDate) {
    throw new RangeError(
      "The source snapshot does not cover the full safer-date search.",
    );
  }
}

function totalFinancedCost(input: PurchaseSimulationInput): Money {
  return input.charges.reduce(
    (total, charge) => addMoney(total, charge.amount),
    input.totalPurchasePrice,
  );
}

export function generateInstallmentSchedule(
  total: Money,
  proposedDate: CalendarDate,
  count: number,
): readonly PurchaseInstallment[] {
  calendarDateSchema.parse(proposedDate);
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw new RangeError("Installment count must be between 1 and 60.");
  }
  if (total.amountMinor <= 0n) {
    throw new RangeError("The financed cost must be positive.");
  }

  const divisor = BigInt(count);
  const base = total.amountMinor / divisor;
  const remainder = total.amountMinor % divisor;

  return Array.from({ length: count }, (_, index) => ({
    amount: money(
      base + (BigInt(index) < remainder ? 1n : 0n),
      total.currency,
    ),
    calendarDate: addCalendarMonthsClamped(proposedDate, index),
    number: index + 1,
  }));
}

function itemRank(item: SimulationItem): number {
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

function compareItems(left: SimulationItem, right: SimulationItem): number {
  const date = compareCalendarDates(left.calendarDate, right.calendarDate);
  if (date !== 0) return date;
  if (left.occurredAt !== null && right.occurredAt !== null) {
    const instant =
      new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    if (instant !== 0) return instant;
  }
  const rank = itemRank(left) - itemRank(right);
  return rank === 0 ? left.id.localeCompare(right.id) : rank;
}

function baseItems(baseline: FinancialEngineResult): readonly SimulationItem[] {
  return baseline.timeline.map((point) => ({
    amount: point.amount,
    calendarDate: point.calendarDate,
    id: point.eventId,
    kind: point.kind,
    occurredAt: point.occurredAt,
    proposedPurchase: false,
    source: point.source,
  }));
}

function marginForDate(
  baseline: FinancialEngineResult,
  date: CalendarDate,
): Money {
  let margin = baseline.safetyMarginAtEvaluation;
  for (const point of baseline.timeline) {
    if (point.calendarDate > date) break;
    margin = point.safetyMargin;
  }
  return margin;
}

function applyItem(
  confirmedBalance: Money,
  expectedBalance: Money,
  item: SimulationItem,
): Readonly<{ confirmedBalance: Money; expectedBalance: Money }> {
  if (item.kind === "confirmed_income") {
    return {
      confirmedBalance: addMoney(confirmedBalance, item.amount),
      expectedBalance: addMoney(expectedBalance, item.amount),
    };
  }
  if (item.kind === "uncertain_income") {
    return {
      confirmedBalance,
      expectedBalance: addMoney(expectedBalance, item.amount),
    };
  }
  if (item.kind === "obligation") {
    return {
      confirmedBalance: subtractMoney(confirmedBalance, item.amount),
      expectedBalance: subtractMoney(expectedBalance, item.amount),
    };
  }
  return { confirmedBalance, expectedBalance };
}

function evaluateDate(
  input: PurchaseSimulationInput,
  proposedDate: CalendarDate,
  trueFinancedCost: Money,
): DateEvaluation {
  const evaluationEndDate = addCalendarDays(
    proposedDate,
    input.evaluationHorizonDays - 1,
  );
  const installmentSchedule = generateInstallmentSchedule(
    trueFinancedCost,
    proposedDate,
    input.installmentCount,
  );
  const allBaseItems = baseItems(input.baseline);
  let confirmedBalance = input.baseline.availableCash;
  let expectedBalance = input.baseline.availableCash;

  for (const item of allBaseItems) {
    if (item.calendarDate >= proposedDate) break;
    ({ confirmedBalance, expectedBalance } = applyItem(
      confirmedBalance,
      expectedBalance,
      item,
    ));
  }

  const openingConfirmedBalance = confirmedBalance;
  let minimumConfirmedBalance = confirmedBalance;
  let minimumConfirmedBalanceAt = proposedDate;
  let safetyMargin = marginForDate(input.baseline, proposedDate);
  let minimumSafeCapacity = subtractMoney(confirmedBalance, safetyMargin);
  let minimumSafeCapacityAt = proposedDate;
  let safetyMarginAtMinimumCapacity = safetyMargin;
  let obligationsCoverable = confirmedBalance.amountMinor >= 0n;
  const timeline: PurchaseSimulationTimelinePoint[] = [];
  const purchaseItems: readonly SimulationItem[] = installmentSchedule
    .filter((installment) => installment.calendarDate <= evaluationEndDate)
    .map((installment) => ({
      amount: installment.amount,
      calendarDate: installment.calendarDate,
      id: `purchase:${installment.number}:${installment.calendarDate}`,
      kind: "obligation" as const,
      occurredAt: null,
      proposedPurchase: true,
      source: "proposed_purchase" as const,
    }));
  const items = [
    ...allBaseItems.filter(
      (item) =>
        item.calendarDate >= proposedDate &&
        item.calendarDate <= evaluationEndDate,
    ),
    ...purchaseItems,
  ].sort(compareItems);

  for (const item of items) {
    ({ confirmedBalance, expectedBalance } = applyItem(
      confirmedBalance,
      expectedBalance,
      item,
    ));
    safetyMargin = marginForDate(input.baseline, item.calendarDate);
    const safeCapacity = subtractMoney(confirmedBalance, safetyMargin);
    if (confirmedBalance.amountMinor < minimumConfirmedBalance.amountMinor) {
      minimumConfirmedBalance = confirmedBalance;
      minimumConfirmedBalanceAt = item.calendarDate;
    }
    if (safeCapacity.amountMinor < minimumSafeCapacity.amountMinor) {
      minimumSafeCapacity = safeCapacity;
      minimumSafeCapacityAt = item.calendarDate;
      safetyMarginAtMinimumCapacity = safetyMargin;
    }
    if (item.kind === "obligation" && confirmedBalance.amountMinor < 0n) {
      obligationsCoverable = false;
    }
    timeline.push({
      amount: item.amount,
      calendarDate: item.calendarDate,
      confirmedBalance,
      eventId: item.id,
      expectedBalance,
      kind: item.kind,
      proposedPurchase: item.proposedPurchase,
      safeCapacity,
      safetyMargin,
      source: item.source,
    });
  }

  let riskClassification: PurchaseRiskClassification;
  const explanationCodes: PurchaseClassificationExplanationCode[] = [];
  if (minimumConfirmedBalance.amountMinor < 0n || !obligationsCoverable) {
    riskClassification = "UNSAFE";
    if (minimumConfirmedBalance.amountMinor < 0n) {
      explanationCodes.push("negative_projected_balance");
    }
    if (!obligationsCoverable) {
      explanationCodes.push("confirmed_obligation_uncovered");
    }
  } else if (minimumSafeCapacity.amountMinor >= 0n) {
    riskClassification = "SAFE";
    explanationCodes.push("minimum_at_or_above_margin");
  } else {
    riskClassification = "CAUTION";
    explanationCodes.push("minimum_below_margin_non_negative");
  }

  return {
    evaluationEndDate,
    evaluationHorizonDays: input.evaluationHorizonDays,
    evaluationStartDate: proposedDate,
    explanationCodes,
    finalConfirmedBalance: confirmedBalance,
    installmentSchedule,
    minimumConfirmedBalance,
    minimumConfirmedBalanceAt,
    minimumSafeCapacity,
    minimumSafeCapacityAt,
    obligationsCoverable,
    openingConfirmedBalance,
    riskClassification,
    safetyMarginAtMinimumCapacity,
    timeline,
  };
}

export function calculatePurchaseSimulation(
  input: PurchaseSimulationInput,
): PurchaseSimulationResult {
  validateInput(input);
  const trueFinancedCost = totalFinancedCost(input);
  const current = evaluateDate(input, input.proposedDate, trueFinancedCost);
  let saferDate: CalendarDate | null = null;

  if (current.riskClassification !== "SAFE") {
    for (let day = 1; day <= input.saferDateSearchDays; day += 1) {
      const candidate = addCalendarDays(input.proposedDate, day);
      if (
        evaluateDate(input, candidate, trueFinancedCost).riskClassification ===
        "SAFE"
      ) {
        saferDate = candidate;
        break;
      }
    }
  }

  return {
    ...current,
    charges: input.charges,
    engineVersion: PURCHASE_SIMULATION_ENGINE_VERSION,
    policyVersion: PURCHASE_SIMULATION_POLICY_VERSION,
    saferDate,
    saferDateSearchDays: input.saferDateSearchDays,
    totalPurchasePrice: input.totalPurchasePrice,
    trueFinancedCost,
  };
}
