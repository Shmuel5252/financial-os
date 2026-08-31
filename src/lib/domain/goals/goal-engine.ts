import { compareCalendarDates } from "@/lib/domain/financial-engine/financial-calendar";
import {
  compareMoney,
  money,
  roundRatioHalfEven,
  subtractMoney,
  type Money,
} from "@/lib/domain/money/money";
import { calendarDateSchema, type CalendarDate } from "@/lib/domain/time/financial-time";
import type {
  GoalDirection,
  GoalLifecycleStatus,
  GoalProgressResult,
  GoalTrend,
  GoalVerification,
} from "@/lib/goals/goal";

export const DEFAULT_GOAL_MILESTONES = [2_500, 5_000, 7_500, 10_000] as const;

export type GoalCalculationInput = Readonly<{
  baselineValue: Money;
  currentValue: Money;
  direction: GoalDirection;
  evaluationDate: CalendarDate;
  previous: GoalProgressResult | null;
  successConditionMet?: boolean | undefined;
  sustainedSuccessDays: number;
  targetValue: Money;
  verification: GoalVerification;
}>;

function ensureCurrency(values: readonly Money[]): string {
  const currency = values[0]?.currency;
  if (currency === undefined || values.some((value) => value.currency !== currency)) {
    throw new RangeError("Goal calculation requires one currency.");
  }
  return currency;
}

function progressNumerator(input: GoalCalculationInput): bigint {
  return input.direction === "increase"
    ? input.currentValue.amountMinor - input.baselineValue.amountMinor
    : input.baselineValue.amountMinor - input.currentValue.amountMinor;
}

function progressDenominator(input: GoalCalculationInput): bigint {
  return input.direction === "increase"
    ? input.targetValue.amountMinor - input.baselineValue.amountMinor
    : input.baselineValue.amountMinor - input.targetValue.amountMinor;
}

function rawProgress(input: GoalCalculationInput, success: boolean): bigint {
  const denominator = progressDenominator(input);
  if (denominator <= 0n) return success ? 10_000n : 0n;
  return roundRatioHalfEven(progressNumerator(input) * 10_000n, denominator);
}

function normalizedProgress(raw: bigint): number {
  if (raw <= 0n) return 0;
  if (raw >= 10_000n) return 10_000;
  return Number(raw);
}

function remainingGap(input: GoalCalculationInput, currency: string): Money {
  const difference = input.direction === "increase"
    ? subtractMoney(input.targetValue, input.currentValue)
    : subtractMoney(input.currentValue, input.targetValue);
  return difference.amountMinor > 0n ? difference : money(0n, currency);
}

function thresholdReached(input: GoalCalculationInput): boolean {
  const comparison = compareMoney(input.currentValue, input.targetValue);
  return input.direction === "increase" ? comparison >= 0 : comparison <= 0;
}

function trend(input: GoalCalculationInput): GoalTrend {
  if (input.previous === null) return "initial";
  const comparison = compareMoney(input.currentValue, input.previous.currentValue);
  if (comparison === 0) return "unchanged";
  const improved = input.direction === "increase" ? comparison > 0 : comparison < 0;
  return improved ? "improving" : "regressing";
}

function elapsedCalendarDays(start: CalendarDate, end: CalendarDate): number {
  if (compareCalendarDates(end, start) < 0) {
    throw new RangeError("Goal evaluation date cannot precede its qualification date.");
  }
  const startInstant = Date.parse(`${start}T00:00:00.000Z`);
  const endInstant = Date.parse(`${end}T00:00:00.000Z`);
  return Math.floor((endInstant - startInstant) / 86_400_000);
}

function lifecycle(
  input: GoalCalculationInput,
  success: boolean,
): Readonly<{
  completedAt: string | null;
  maintainedNow: boolean;
  qualifiedSince: string | null;
  status: GoalLifecycleStatus;
}> {
  if (input.verification === "manual_unverified") {
    return { completedAt: null, maintainedNow: false, qualifiedSince: null, status: "manual_unverified" };
  }
  if (input.verification === "insufficient_data") {
    return { completedAt: null, maintainedNow: false, qualifiedSince: null, status: "insufficient_data" };
  }
  const previousCompletion = input.previous?.completedAt ?? null;
  if (!success) {
    const wasAtTarget = input.previous !== null && ["completed", "target_reached_pending_confirmation"].includes(input.previous.status);
    return {
      completedAt: previousCompletion,
      maintainedNow: false,
      qualifiedSince: null,
      status: wasAtTarget || previousCompletion !== null ? "regressed" : "active",
    };
  }
  if (input.sustainedSuccessDays === 0) {
    return {
      completedAt: previousCompletion ?? input.evaluationDate,
      maintainedNow: true,
      qualifiedSince: input.evaluationDate,
      status: "completed",
    };
  }
  const canContinueQualification =
    input.previous?.maintainedNow === true && input.previous.qualifiedSince !== null;
  const qualifiedSince = calendarDateSchema.parse(
    canContinueQualification ? input.previous?.qualifiedSince : input.evaluationDate,
  );
  const sustained = elapsedCalendarDays(qualifiedSince, input.evaluationDate) >= input.sustainedSuccessDays;
  return {
    completedAt: sustained ? previousCompletion ?? input.evaluationDate : previousCompletion,
    maintainedNow: true,
    qualifiedSince,
    status: sustained ? "completed" : "target_reached_pending_confirmation",
  };
}

export function calculateGoalProgress(input: GoalCalculationInput): GoalProgressResult {
  const currency = ensureCurrency([input.baselineValue, input.currentValue, input.targetValue]);
  if (!Number.isInteger(input.sustainedSuccessDays) || input.sustainedSuccessDays < 0 || input.sustainedSuccessDays > 366) {
    throw new RangeError("Sustained-success days must be between 0 and 366.");
  }
  calendarDateSchema.parse(input.evaluationDate);
  const success = input.verification === "verified" &&
    (input.successConditionMet ?? thresholdReached(input));
  const raw = rawProgress(input, success);
  const state = lifecycle(input, success);
  return {
    baselineValue: input.baselineValue,
    completedAt: state.completedAt,
    currentValue: input.currentValue,
    direction: input.direction,
    maintainedNow: state.maintainedNow,
    normalizedProgressBasisPoints: normalizedProgress(raw),
    qualifiedSince: state.qualifiedSince,
    rawProgressBasisPoints: raw.toString(),
    remainingGap: remainingGap(input, currency),
    status: state.status,
    targetValue: input.targetValue,
    trend: trend(input),
    verification: input.verification,
  };
}

export function newlyCrossedMilestones(
  normalizedProgressBasisPoints: number,
  previouslyRecorded: readonly number[],
  milestones: readonly number[] = DEFAULT_GOAL_MILESTONES,
): readonly number[] {
  const recorded = new Set(previouslyRecorded);
  return milestones.filter(
    (milestone) =>
      Number.isInteger(milestone) &&
      milestone > 0 &&
      milestone <= normalizedProgressBasisPoints &&
      !recorded.has(milestone),
  );
}
