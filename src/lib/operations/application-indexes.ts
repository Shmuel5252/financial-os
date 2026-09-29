/** Every application index, created through the owning repositories (no duplicated definitions), for a fresh restore
 * target before any insert: duplicates then fail instead of silently landing (PHASE_18_OFFLINE_PREPARATION.md step 1).
 */
import "server-only";
import type { Db } from "mongodb";
import { aiConversationRepositoryForDatabase } from "@/lib/ai/ai-conversation-repository";
import { budgetRepositoryForDatabase } from "@/lib/budgets/budget-repository";
import { debtStrategyRepositoryForDatabase } from "@/lib/debt-strategies/debt-strategy-repository";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { forecastRepositoryForDatabase } from "@/lib/forecasts/forecast-repository";
import { goalRepositoryForDatabase } from "@/lib/goals/goal-repository";
import { householdRepositoryForDatabase } from "@/lib/households/household-repository";
import { netWorthRepositoryForDatabase } from "@/lib/net-worth/net-worth-repository";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import { manualSectionSchema } from "@/lib/onboarding/manual-record";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { AccountReconciliationRepository } from "@/lib/open-banking/account-reconciliation-repository";
import { ensureDevelopmentBaselineIndexes } from "@/lib/open-banking/development-baseline";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { progressJourneyRepositoryForDatabase } from "@/lib/progress-journeys/progress-journey-repository";
import { purchaseSimulationRepositoryForDatabase } from "@/lib/purchase-simulations/purchase-simulation-repository";
import { financialReportRepositoryForDatabase } from "@/lib/reports/report-repository";
import { reportSummaryRepositoryForDatabase } from "@/lib/reports/report-summary-repository";
import { searchRepositoryForDatabase } from "@/lib/search/search-repository";
import { rateLimiterForDatabase } from "@/lib/security/rate-limiter";
import { transactionIntelligenceRepositoryForDatabase } from "@/lib/transaction-intelligence/transaction-intelligence-repository";

export async function ensureApplicationIndexes(database: Db): Promise<void> {
  const repositories = [aiConversationRepositoryForDatabase(database), budgetRepositoryForDatabase(database), debtStrategyRepositoryForDatabase(database),
    financialEngineSnapshotRepositoryForDatabase(database), financialSnapshotRepositoryForDatabase(database), forecastRepositoryForDatabase(database),
    goalRepositoryForDatabase(database), householdRepositoryForDatabase(database), netWorthRepositoryForDatabase(database),
    notificationRepositoryForDatabase(database), new AccountReconciliationRepository(database), openBankingRepositoryForDatabase(database),
    profileRepositoryForDatabase(database), progressJourneyRepositoryForDatabase(database), purchaseSimulationRepositoryForDatabase(database),
    financialReportRepositoryForDatabase(database), reportSummaryRepositoryForDatabase(database), searchRepositoryForDatabase(database),
    rateLimiterForDatabase(database), transactionIntelligenceRepositoryForDatabase(database),
    ...manualSectionSchema.options.map(section => manualRecordRepositoryForDatabase(database, section))];
  // Sequential: concurrent createIndexes on the same new collections can race on implicit collection creation.
  for (const repository of repositories) await repository.ensureIndexes();
  // Also creates the (excluded, empty) archive collection's index; the fence accepts excluded collections only when empty.
  await ensureDevelopmentBaselineIndexes(database);
}
