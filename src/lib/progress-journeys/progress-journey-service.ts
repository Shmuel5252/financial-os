import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { getBudgetRepository, type BudgetRepository } from "@/lib/budgets/budget-repository";
import { calendarDateAtInstant } from "@/lib/domain/financial-engine/financial-calendar";
import { progressEventDraft, projectProgressJourney } from "@/lib/domain/progress-journeys/progress-journey-engine";
import { getFinancialEngineSnapshotRepository, type FinancialEngineSnapshotRepository } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { assessFinancialEngineSnapshotFreshness } from "@/lib/financial-engine/financial-engine-snapshot-freshness";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import { getGoalRepository, type GoalRepository } from "@/lib/goals/goal-repository";
import { manualSectionDomainSchemas } from "@/lib/onboarding/manual-record";
import { getManualRecordRepository, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { loadProfile } from "@/lib/profiles/profile-service";
import type { UserProfile } from "@/lib/profiles/profile";
import {
  toProgressJourneyEventView,
  toProgressJourneyPreferenceView,
  type EvaluateProgressJourneyCommand,
  type ProgressJourneyView,
  type ProgressObservation,
  type ProgressOutcome,
  type UpdateProgressJourneyPreferencesCommand,
} from "@/lib/progress-journeys/progress-journey";
import { getProgressJourneyRepository, type ProgressJourneyRepository } from "@/lib/progress-journeys/progress-journey-repository";
import { getFinancialReportRepository, type FinancialReportRepository } from "@/lib/reports/report-repository";
import { DependencyUnavailableError, InputValidationError } from "@/lib/errors/application-error";

export type ProgressJourneyDependencies = Readonly<{
  budgetRepository?: BudgetRepository;
  engineRepository?: FinancialEngineSnapshotRepository;
  engineFreshnessAssessor?: (actor: Actor, profile: UserProfile, snapshot: FinancialEngineSnapshot) => Promise<readonly string[]>;
  goalRepository?: GoalRepository;
  goalsRepository?: ManualRecordRepository;
  now?: () => Date;
  profileLoader?: (actor: Actor) => Promise<UserProfile | null>;
  reportRepository?: FinancialReportRepository;
  repository?: ProgressJourneyRepository;
}>;

async function dependencies(input?: ProgressJourneyDependencies) {
  return {
    budgetRepository: input?.budgetRepository ?? await getBudgetRepository(),
    engineRepository: input?.engineRepository ?? await getFinancialEngineSnapshotRepository(),
    engineFreshnessAssessor: input?.engineFreshnessAssessor ?? ((actor: Actor, profile: UserProfile, snapshot: FinancialEngineSnapshot) => assessFinancialEngineSnapshotFreshness(actor, profile, snapshot)),
    goalRepository: input?.goalRepository ?? await getGoalRepository(),
    goalsRepository: input?.goalsRepository ?? await getManualRecordRepository("goals"),
    now: input?.now ?? (() => new Date()),
    profileLoader: input?.profileLoader ?? loadProfile,
    reportRepository: input?.reportRepository ?? await getFinancialReportRepository(),
    repository: input?.repository ?? await getProgressJourneyRepository(),
  };
}

function source(kind: ProgressObservation["sourceReferences"][number]["kind"], sourceId: string, version: string) {
  return { kind, sourceId, version } as const;
}

function observation(input: Omit<ProgressObservation, "ruleId"> & Readonly<{ ruleId: string }>): ProgressObservation {
  return input;
}

function takeLatestPer<T>(items: readonly T[], key: (item: T) => string, compare: (left: T, right: T) => number): readonly T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    const previous = result.get(key(item));
    if (previous === undefined || compare(previous, item) < 0) result.set(key(item), item);
  }
  return [...result.values()];
}

async function listEngineSnapshots(
  actor: Actor,
  origin: EvaluateProgressJourneyCommand["origin"],
  repository: FinancialEngineSnapshotRepository,
): Promise<readonly FinancialEngineSnapshot[]> {
  if (origin === "live") return (await repository.listForActor(actor, { limit: 1 })).snapshots;
  const result: FinancialEngineSnapshot[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.listForActor(actor, { ...(cursor === undefined ? {} : { cursor }), limit: 20 });
    result.push(...page.snapshots);
    if (result.length > 1_000) throw new DependencyUnavailableError("The progress snapshot backfill exceeds its safe bound.");
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return result;
}

async function collectObservations(actor: Actor, origin: EvaluateProgressJourneyCommand["origin"], resolved: Awaited<ReturnType<typeof dependencies>>): Promise<readonly ProgressObservation[]> {
  const [profile, goalRecords, goalProgress, budgetPeriods, engineSnapshots, reports] = await Promise.all([
    resolved.profileLoader(actor),
    resolved.goalsRepository.listAllForActor(actor, 1_000),
    resolved.goalRepository.listAllProgressForActor(actor, 10_000),
    resolved.budgetRepository.listPeriodsForActor(actor),
    listEngineSnapshots(actor, origin, resolved.engineRepository),
    resolved.reportRepository.listForActor(actor, 100),
  ]);
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required for progress journeys." }]);
  const labels = new Map(goalRecords.map((record) => [record.id, manualSectionDomainSchemas.goals.parse(record.fields)]));
  const selectedGoalProgress = origin === "backfill" ? goalProgress : takeLatestPer(goalProgress, (item) => item.goalId, (left, right) => left.evaluatedAt.getTime() - right.evaluatedAt.getTime());
  const closedBudgets = budgetPeriods.filter((item) => item.status === "closed" && item.closingSnapshot !== null);
  const selectedBudgets = origin === "backfill" ? closedBudgets : closedBudgets.slice(-1);
  const latestSnapshotsByDate = takeLatestPer(engineSnapshots, (item) => item.result.evaluationDate, (left, right) => left.calculatedAt.getTime() - right.calculatedAt.getTime());
  const selectedSnapshots = origin === "backfill" ? latestSnapshotsByDate : [...latestSnapshotsByDate].sort((left, right) => right.calculatedAt.getTime() - left.calculatedAt.getTime()).slice(0, 1);
  const personalMonthly = reports.filter((item) => item.report.scope.kind === "personal" && item.report.period.kind === "month");
  const latestReportPerMonth = takeLatestPer(personalMonthly, (item) => item.report.period.value, (left, right) => left.reportVersion - right.reportVersion || left.createdAt.getTime() - right.createdAt.getTime());
  const selectedReports = origin === "backfill" ? latestReportPerMonth : [...latestReportPerMonth].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 1);
  const result: ProgressObservation[] = [];

  for (const progress of [...selectedGoalProgress].sort((left, right) => left.evaluatedAt.getTime() - right.evaluatedAt.getTime())) {
    const fields = labels.get(progress.goalId);
    const label = fields?.title ?? "יעד פיננסי";
    if (progress.result.verification === "verified") {
      const outcome: ProgressOutcome = progress.result.status === "regressed"
        ? "not_achieved"
        : progress.result.status === "completed" || progress.result.status === "target_reached_pending_confirmation" || progress.result.normalizedProgressBasisPoints >= 10_000
          ? "achieved"
          : "in_progress";
      result.push(observation({
        dimension: "goal_progress",
        evaluationDate: progress.evaluationDate,
        origin,
        outcome,
        period: { kind: "day", value: progress.evaluationDate },
        ruleId: "verified-goal-state",
        seriesKey: `${progress.goalId}:${progress.goalVersion}`,
        sourceReferences: [source("goal_progress", progress.id, `${progress.goalVersion}/${progress.engineVersion}/${progress.policyVersion}`)],
        subjectKey: `${progress.goalId}:${progress.goalVersion}:${progress.id}`,
        subjectLabel: label,
        value: progress.result.normalizedProgressBasisPoints,
      }));
      for (const milestone of progress.milestonesCrossed) {
        result.push(observation({
          dimension: "goal_milestone",
          evaluationDate: progress.evaluationDate,
          origin,
          outcome: "achieved",
          period: { kind: "milestone", value: `${progress.goalVersion}:${milestone}` },
          ruleId: "goal-engine-milestone",
          seriesKey: `${progress.goalId}:${progress.goalVersion}`,
          sourceReferences: [source("goal_progress", progress.id, `${progress.goalVersion}/${progress.engineVersion}/${progress.policyVersion}`)],
          subjectKey: `${progress.goalId}:${progress.goalVersion}:${milestone}`,
          subjectLabel: label,
          value: milestone / 100,
        }));
      }
    }
  }
  for (const period of selectedBudgets) {
    const calculation = period.closingSnapshot;
    if (calculation === null) continue;
    const achieved = calculation.unallocated.amountMinor >= 0n && calculation.lines.every((line) => line.remaining.amountMinor >= 0n);
    result.push(observation({
      dimension: "within_budget",
      evaluationDate: period.closedAt?.toISOString().slice(0, 10) ?? `${period.calendarMonth}-01`,
      origin,
      outcome: achieved ? "achieved" : "not_achieved",
      period: { kind: "month", value: period.calendarMonth },
      ruleId: "closed-budget-without-deficit",
      seriesKey: "personal-budget",
      sourceReferences: [source("budget_period", period.id, String(period.version))],
      subjectKey: period.calendarMonth,
      subjectLabel: period.calendarMonth,
      value: null,
    }));
  }

  for (const snapshot of [...selectedSnapshots].reverse()) {
    const resultValue = snapshot.result;
    const freshnessReasons = origin === "live" ? await resolved.engineFreshnessAssessor(actor, profile, snapshot) : [];
    const fresh = freshnessReasons.length === 0;
    const noOverdraft = resultValue.minimumConfirmedBalance.amountMinor >= 0n;
    const marginMaintained = resultValue.availableCash.amountMinor >= resultValue.safetyMarginAtEvaluation.amountMinor && resultValue.timeline.every((point) => point.confirmedBalance.amountMinor >= point.safetyMargin.amountMinor);
    const version = `${snapshot.engineVersion}/${snapshot.policyVersion}/${snapshot.inputHash}/${fresh ? "fresh" : "stale"}`;
    result.push(observation({
      dimension: "no_overdraft", evaluationDate: resultValue.evaluationDate, origin, outcome: fresh ? (noOverdraft ? "achieved" : "not_achieved") : "unknown",
      period: { kind: "day", value: resultValue.evaluationDate }, ruleId: "confirmed-projection-nonnegative",
      seriesKey: "personal-confirmed-cash",
      sourceReferences: [source("engine_snapshot", snapshot.id, version)], subjectKey: resultValue.evaluationDate,
      subjectLabel: "תחזית יתרה מאומתת ללא חריגה", value: null,
    }));
    result.push(observation({
      dimension: "safety_margin", evaluationDate: resultValue.evaluationDate, origin, outcome: fresh ? (marginMaintained ? "achieved" : "not_achieved") : "unknown",
      period: { kind: "day", value: resultValue.evaluationDate }, ruleId: "confirmed-projection-maintains-margin",
      seriesKey: "personal-confirmed-cash",
      sourceReferences: [source("engine_snapshot", snapshot.id, version)], subjectKey: resultValue.evaluationDate,
      subjectLabel: "מרווח הביטחון נשמר בתחזית המאומתת", value: null,
    }));
  }

  for (const report of selectedReports) {
    const month = report.report.period.value;
    const reportEvaluationDate = calendarDateAtInstant(report.createdAt.toISOString(), profile.fields.timeZone);
    const currentDate = calendarDateAtInstant(resolved.now().toISOString(), profile.fields.timeZone);
    const reportVersion = `${report.reportVersion}/${report.report.engineVersion}/${report.report.policyVersion}/${report.report.sourceFingerprint}`;
    const reportSource = [source("financial_report", report.id, reportVersion)];
    result.push(observation({
      dimension: "regular_review", evaluationDate: reportEvaluationDate, origin, outcome: "achieved",
      period: { kind: "month", value: month }, ruleId: "closed-personal-monthly-review", sourceReferences: reportSource,
      seriesKey: "personal-monthly-review",
      subjectKey: month, subjectLabel: month, value: null,
    }));
    const netLines = report.report.sections.cashFlow.filter((line) => line.key === "cash_flow.net");
    const outcome: ProgressOutcome = report.report.periodEnd > currentDate || netLines.length === 0 ? "unknown" : netLines.every((line) => line.amount.amountMinor > 0n) ? "achieved" : "not_achieved";
    result.push(observation({
      dimension: "positive_cash_flow", evaluationDate: reportEvaluationDate, origin, outcome,
      period: { kind: "month", value: month }, ruleId: "confirmed-monthly-positive-cash-flow", sourceReferences: reportSource,
      seriesKey: "personal-confirmed-cash-flow",
      subjectKey: month, subjectLabel: month, value: null,
    }));
  }

  return result.sort((left, right) => left.evaluationDate.localeCompare(right.evaluationDate) || left.dimension.localeCompare(right.dimension) || left.subjectKey.localeCompare(right.subjectKey));
}

export async function collectProgressObservationsForActor(
  actor: Actor,
  origin: EvaluateProgressJourneyCommand["origin"],
  input: ProgressJourneyDependencies,
): Promise<readonly ProgressObservation[]> {
  return collectObservations(actor, origin, await dependencies(input));
}

export async function loadProgressJourney(actor: Actor, input?: ProgressJourneyDependencies): Promise<ProgressJourneyView> {
  const resolved = await dependencies(input);
  const [events, preference] = await Promise.all([resolved.repository.listEventsForActor(actor), resolved.repository.findPreferencesForActor(actor)]);
  const preferenceView = toProgressJourneyPreferenceView(preference);
  const projection = projectProgressJourney(events, preferenceView.streaksEnabled);
  return {
    dimensions: projection.dimensions,
    events: [...events].sort((left, right) => right.evaluationDate.localeCompare(left.evaluationDate) || right.createdAt.getTime() - left.createdAt.getTime()).map(toProgressJourneyEventView),
    phase9ProviderEvidenceAvailable: false,
    preferences: preferenceView,
    scope: "personal",
    streaks: projection.streaks,
  };
}

export async function evaluateProgressJourney(actor: Actor, command: EvaluateProgressJourneyCommand, input?: ProgressJourneyDependencies): Promise<ProgressJourneyView> {
  const resolved = await dependencies(input);
  const observations = await collectObservations(actor, command.origin, resolved);
  const priorByDimension = new Map<string, ProgressOutcome>();
  for (const event of [...await resolved.repository.listEventsForActor(actor)].sort((left, right) => left.evaluationDate.localeCompare(right.evaluationDate))) {
    priorByDimension.set(event.seriesKey, event.outcome);
  }
  for (const item of observations) {
    const draft = progressEventDraft(item, priorByDimension.get(progressEventDraft(item, null).seriesKey) ?? null);
    await resolved.repository.appendForActor(actor, draft);
    priorByDimension.set(draft.seriesKey, item.outcome);
  }
  return loadProgressJourney(actor, resolved);
}

export async function saveProgressJourneyPreferences(actor: Actor, command: UpdateProgressJourneyPreferencesCommand, input?: ProgressJourneyDependencies): Promise<ProgressJourneyView> {
  const resolved = await dependencies(input);
  await resolved.repository.savePreferencesForActor(actor, command);
  return loadProgressJourney(actor, resolved);
}
