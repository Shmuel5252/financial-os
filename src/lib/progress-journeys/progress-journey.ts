import { z } from "zod";

import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const PROGRESS_JOURNEY_ENGINE_VERSION = "progress-journey-engine-v1" as const;
export const PROGRESS_JOURNEY_POLICY_VERSION = "phase-17-progress-policy-v1" as const;
export const PROGRESS_JOURNEY_RULE_VERSION = "progress-rules-v1" as const;

export const progressDimensionSchema = z.enum([
  "goal_milestone",
  "goal_progress",
  "no_overdraft",
  "positive_cash_flow",
  "regular_review",
  "safety_margin",
  "within_budget",
]);
export const progressOutcomeSchema = z.enum(["achieved", "in_progress", "not_achieved", "unknown"]);
export const progressOriginSchema = z.enum(["backfill", "live"]);
export const progressEventKindSchema = z.enum([
  "achievement",
  "correction",
  "insufficient_evidence",
  "observation",
  "recovery",
  "regression",
]);
export const progressPeriodSchema = z.object({
  kind: z.enum(["day", "milestone", "month"]),
  value: z.string().min(1).max(100),
}).strict();
export const progressSourceReferenceSchema = z.object({
  kind: z.enum(["budget_period", "engine_snapshot", "financial_report", "goal_progress"]),
  sourceId: z.string().min(1).max(200),
  version: z.string().min(1).max(200),
}).strict();

export type ProgressDimension = z.infer<typeof progressDimensionSchema>;
export type ProgressOutcome = z.infer<typeof progressOutcomeSchema>;
export type ProgressOrigin = z.infer<typeof progressOriginSchema>;
export type ProgressEventKind = z.infer<typeof progressEventKindSchema>;
export type ProgressPeriod = z.infer<typeof progressPeriodSchema>;
export type ProgressSourceReference = z.infer<typeof progressSourceReferenceSchema>;

export type ProgressObservation = Readonly<{
  dimension: ProgressDimension;
  evaluationDate: string;
  origin: ProgressOrigin;
  outcome: ProgressOutcome;
  period: ProgressPeriod;
  ruleId: string;
  seriesKey: string;
  sourceReferences: readonly ProgressSourceReference[];
  subjectKey: string;
  subjectLabel: string;
  value: number | null;
}>;

export type ProgressJourneyEvent = Readonly<{
  createdAt: Date;
  dimension: ProgressDimension;
  engineVersion: typeof PROGRESS_JOURNEY_ENGINE_VERSION;
  evaluationDate: string;
  eventKind: ProgressEventKind;
  evidenceFingerprint: string;
  id: string;
  origin: ProgressOrigin;
  outcome: ProgressOutcome;
  period: ProgressPeriod;
  policyVersion: typeof PROGRESS_JOURNEY_POLICY_VERSION;
  ruleId: string;
  ruleVersion: typeof PROGRESS_JOURNEY_RULE_VERSION;
  seriesKey: string;
  sourceReferences: readonly ProgressSourceReference[];
  stableKey: string;
  subjectLabel: string;
  supersedesId: string | null;
  value: number | null;
}>;

export type ProgressJourneyPreference = Readonly<{
  celebrationsEnabled: boolean;
  createdAt: Date;
  progressNotificationsEnabled: boolean;
  streaksEnabled: boolean;
  updatedAt: Date;
  version: number;
}>;

export type ProgressJourneyEventView = Readonly<{
  createdAt: string;
  dimension: ProgressDimension;
  engineVersion: string;
  evaluationDate: string;
  eventKind: ProgressEventKind;
  id: string;
  origin: ProgressOrigin;
  outcome: ProgressOutcome;
  period: ProgressPeriod;
  policyVersion: string;
  ruleId: string;
  ruleVersion: string;
  sourceReferences: readonly Readonly<{ kind: ProgressSourceReference["kind"]; version: string }>[];
  subjectLabel: string;
  supersedesId: string | null;
  value: number | null;
}>;

export type ProgressStreakView = Readonly<{
  active: boolean;
  currentLength: number;
  dimension: Exclude<ProgressDimension, "goal_milestone" | "goal_progress">;
  longestLength: number;
  periodKind: "day" | "month";
}>;

export type ProgressJourneyView = Readonly<{
  dimensions: readonly Readonly<{
    currentOutcome: ProgressOutcome;
    dimension: ProgressDimension;
    latestEvaluationDate: string;
  }>[];
  events: readonly ProgressJourneyEventView[];
  phase9ProviderEvidenceAvailable: false;
  preferences: Readonly<{
    celebrationsEnabled: boolean;
    progressNotificationsEnabled: boolean;
    streaksEnabled: boolean;
    updatedAt: string | null;
    version: number | null;
  }>;
  scope: "personal";
  streaks: readonly ProgressStreakView[];
}>;

export const evaluateProgressJourneyCommandSchema = z.object({
  origin: progressOriginSchema.default("live"),
}).strict();

export const updateProgressJourneyPreferencesCommandSchema = z.object({
  celebrationsEnabled: z.boolean(),
  expectedVersion: z.number().int().positive().nullable(),
  progressNotificationsEnabled: z.boolean(),
  streaksEnabled: z.boolean(),
}).strict();

export type EvaluateProgressJourneyCommand = z.infer<typeof evaluateProgressJourneyCommandSchema>;
export type UpdateProgressJourneyPreferencesCommand = z.infer<typeof updateProgressJourneyPreferencesCommandSchema>;

export const defaultProgressJourneyPreferences: ProgressJourneyView["preferences"] = {
  celebrationsEnabled: true,
  progressNotificationsEnabled: false,
  streaksEnabled: true,
  updatedAt: null,
  version: null,
};

export function toProgressJourneyEventView(event: ProgressJourneyEvent): ProgressJourneyEventView {
  return {
    createdAt: event.createdAt.toISOString(),
    dimension: event.dimension,
    engineVersion: event.engineVersion,
    evaluationDate: event.evaluationDate,
    eventKind: event.eventKind,
    id: event.id,
    origin: event.origin,
    outcome: event.outcome,
    period: event.period,
    policyVersion: event.policyVersion,
    ruleId: event.ruleId,
    ruleVersion: event.ruleVersion,
    sourceReferences: event.sourceReferences.map(({ kind, version }) => ({ kind, version })),
    subjectLabel: event.subjectLabel,
    supersedesId: event.supersedesId,
    value: event.value,
  };
}

export function toProgressJourneyPreferenceView(value: ProgressJourneyPreference | null): ProgressJourneyView["preferences"] {
  return value === null ? defaultProgressJourneyPreferences : {
    celebrationsEnabled: value.celebrationsEnabled,
    progressNotificationsEnabled: value.progressNotificationsEnabled,
    streaksEnabled: value.streaksEnabled,
    updatedAt: value.updatedAt.toISOString(),
    version: value.version,
  };
}

export function parseProgressJourneyCommand<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseUntrusted(schema, value);
}
