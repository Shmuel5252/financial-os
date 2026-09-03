import { createHash } from "node:crypto";

import {
  PROGRESS_JOURNEY_ENGINE_VERSION,
  PROGRESS_JOURNEY_POLICY_VERSION,
  PROGRESS_JOURNEY_RULE_VERSION,
  type ProgressDimension,
  type ProgressEventKind,
  type ProgressJourneyEvent,
  type ProgressObservation,
  type ProgressOutcome,
  type ProgressStreakView,
} from "@/lib/progress-journeys/progress-journey";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}

export function progressObservationStableKey(observation: ProgressObservation): string {
  return hash({ dimension: observation.dimension, period: observation.period, ruleId: observation.ruleId, subjectKey: observation.subjectKey });
}

export function progressObservationSeriesKey(observation: ProgressObservation): string {
  return hash({ dimension: observation.dimension, ruleId: observation.ruleId, seriesKey: observation.seriesKey });
}

export function progressObservationFingerprint(observation: ProgressObservation): string {
  return hash({
    dimension: observation.dimension,
    evaluationDate: observation.evaluationDate,
    outcome: observation.outcome,
    period: observation.period,
    policyVersion: PROGRESS_JOURNEY_POLICY_VERSION,
    ruleId: observation.ruleId,
    ruleVersion: PROGRESS_JOURNEY_RULE_VERSION,
    sourceReferences: [...observation.sourceReferences].sort((left, right) => left.kind.localeCompare(right.kind) || left.sourceId.localeCompare(right.sourceId) || left.version.localeCompare(right.version)),
    subjectKey: observation.subjectKey,
    value: observation.value,
  });
}

export function eventKindForOutcome(outcome: ProgressOutcome, priorOutcome: ProgressOutcome | null): ProgressEventKind {
  if (outcome === "unknown") return "insufficient_evidence";
  if (outcome === "in_progress") return priorOutcome === "not_achieved" ? "recovery" : "observation";
  if (outcome === "not_achieved") return priorOutcome === "achieved" || priorOutcome === "in_progress" ? "regression" : "observation";
  if (priorOutcome === "not_achieved" || priorOutcome === "unknown") return "recovery";
  return "achievement";
}

export type ProgressEventDraft = Omit<ProgressJourneyEvent, "createdAt" | "id" | "supersedesId">;

export function progressEventDraft(observation: ProgressObservation, priorOutcome: ProgressOutcome | null): ProgressEventDraft {
  return {
    dimension: observation.dimension,
    engineVersion: PROGRESS_JOURNEY_ENGINE_VERSION,
    evaluationDate: observation.evaluationDate,
    eventKind: eventKindForOutcome(observation.outcome, priorOutcome),
    evidenceFingerprint: progressObservationFingerprint(observation),
    origin: observation.origin,
    outcome: observation.outcome,
    period: observation.period,
    policyVersion: PROGRESS_JOURNEY_POLICY_VERSION,
    ruleId: observation.ruleId,
    ruleVersion: PROGRESS_JOURNEY_RULE_VERSION,
    seriesKey: progressObservationSeriesKey(observation),
    sourceReferences: observation.sourceReferences,
    stableKey: progressObservationStableKey(observation),
    subjectLabel: observation.subjectLabel,
    value: observation.value,
  };
}

function periodIndex(kind: "day" | "month", value: string): number {
  if (kind === "day") return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000);
  const [year, month] = value.split("-").map(Number);
  if (year === undefined || month === undefined) throw new RangeError("Invalid progress month.");
  return year * 12 + month - 1;
}

function currentEvents(events: readonly ProgressJourneyEvent[]): readonly ProgressJourneyEvent[] {
  const latest = new Map<string, ProgressJourneyEvent>();
  for (const event of events) {
    const previous = latest.get(event.stableKey);
    if (previous === undefined || previous.createdAt < event.createdAt || (previous.createdAt.getTime() === event.createdAt.getTime() && previous.id < event.id)) {
      latest.set(event.stableKey, event);
    }
  }
  return [...latest.values()];
}

function streakFor(dimension: Exclude<ProgressDimension, "goal_milestone" | "goal_progress">, events: readonly ProgressJourneyEvent[]): ProgressStreakView | null {
  const matching = events.filter((event) => event.dimension === dimension && event.period.kind !== "milestone");
  if (matching.length === 0) return null;
  const periodKind = matching.some((event) => event.period.kind === "month") ? "month" : "day";
  const perPeriod = new Map<string, ProgressJourneyEvent>();
  for (const event of matching.filter((item) => item.period.kind === periodKind)) {
    const previous = perPeriod.get(event.period.value);
    if (previous === undefined || previous.evaluationDate <= event.evaluationDate) perPeriod.set(event.period.value, event);
  }
  const ordered = [...perPeriod.values()].sort((left, right) => left.period.value.localeCompare(right.period.value));
  let longestLength = 0;
  let run = 0;
  let priorIndex: number | null = null;
  for (const event of ordered) {
    const index = periodIndex(periodKind, event.period.value);
    run = event.outcome === "achieved" ? (priorIndex !== null && index === priorIndex + 1 ? run + 1 : 1) : 0;
    longestLength = Math.max(longestLength, run);
    priorIndex = index;
  }
  const latest = ordered.at(-1);
  if (latest === undefined) return null;
  let currentLength = 0;
  let nextIndex: number | null = null;
  for (const event of [...ordered].reverse()) {
    const index = periodIndex(periodKind, event.period.value);
    if (event.outcome !== "achieved" || (nextIndex !== null && index !== nextIndex - 1)) break;
    currentLength += 1;
    nextIndex = index;
  }
  return { active: latest.outcome === "achieved", currentLength, dimension, longestLength, periodKind };
}

export function projectProgressJourney(events: readonly ProgressJourneyEvent[], streaksEnabled: boolean) {
  const current = currentEvents(events);
  const dimensions = new Map<ProgressDimension, ProgressJourneyEvent>();
  for (const event of current) {
    const previous = dimensions.get(event.dimension);
    if (previous === undefined || previous.evaluationDate < event.evaluationDate || (previous.evaluationDate === event.evaluationDate && previous.createdAt < event.createdAt)) {
      dimensions.set(event.dimension, event);
    }
  }
  const streakDimensions: readonly Exclude<ProgressDimension, "goal_milestone" | "goal_progress">[] = ["no_overdraft", "positive_cash_flow", "regular_review", "safety_margin", "within_budget"];
  return {
    current,
    dimensions: [...dimensions.values()].sort((left, right) => left.dimension.localeCompare(right.dimension)).map((event) => ({
      currentOutcome: event.outcome,
      dimension: event.dimension,
      latestEvaluationDate: event.evaluationDate,
    })),
    streaks: streaksEnabled ? streakDimensions.map((dimension) => streakFor(dimension, current)).filter((value): value is ProgressStreakView => value !== null) : [],
  };
}

export const PROHIBITED_PROGRESS_DIMENSIONS = [
  "app_checking",
  "borrowing",
  "credit_use",
  "debt_creation",
  "investing",
  "spending",
  "trading",
] as const;
