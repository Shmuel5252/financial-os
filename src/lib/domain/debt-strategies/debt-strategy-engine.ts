import {
  addCalendarMonthsClamped,
  compareCalendarDates,
} from "@/lib/domain/financial-engine/financial-calendar";
import {
  money,
  roundRatioHalfEven,
  type Money,
} from "@/lib/domain/money/money";
import {
  calendarDateSchema,
  type CalendarDate,
} from "@/lib/domain/time/financial-time";

export const DEBT_STRATEGY_ENGINE_VERSION = "debt-strategy/1.0.0" as const;
export const DEBT_STRATEGY_POLICY_VERSION = "debt-policy/2026-09-01" as const;
export const DEBT_STRATEGY_MAX_DEBTS = 8;
export const DEBT_STRATEGY_MAX_MONTHS = 360;

export type DebtCalculationCompleteness =
  | "assumption_based"
  | "insufficient_information"
  | "verified";
export type DebtStrategyKind = "avalanche" | "baseline" | "custom" | "snowball";
export type DebtTermProvenance = Readonly<{
  kind: "assumption" | "contract" | "user_reported";
  note: string | null;
}>;
export type DebtAccrualConvention =
  | "actual_360"
  | "actual_365"
  | "monthly_compounded";
export type DebtAllocationComponent = "fees" | "interest" | "principal";

export type DebtRateTerm = Readonly<{
  annualRateBps: number;
  effectiveDate: CalendarDate;
  provenance: DebtTermProvenance;
}>;

export type DebtInterestModel =
  | Readonly<{ kind: "none"; provenance: DebtTermProvenance }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{
      accrualConvention: DebtAccrualConvention;
      kind: "fixed_rate" | "variable_rate";
      rateApplication: "effective_date" | "payment_date" | "period_start";
      rates: readonly DebtRateTerm[];
    }>;

export type DebtMinimumPayment =
  | Readonly<{
      amount: Money;
      kind: "fixed";
      provenance: DebtTermProvenance;
    }>
  | Readonly<{
      basis: "principal" | "total_due";
      floor: Money;
      kind: "formula";
      percentageBps: number;
      provenance: DebtTermProvenance;
    }>
  | Readonly<{ kind: "unknown" }>;

export type DebtKnownFee = Readonly<{
  amount: Money;
  dueDate: CalendarDate;
  label: string;
  provenance: DebtTermProvenance;
}>;

export type DebtPrepaymentTerm =
  | Readonly<{ kind: "free"; provenance: DebtTermProvenance }>
  | Readonly<{ amount: Money; kind: "fixed_fee"; provenance: DebtTermProvenance }>
  | Readonly<{
      kind: "percentage_of_principal";
      percentageBps: number;
      provenance: DebtTermProvenance;
    }>
  | Readonly<{ kind: "unknown" }>;

export type DebtStrategyDebt = Readonly<{
  allocationOrder: Readonly<{
    order: readonly DebtAllocationComponent[];
    provenance: DebtTermProvenance;
  }> | null;
  balance: Money;
  fees: readonly DebtKnownFee[];
  feesKnown: boolean;
  feesProvenance: DebtTermProvenance | null;
  firstPaymentDate: CalendarDate;
  id: string;
  interest: DebtInterestModel;
  label: string;
  minimumPayment: DebtMinimumPayment;
  prepayment: DebtPrepaymentTerm;
  sourceVersion: number;
}>;

export type DebtStrategyInput = Readonly<{
  customPriority: readonly string[];
  debts: readonly DebtStrategyDebt[];
  evaluationDate: CalendarDate;
  extraPayment: Money;
  extraPaymentStartDate: CalendarDate;
}>;

export type DebtAssessmentReason =
  | "assumption_terms"
  | "missing_applicable_rate"
  | "unknown_allocation_order"
  | "unknown_fee_terms"
  | "unknown_interest_model"
  | "unknown_minimum_payment"
  | "unknown_prepayment_terms";

export type DebtStrategyDebtAssessment = Readonly<{
  completeness: DebtCalculationCompleteness;
  debtId: string;
  reasons: readonly DebtAssessmentReason[];
}>;

export type DebtPaymentPoint = Readonly<{
  calendarDate: CalendarDate;
  debtId: string;
  feesAfter: Money;
  feesAssessed: Money;
  interestAccrued: Money;
  interestAfter: Money;
  kind: "extra" | "scheduled";
  payment: Money;
  principalAfter: Money;
}>;

export type DebtStrategyResult = Readonly<{
  calculationCompleteness: DebtCalculationCompleteness;
  costComparable: boolean;
  costSavedVersusBaseline: Money | null;
  excludedDebtIds: readonly string[];
  payoffDate: CalendarDate | null;
  payoffOrder: readonly Readonly<{ debtId: string; payoffDate: CalendarDate }>[];
  payoffReached: boolean;
  scheduledPaymentTotal: Money;
  strategy: DebtStrategyKind;
  timeSavedDaysVersusBaseline: number | null;
  timeline: readonly DebtPaymentPoint[];
  totalInterest: Money;
  totalKnownFees: Money;
  totalRepayment: Money;
}>;

export type DebtStrategyComparison = Readonly<{
  assessments: readonly DebtStrategyDebtAssessment[];
  calculationCompleteness: DebtCalculationCompleteness;
  currency: string;
  engineVersion: typeof DEBT_STRATEGY_ENGINE_VERSION;
  evaluationDate: CalendarDate;
  extraPayment: Money;
  extraPaymentStartDate: CalendarDate;
  policyVersion: typeof DEBT_STRATEGY_POLICY_VERSION;
  requiredMonthlyPayment: Money;
  results: readonly DebtStrategyResult[];
}>;

type DebtState = {
  debt: DebtStrategyDebt;
  feesAssessedIndexes: Set<number>;
  feesDue: bigint;
  interestDue: bigint;
  lastAccrualDate: CalendarDate;
  payoffDate: CalendarDate | null;
  prepaymentFeeAssessed: boolean;
  principal: bigint;
  totalInterest: bigint;
  totalKnownFees: bigint;
  totalRepayment: bigint;
};

function daysBetween(left: CalendarDate, right: CalendarDate): number {
  return Math.floor(
    (Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function termIsAssumption(provenance: DebtTermProvenance): boolean {
  return provenance.kind === "assumption";
}

function debtHasAssumption(debt: DebtStrategyDebt): boolean {
  if (!debt.feesKnown || debt.prepayment.kind === "unknown") return true;
  if (debt.feesProvenance !== null && termIsAssumption(debt.feesProvenance)) return true;
  if (debt.interest.kind === "none" && termIsAssumption(debt.interest.provenance)) return true;
  if (
    (debt.interest.kind === "fixed_rate" || debt.interest.kind === "variable_rate") &&
    debt.interest.rates.some((rate) => termIsAssumption(rate.provenance))
  ) return true;
  if (debt.minimumPayment.kind !== "unknown" && termIsAssumption(debt.minimumPayment.provenance)) {
    return true;
  }
  if (termIsAssumption(debt.prepayment.provenance)) {
    return true;
  }
  return (debt.allocationOrder !== null && termIsAssumption(debt.allocationOrder.provenance)) ||
    debt.fees.some((fee) => termIsAssumption(fee.provenance));
}

function validateAllocationOrder(order: readonly DebtAllocationComponent[] | null): boolean {
  return order !== null && order.length === 3 && new Set(order).size === 3 &&
    order.every((component) => ["fees", "interest", "principal"].includes(component));
}

function applicableRate(
  model: Extract<DebtInterestModel, { kind: "fixed_rate" | "variable_rate" }>,
  date: CalendarDate,
): DebtRateTerm | null {
  return [...model.rates]
    .filter((rate) => rate.effectiveDate <= date)
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0] ?? null;
}

export function assessDebtTerms(
  debt: DebtStrategyDebt,
  evaluationDate: CalendarDate,
): DebtStrategyDebtAssessment {
  const reasons: DebtAssessmentReason[] = [];
  if (debt.balance.amountMinor === 0n) {
    return { completeness: "verified", debtId: debt.id, reasons };
  }
  if (debt.interest.kind === "unknown") reasons.push("unknown_interest_model");
  if (
    (debt.interest.kind === "fixed_rate" || debt.interest.kind === "variable_rate") &&
    applicableRate(debt.interest, evaluationDate) === null
  ) reasons.push("missing_applicable_rate");
  if (debt.minimumPayment.kind === "unknown") reasons.push("unknown_minimum_payment");
  if (!validateAllocationOrder(debt.allocationOrder?.order ?? null)) reasons.push("unknown_allocation_order");
  if (!debt.feesKnown || debt.feesProvenance === null) reasons.push("unknown_fee_terms");
  if (debt.prepayment.kind === "unknown") reasons.push("unknown_prepayment_terms");
  const insufficient = reasons.some((reason) =>
    [
      "missing_applicable_rate",
      "unknown_allocation_order",
      "unknown_interest_model",
      "unknown_minimum_payment",
    ].includes(reason),
  );
  if (insufficient) {
    return { completeness: "insufficient_information", debtId: debt.id, reasons };
  }
  if (debtHasAssumption(debt)) reasons.push("assumption_terms");
  return {
    completeness: reasons.length === 0 ? "verified" : "assumption_based",
    debtId: debt.id,
    reasons: [...new Set(reasons)],
  };
}

function validateInput(input: DebtStrategyInput): void {
  calendarDateSchema.parse(input.evaluationDate);
  calendarDateSchema.parse(input.extraPaymentStartDate);
  if (input.extraPaymentStartDate < input.evaluationDate) {
    throw new RangeError("The extra-payment start date cannot precede evaluation.");
  }
  if (input.debts.length < 1 || input.debts.length > DEBT_STRATEGY_MAX_DEBTS) {
    throw new RangeError("Select between one and eight debts.");
  }
  if (input.extraPayment.amountMinor < 0n) {
    throw new RangeError("The extra-payment budget cannot be negative.");
  }
  const ids = new Set<string>();
  for (const debt of input.debts) {
    if (ids.has(debt.id)) throw new RangeError("A debt cannot be selected twice.");
    ids.add(debt.id);
    if (debt.balance.currency !== input.extraPayment.currency) {
      throw new RangeError("Debt strategies cannot combine currencies.");
    }
    if (debt.balance.amountMinor < 0n) throw new RangeError("Debt balance cannot be negative.");
    if (debt.firstPaymentDate < input.evaluationDate) {
      throw new RangeError("The first payment date cannot precede evaluation.");
    }
    if (debt.minimumPayment.kind === "fixed") {
      if (debt.minimumPayment.amount.currency !== debt.balance.currency || debt.minimumPayment.amount.amountMinor <= 0n) {
        throw new RangeError("Fixed minimum payment must be positive and same-currency.");
      }
    }
    if (debt.minimumPayment.kind === "formula") {
      if (
        debt.minimumPayment.floor.currency !== debt.balance.currency ||
        debt.minimumPayment.floor.amountMinor < 0n ||
        !Number.isInteger(debt.minimumPayment.percentageBps) ||
        debt.minimumPayment.percentageBps < 0 ||
        debt.minimumPayment.percentageBps > 100_000
      ) throw new RangeError("The minimum-payment formula is invalid.");
    }
    debt.fees.forEach((fee) => {
      if (fee.amount.currency !== debt.balance.currency || fee.amount.amountMinor < 0n) {
        throw new RangeError("Known fees must be non-negative and same-currency.");
      }
      if (fee.dueDate < input.evaluationDate) {
        throw new RangeError("Known future fees cannot precede evaluation.");
      }
    });
    if (debt.prepayment.kind === "fixed_fee" && (
      debt.prepayment.amount.currency !== debt.balance.currency ||
      debt.prepayment.amount.amountMinor < 0n
    )) throw new RangeError("The prepayment fee is invalid.");
    if (debt.prepayment.kind === "percentage_of_principal" && (
      !Number.isInteger(debt.prepayment.percentageBps) ||
      debt.prepayment.percentageBps < 0 ||
      debt.prepayment.percentageBps > 100_000
    )) throw new RangeError("The prepayment percentage is invalid.");
    if (debt.interest.kind === "fixed_rate" || debt.interest.kind === "variable_rate") {
      if (debt.interest.rates.length < 1 || debt.interest.rates.length > 24) {
        throw new RangeError("Rate schedules require between one and 24 entries.");
      }
      if (debt.interest.kind === "fixed_rate" && debt.interest.rates.length !== 1) {
        throw new RangeError("A fixed-rate debt must have exactly one rate term.");
      }
      if (
        (debt.interest.accrualConvention === "monthly_compounded" && debt.interest.rateApplication === "effective_date") ||
        (debt.interest.accrualConvention !== "monthly_compounded" && debt.interest.rateApplication !== "effective_date")
      ) {
        throw new RangeError("The rate-application rule does not match the accrual convention.");
      }
      const dates = new Set<string>();
      for (const rate of debt.interest.rates) {
        if (!Number.isInteger(rate.annualRateBps) || rate.annualRateBps < -100_000 || rate.annualRateBps > 100_000) {
          throw new RangeError("Annual rate basis points are invalid.");
        }
        if (dates.has(rate.effectiveDate)) throw new RangeError("Rate effective dates must be unique.");
        dates.add(rate.effectiveDate);
      }
    }
  }
  if (input.customPriority.length !== input.debts.length ||
    new Set(input.customPriority).size !== input.debts.length ||
    input.customPriority.some((id) => !ids.has(id))) {
    throw new RangeError("Custom priority must list every selected debt exactly once.");
  }
}

function overallCompleteness(assessments: readonly DebtStrategyDebtAssessment[]): DebtCalculationCompleteness {
  if (assessments.some((item) => item.completeness === "insufficient_information")) {
    return "insufficient_information";
  }
  return assessments.some((item) => item.completeness === "assumption_based")
    ? "assumption_based"
    : "verified";
}

function initialState(debt: DebtStrategyDebt, evaluationDate: CalendarDate): DebtState {
  return {
    debt,
    feesAssessedIndexes: new Set(),
    feesDue: 0n,
    interestDue: 0n,
    lastAccrualDate: evaluationDate,
    payoffDate: debt.balance.amountMinor === 0n ? evaluationDate : null,
    prepaymentFeeAssessed: false,
    principal: debt.balance.amountMinor,
    totalInterest: 0n,
    totalKnownFees: 0n,
    totalRepayment: 0n,
  };
}

function normalizeNegativeInterest(state: DebtState, accrued: bigint): bigint {
  if (accrued >= 0n) {
    state.interestDue += accrued;
    return accrued;
  }
  const credit = -accrued > state.principal ? state.principal : -accrued;
  state.principal -= credit;
  return -credit;
}

function accrueInterest(state: DebtState, date: CalendarDate, scheduled: boolean): bigint {
  const model = state.debt.interest;
  if (model.kind === "none" || model.kind === "unknown" || state.principal === 0n) {
    if (model.kind !== "unknown" && model.kind !== "none" && scheduled) state.lastAccrualDate = date;
    return 0n;
  }
  let accrued = 0n;
  if (model.accrualConvention === "monthly_compounded") {
    if (!scheduled) return 0n;
    const rateDate = model.rateApplication === "period_start" ? state.lastAccrualDate : date;
    const rate = applicableRate(model, rateDate);
    if (rate === null) return 0n;
    accrued = roundRatioHalfEven(
      state.principal * BigInt(rate.annualRateBps),
      120_000n,
    );
    state.lastAccrualDate = date;
  } else {
    if (date <= state.lastAccrualDate) return 0n;
    const changes = model.rates
      .map((rate) => rate.effectiveDate)
      .filter((effectiveDate) => effectiveDate > state.lastAccrualDate && effectiveDate < date)
      .sort();
    const boundaries = [state.lastAccrualDate, ...changes, date];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index]!;
      const end = boundaries[index + 1]!;
      const rate = applicableRate(model, start);
      if (rate === null) continue;
      const denominator = model.accrualConvention === "actual_365" ? 3_650_000n : 3_600_000n;
      accrued += roundRatioHalfEven(
        state.principal * BigInt(rate.annualRateBps) * BigInt(daysBetween(start, end)),
        denominator,
      );
    }
    state.lastAccrualDate = date;
  }
  const actual = normalizeNegativeInterest(state, accrued);
  state.totalInterest += actual;
  return actual;
}

function assessKnownFees(state: DebtState, date: CalendarDate): bigint {
  let assessed = 0n;
  state.debt.fees.forEach((fee, index) => {
    if (!state.feesAssessedIndexes.has(index) && fee.dueDate <= date) {
      state.feesAssessedIndexes.add(index);
      state.feesDue += fee.amount.amountMinor;
      state.totalKnownFees += fee.amount.amountMinor;
      assessed += fee.amount.amountMinor;
    }
  });
  return assessed;
}

function totalDue(state: DebtState): bigint {
  return state.principal + state.interestDue + state.feesDue;
}

function minimumPayment(state: DebtState): bigint {
  const rule = state.debt.minimumPayment;
  if (rule.kind === "unknown") return 0n;
  const due = totalDue(state);
  if (rule.kind === "fixed") return rule.amount.amountMinor < due ? rule.amount.amountMinor : due;
  const basis = rule.basis === "principal" ? state.principal : due;
  const percentage = roundRatioHalfEven(
    basis * BigInt(rule.percentageBps),
    10_000n,
  );
  const planned = percentage > rule.floor.amountMinor ? percentage : rule.floor.amountMinor;
  return planned < due ? planned : due;
}

function allocatePayment(state: DebtState, budget: bigint): bigint {
  const order = state.debt.allocationOrder?.order ?? null;
  if (order === null || budget <= 0n) return 0n;
  let remaining = budget;
  for (const component of order) {
    const current = component === "principal" ? state.principal :
      component === "interest" ? state.interestDue : state.feesDue;
    const paid = remaining < current ? remaining : current;
    if (component === "principal") state.principal -= paid;
    else if (component === "interest") state.interestDue -= paid;
    else state.feesDue -= paid;
    remaining -= paid;
    if (remaining === 0n) break;
  }
  const used = budget - remaining;
  state.totalRepayment += used;
  return used;
}

function prepaymentFee(state: DebtState): bigint {
  const term = state.debt.prepayment;
  if (term.kind === "unknown" || term.kind === "free") return 0n;
  if (term.kind === "fixed_fee") return term.amount.amountMinor;
  return roundRatioHalfEven(
    state.principal * BigInt(term.percentageBps),
    10_000n,
  );
}

function maybeComplete(state: DebtState, date: CalendarDate): boolean {
  if (state.payoffDate === null && totalDue(state) === 0n) {
    state.payoffDate = date;
    return true;
  }
  return false;
}

function point(
  state: DebtState,
  date: CalendarDate,
  kind: "extra" | "scheduled",
  payment: bigint,
  interestAccrued: bigint,
  feesAssessed: bigint,
): DebtPaymentPoint {
  const currency = state.debt.balance.currency;
  return {
    calendarDate: date,
    debtId: state.debt.id,
    feesAfter: money(state.feesDue, currency),
    feesAssessed: money(feesAssessed, currency),
    interestAccrued: money(interestAccrued, currency),
    interestAfter: money(state.interestDue, currency),
    kind,
    payment: money(payment, currency),
    principalAfter: money(state.principal, currency),
  };
}

function priorityFor(
  strategy: DebtStrategyKind,
  states: readonly DebtState[],
  date: CalendarDate,
  customPriority: readonly string[],
): DebtState[] {
  const customRank = new Map(customPriority.map((id, index) => [id, index]));
  return [...states].filter((state) => state.payoffDate === null).sort((left, right) => {
    if (strategy === "snowball") {
      return left.principal < right.principal ? -1 : left.principal > right.principal ? 1 :
        left.debt.id.localeCompare(right.debt.id);
    }
    if (strategy === "avalanche") {
      const leftRate = left.debt.interest.kind === "none" || left.debt.interest.kind === "unknown"
        ? 0 : applicableRate(left.debt.interest, date)?.annualRateBps ?? 0;
      const rightRate = right.debt.interest.kind === "none" || right.debt.interest.kind === "unknown"
        ? 0 : applicableRate(right.debt.interest, date)?.annualRateBps ?? 0;
      return rightRate - leftRate || left.debt.id.localeCompare(right.debt.id);
    }
    return (customRank.get(left.debt.id) ?? Number.MAX_SAFE_INTEGER) -
      (customRank.get(right.debt.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.debt.id.localeCompare(right.debt.id);
  });
}

function costIsComparable(
  debts: readonly DebtStrategyDebt[],
  assessments: readonly DebtStrategyDebtAssessment[],
): boolean {
  if (assessments.some((assessment) => assessment.completeness !== "verified")) return false;
  const conventions = new Set(debts.map((debt) =>
    debt.interest.kind === "none" ? "none" :
      debt.interest.kind === "unknown" ? "unknown" : debt.interest.accrualConvention,
  ));
  return conventions.size === 1;
}

function calculateOne(
  input: DebtStrategyInput,
  eligibleDebts: readonly DebtStrategyDebt[],
  assessments: readonly DebtStrategyDebtAssessment[],
  strategy: DebtStrategyKind,
): DebtStrategyResult {
  const currency = input.extraPayment.currency;
  const states = eligibleDebts.map((debt) => initialState(debt, input.evaluationDate));
  const timeline: DebtPaymentPoint[] = [];
  const payoffOrder: Array<{ debtId: string; payoffDate: CalendarDate }> = [];
  const events: Array<Readonly<{
    date: CalendarDate;
    debtId: string | null;
    kind: "extra" | "scheduled";
  }>> = [];
  for (let month = 0; month < DEBT_STRATEGY_MAX_MONTHS; month += 1) {
    events.push(...states.map((state) => ({
        date: addCalendarMonthsClamped(state.debt.firstPaymentDate, month),
        debtId: state.debt.id,
        kind: "scheduled" as const,
      })));
    if (strategy !== "baseline" && input.extraPayment.amountMinor > 0n) {
      events.push({
        date: addCalendarMonthsClamped(input.extraPaymentStartDate, month),
        debtId: null,
        kind: "extra",
      });
    }
  }
  events.sort((left, right) =>
    compareCalendarDates(left.date, right.date) ||
    (left.kind === right.kind
      ? (left.debtId ?? "").localeCompare(right.debtId ?? "")
      : left.kind === "scheduled" ? -1 : 1),
  );
  for (const event of events) {
    if (states.every((state) => state.payoffDate !== null)) break;
    if (event.kind === "scheduled") {
      const state = states.find((candidate) => candidate.debt.id === event.debtId)!;
      if (state.payoffDate !== null) continue;
      const feesAssessed = assessKnownFees(state, event.date);
      const interestAccrued = accrueInterest(state, event.date, true);
      const payment = allocatePayment(state, minimumPayment(state));
      timeline.push(point(state, event.date, "scheduled", payment, interestAccrued, feesAssessed));
      if (maybeComplete(state, event.date)) payoffOrder.push({ debtId: state.debt.id, payoffDate: event.date });
      continue;
    }
    const accrued = new Map<string, Readonly<{ fees: bigint; interest: bigint }>>();
    for (const state of states.filter((candidate) => candidate.payoffDate === null)) {
      accrued.set(state.debt.id, {
        fees: assessKnownFees(state, event.date),
        interest: accrueInterest(state, event.date, false),
      });
      if (maybeComplete(state, event.date)) payoffOrder.push({ debtId: state.debt.id, payoffDate: event.date });
    }
    let remaining = input.extraPayment.amountMinor;
    for (const state of priorityFor(strategy, states, event.date, input.customPriority)) {
      if (remaining <= 0n) break;
      const eventAccrual = accrued.get(state.debt.id) ?? { fees: 0n, interest: 0n };
      let feesAssessed = eventAccrual.fees;
      if (!state.prepaymentFeeAssessed && remaining >= totalDue(state)) {
        const charge = prepaymentFee(state);
        state.prepaymentFeeAssessed = true;
        state.feesDue += charge;
        state.totalKnownFees += charge;
        feesAssessed += charge;
      }
      const payment = allocatePayment(state, remaining);
      remaining -= payment;
      timeline.push(point(state, event.date, "extra", payment, eventAccrual.interest, feesAssessed));
      if (maybeComplete(state, event.date)) payoffOrder.push({ debtId: state.debt.id, payoffDate: event.date });
    }
  }
  const payoffDates = states.flatMap((state) => state.payoffDate === null ? [] : [state.payoffDate]);
  const payoffDate = payoffDates.length === states.length && states.length > 0
    ? payoffDates.sort().at(-1)! : null;
  const completeness = overallCompleteness(assessments);
  return {
    calculationCompleteness: completeness,
    costComparable: strategy !== "avalanche" || costIsComparable(eligibleDebts, assessments),
    costSavedVersusBaseline: null,
    excludedDebtIds: assessments
      .filter((assessment) => assessment.completeness === "insufficient_information")
      .map((assessment) => assessment.debtId),
    payoffDate,
    payoffOrder,
    payoffReached: payoffDate !== null,
    scheduledPaymentTotal: money(
      timeline.filter((item) => item.kind === "scheduled")
        .reduce((total, item) => total + item.payment.amountMinor, 0n),
      currency,
    ),
    strategy,
    timeSavedDaysVersusBaseline: null,
    timeline,
    totalInterest: money(states.reduce((total, state) => total + state.totalInterest, 0n), currency),
    totalKnownFees: money(states.reduce((total, state) => total + state.totalKnownFees, 0n), currency),
    totalRepayment: money(states.reduce((total, state) => total + state.totalRepayment, 0n), currency),
  };
}

export function calculateDebtStrategies(input: DebtStrategyInput): DebtStrategyComparison {
  validateInput(input);
  const assessments = input.debts.map((debt) => assessDebtTerms(debt, input.evaluationDate));
  const assessmentById = new Map(assessments.map((assessment) => [assessment.debtId, assessment]));
  const eligible = input.debts.filter((debt) =>
    assessmentById.get(debt.id)?.completeness !== "insufficient_information",
  );
  const kinds: readonly DebtStrategyKind[] = ["baseline", "avalanche", "snowball", "custom"];
  const raw = kinds.map((kind) => calculateOne(input, eligible, assessments, kind));
  const baseline = raw[0]!;
  const results = raw.map((result) => {
    if (result.strategy === "baseline") return result;
    const payoffComparable = baseline.payoffDate !== null && result.payoffDate !== null;
    const completeComparison = payoffComparable &&
      baseline.calculationCompleteness !== "insufficient_information" &&
      result.calculationCompleteness !== "insufficient_information";
    return {
      ...result,
      costSavedVersusBaseline: completeComparison
        ? money(
            baseline.totalRepayment.amountMinor - result.totalRepayment.amountMinor,
            input.extraPayment.currency,
          )
        : null,
      timeSavedDaysVersusBaseline: completeComparison
        ? daysBetween(result.payoffDate!, baseline.payoffDate!)
        : null,
    };
  });
  return {
    assessments,
    calculationCompleteness: overallCompleteness(assessments),
    currency: input.extraPayment.currency,
    engineVersion: DEBT_STRATEGY_ENGINE_VERSION,
    evaluationDate: input.evaluationDate,
    extraPayment: input.extraPayment,
    extraPaymentStartDate: input.extraPaymentStartDate,
    policyVersion: DEBT_STRATEGY_POLICY_VERSION,
    requiredMonthlyPayment: money(
      eligible.reduce((total, debt) => total + minimumPayment(initialState(debt, input.evaluationDate)), 0n),
      input.extraPayment.currency,
    ),
    results,
  };
}
