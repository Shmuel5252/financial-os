import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { toSavedDebtStrategyView, type SavedDebtStrategyView } from "@/lib/debt-strategies/debt-strategy";
import { getDebtStrategyRepository, type DebtStrategyRepository } from "@/lib/debt-strategies/debt-strategy-repository";
import {
  toBudgetAllocationView,
  toBudgetCalculationView,
  type BudgetCategoryView,
  type BudgetPeriodView,
} from "@/lib/budgets/budget";
import {
  getBudgetRepository,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import {
  toGoalDefinitionView,
  toGoalProgressEvidenceView,
  type GoalDefinitionView,
  type GoalProgressEvidenceView,
} from "@/lib/goals/goal";
import {
  getGoalRepository,
  type GoalRepository,
} from "@/lib/goals/goal-repository";
import {
  toNetWorthItemView,
  toNetWorthSnapshotView,
} from "@/lib/net-worth/net-worth";
import {
  getNetWorthRepository,
  type NetWorthRepository,
} from "@/lib/net-worth/net-worth-repository";
import {
  toNotificationPreferenceView,
  toNotificationView,
  type NotificationPreferenceView,
  type NotificationView,
} from "@/lib/notifications/notification";
import {
  getNotificationRepository,
  type NotificationRepository,
} from "@/lib/notifications/notification-repository";
import {
  manualSectionSchema,
  toManualRecordView,
  type ManualRecordView,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import { toUserProfileView, type UserProfileView } from "@/lib/profiles/profile";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";
import {
  toProgressJourneyEventView,
  toProgressJourneyPreferenceView,
  type ProgressJourneyEventView,
} from "@/lib/progress-journeys/progress-journey";
import {
  getProgressJourneyRepository,
  type ProgressJourneyRepository,
} from "@/lib/progress-journeys/progress-journey-repository";
import {
  toSavedPurchaseSimulationView,
  type SavedPurchaseSimulationView,
} from "@/lib/purchase-simulations/purchase-simulation";
import {
  getPurchaseSimulationRepository,
  type PurchaseSimulationRepository,
} from "@/lib/purchase-simulations/purchase-simulation-repository";
import {
  toTransactionIntelligenceReviewView,
  toTransactionIntelligenceRunView,
  type TransactionIntelligenceReviewView,
  type TransactionIntelligenceRunView,
} from "@/lib/transaction-intelligence/transaction-intelligence";
import {
  getTransactionIntelligenceRepository,
  type TransactionIntelligenceRepository,
} from "@/lib/transaction-intelligence/transaction-intelligence-repository";

export type FinancialDataExport = Readonly<{
  budgets: Readonly<{
    categories: readonly BudgetCategoryView[];
    corrections: readonly Readonly<{
      at: string;
      fromCategoryId: string | null;
      id: string;
      reason: string;
      toCategoryId: string;
      transactionId: string;
    }>[];
    periods: readonly BudgetPeriodView[];
  }>;
  generatedAt: string;
  debtStrategies: readonly SavedDebtStrategyView[];
  goalEngine: Readonly<{
    definitions: readonly GoalDefinitionView[];
    progressEvidence: readonly GoalProgressEvidenceView[];
  }>;
  netWorth: Readonly<{
    items: readonly ReturnType<typeof toNetWorthItemView>[];
    snapshots: readonly ReturnType<typeof toNetWorthSnapshotView>[];
  }>;
  notifications: Readonly<{
    items: readonly NotificationView[];
    preferences: NotificationPreferenceView;
  }>;
  profile: UserProfileView | null;
  purchaseSimulations: readonly SavedPurchaseSimulationView[];
  progressJourney: Readonly<{
    events: readonly ProgressJourneyEventView[];
    preferences: ReturnType<typeof toProgressJourneyPreferenceView>;
  }>;
  records: Readonly<Record<ManualSection, readonly ManualRecordView[]>>;
  schemaVersion: 9;
  transactionIntelligence: Readonly<{
    reviewEvidence: readonly TransactionIntelligenceReviewView[];
    runs: readonly TransactionIntelligenceRunView[];
  }>;
}>;

export type FinancialDataExportDependencies = Readonly<{
  budgetRepository?: BudgetRepository;
  debtStrategyRepository?: DebtStrategyRepository;
  goalRepository?: GoalRepository;
  netWorthRepository?: NetWorthRepository;
  notificationRepository?: NotificationRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  purchaseSimulationRepository?: PurchaseSimulationRepository;
  progressJourneyRepository?: ProgressJourneyRepository;
  repositories?: Readonly<Partial<Record<ManualSection, ManualRecordRepository>>>;
  transactionIntelligenceRepository?: TransactionIntelligenceRepository;
}>;

export async function buildFinancialDataExport(
  actor: Actor,
  dependencies?: FinancialDataExportDependencies,
): Promise<FinancialDataExport> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  const entries = await Promise.all(
    manualSectionSchema.options.map(async (section) => {
      const repository =
        dependencies?.repositories?.[section] ??
        (await getManualRecordRepository(section));
      const records = await repository.listAllForActor(actor);

      return [section, records.map(toManualRecordView)] as const;
    }),
  );
  const budgetRepository =
    dependencies?.budgetRepository ?? (await getBudgetRepository());
  const [categories, periods, corrections] = await Promise.all([
    budgetRepository.listCategoriesForActor(actor),
    budgetRepository.listPeriodsForActor(actor),
    budgetRepository.listAllCorrectionsForActor(actor),
  ]);
  const goalRepository =
    dependencies?.goalRepository ?? (await getGoalRepository());
  const [goalDefinitions, goalProgress] = await Promise.all([
    goalRepository.listAllDefinitionsForActor(actor),
    goalRepository.listAllProgressForActor(actor),
  ]);
  const purchaseSimulationRepository =
    dependencies?.purchaseSimulationRepository ??
    (await getPurchaseSimulationRepository());
  const purchaseSimulations =
    await purchaseSimulationRepository.listAllForActor(actor);
  const netWorthRepository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  const [netWorthItems, netWorthSnapshots] = await Promise.all([
    netWorthRepository.listItemsForActor(actor),
    netWorthRepository.listAllSnapshotsForActor(actor),
  ]);
  const debtStrategyRepository = dependencies?.debtStrategyRepository ?? await getDebtStrategyRepository();
  const debtStrategies = await debtStrategyRepository.listAllForActor(actor);
  const notificationRepository = dependencies?.notificationRepository ?? await getNotificationRepository();
  const [notifications, notificationPreferences] = await Promise.all([
    notificationRepository.listForActor(actor, 5_000),
    notificationRepository.findPreferencesForActor(actor),
  ]);
  const transactionIntelligenceRepository =
    dependencies?.transactionIntelligenceRepository ??
    (await getTransactionIntelligenceRepository());
  const [intelligenceRuns, intelligenceReviews] = await Promise.all([
    transactionIntelligenceRepository.listAllRunsForActor(actor),
    transactionIntelligenceRepository.listAllReviewsForActor(actor),
  ]);
  const reviewsByRun = new Map(
    intelligenceRuns.map((run) => [
      run.id,
      intelligenceReviews.filter((review) => review.runId === run.id),
    ]),
  );
  const progressRepository = dependencies?.progressJourneyRepository ?? (dependencies === undefined ? await getProgressJourneyRepository() : null);
  const [progressEvents, progressPreferences] = progressRepository === null ? [[], null] as const : await Promise.all([
    progressRepository.listEventsForActor(actor),
    progressRepository.findPreferencesForActor(actor),
  ]);

  return {
    budgets: {
      categories,
      corrections: corrections.map((correction) => ({
        ...correction,
        at: correction.at.toISOString(),
      })),
      periods: periods.map((period) => ({
        allocations: period.allocations.map(toBudgetAllocationView),
        calendarMonth: period.calendarMonth,
        carryIn: period.carryIn.map(toBudgetAllocationView),
        closedAt: period.closedAt?.toISOString() ?? null,
        closingSnapshot:
          period.closingSnapshot === null
            ? null
            : toBudgetCalculationView(period.closingSnapshot),
        currency: period.currency,
        id: period.id,
        status: period.status,
        version: period.version,
      })),
    },
    generatedAt: (dependencies?.now?.() ?? new Date()).toISOString(),
    debtStrategies: debtStrategies.map(toSavedDebtStrategyView),
    goalEngine: {
      definitions: goalDefinitions.map(toGoalDefinitionView),
      progressEvidence: goalProgress.map(toGoalProgressEvidenceView),
    },
    netWorth: {
      items: netWorthItems.map(toNetWorthItemView),
      snapshots: netWorthSnapshots.map(toNetWorthSnapshotView),
    },
    notifications: {
      items: notifications.map(toNotificationView),
      preferences: toNotificationPreferenceView(notificationPreferences),
    },
    profile: profile === null ? null : toUserProfileView(profile),
    purchaseSimulations: purchaseSimulations.map(
      toSavedPurchaseSimulationView,
    ),
    progressJourney: {
      events: progressEvents.map(toProgressJourneyEventView),
      preferences: toProgressJourneyPreferenceView(progressPreferences),
    },
    records: Object.fromEntries(entries) as unknown as Readonly<
      Record<ManualSection, readonly ManualRecordView[]>
    >,
    schemaVersion: 9,
    transactionIntelligence: {
      reviewEvidence: intelligenceReviews.map(
        toTransactionIntelligenceReviewView,
      ),
      runs: intelligenceRuns.map((run) =>
        toTransactionIntelligenceRunView(
          run,
          reviewsByRun.get(run.id) ?? [],
        ),
      ),
    },
  };
}
