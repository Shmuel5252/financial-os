/** Offline planning only: no DB, filesystem, network, credentials or execution. */
import "server-only";
import { BSON, Long, ObjectId } from "mongodb";
import { createHash } from "node:crypto";

export const recoveryGroups = [
  ["authUsers", "authAccounts", "profiles"],
  ["households", "householdMemberships", "householdInvitations", "householdResourceShares"],
  ["accounts", "creditCards", "recurringExpenses", "goals", "incomeSources", "loans", "recurringTransactions", "safetyMargins", "savings", "transactions", "netWorthItems"],
  ["bankProviderBindings", "bankConnections", "bankAccountReconciliations", "bankRecordRevisions", "bankDevelopmentMigrations", "bankDevelopmentArchive", "bankSyncRuns", "bankLifecycleCommands"],
  ["budgetCategories", "budgetPeriods", "budgetCategoryCorrections", "financialSnapshots", "goalDefinitions", "goalProgress", "goalCommandReceipts", "purchaseSimulations", "forecastSnapshots", "forecastScenarios", "debtStrategyScenarios", "netWorthSnapshots", "transactionIntelligenceRuns", "transactionIntelligenceReviews", "financialReports", "reportAiSummaries", "aiConversations"],
  ["notifications", "notificationPreferences", "progressJourneyEvents", "progressJourneyPreferences"],
  ["authSessions", "authVerificationTokens", "bankDevelopmentMigrationLocks", "authorizedSearchDocuments", "rateLimits"],
] as const;
export const recoveryCollections: readonly string[] = recoveryGroups.flat();
const excluded = new Set(["authSessions", "authVerificationTokens", "bankDevelopmentMigrationLocks"]);
const rebuild = new Set(["authorizedSearchDocuments", "rateLimits"]);
const filtered = new Set(["authAccounts", "householdInvitations", "notifications", "bankSyncRuns", "bankLifecycleCommands", "bankDevelopmentArchive"]);

export function recoveryPlan(names: readonly string[]) {
  if (new Set(names).size !== names.length || names.some(name => !recoveryCollections.includes(name))) throw new Error("Unreviewed recovery inventory");
  return { version: "recovery-plan-v1", executable: false, releaseAllowed: false,
    collections: recoveryGroups.flatMap((group, order) => group.filter(name => names.includes(name)).map(name => ({ name, order,
      action: excluded.has(name) ? "exclude" : rebuild.has(name) ? "rebuild" : filtered.has(name) ? "filter-required" : "preserve-after-erasure-review" }))),
    barriers: ["consistent-recovery-point", "secret-free-schema-review", "current-deletion-revocation-ledger", "shared-erasure-policy", "indexes", "ownership-money-provenance", "fresh-auth", "operator-release"],
    replayProviders: false, replayEmails: false, replayJobs: false } as const;
}

/** Project only stable auth linkage; output never contains OAuth token fields. */
export function projectAuthLink(input: Record<string, unknown>) {
  const keys = ["_id", "userId", "provider", "providerAccountId", "type"] as const;
  const validId = (value: unknown) => value instanceof ObjectId || (typeof value === "string" && /^[a-f0-9]{24}$/.test(value));
  if (input.provider !== "google" || input.type !== "oauth" || typeof input.providerAccountId !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(input.providerAccountId) || !validId(input._id) || !validId(input.userId)) throw new Error("Invalid recovery linkage");
  return Object.fromEntries(keys.map(key => [key, input[key]]));
}

/** Integrity primitive for already-reviewed synthetic BSON, NOT a backup exporter.
 * Digest proves byte integrity, not authenticity, snapshot consistency or privacy.
 */
export function bsonIntegrity(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function validateBsonIntegrity(bytes: Uint8Array, digest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(digest) || bsonIntegrity(bytes) !== digest) return false;
  try { BSON.deserialize(bytes, { promoteLongs: false }); return true; } catch { return false; }
}
export function isExactMoney(value: unknown): value is Long { return Long.isLong(value); }
