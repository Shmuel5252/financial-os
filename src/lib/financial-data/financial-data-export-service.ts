import "server-only";

import type { Actor } from "@/lib/auth/actor";
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
  toSavedPurchaseSimulationView,
  type SavedPurchaseSimulationView,
} from "@/lib/purchase-simulations/purchase-simulation";
import {
  getPurchaseSimulationRepository,
  type PurchaseSimulationRepository,
} from "@/lib/purchase-simulations/purchase-simulation-repository";

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
  goalEngine: Readonly<{
    definitions: readonly GoalDefinitionView[];
    progressEvidence: readonly GoalProgressEvidenceView[];
  }>;
  profile: UserProfileView | null;
  purchaseSimulations: readonly SavedPurchaseSimulationView[];
  records: Readonly<Record<ManualSection, readonly ManualRecordView[]>>;
  schemaVersion: 4;
}>;

export type FinancialDataExportDependencies = Readonly<{
  budgetRepository?: BudgetRepository;
  goalRepository?: GoalRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  purchaseSimulationRepository?: PurchaseSimulationRepository;
  repositories?: Readonly<Partial<Record<ManualSection, ManualRecordRepository>>>;
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
    goalEngine: {
      definitions: goalDefinitions.map(toGoalDefinitionView),
      progressEvidence: goalProgress.map(toGoalProgressEvidenceView),
    },
    profile: profile === null ? null : toUserProfileView(profile),
    purchaseSimulations: purchaseSimulations.map(
      toSavedPurchaseSimulationView,
    ),
    records: Object.fromEntries(entries) as unknown as Readonly<
      Record<ManualSection, readonly ManualRecordView[]>
    >,
    schemaVersion: 4,
  };
}
