import { recoveryCollections } from "@/lib/operations/recovery-plan";

/** Non-executable policy review inventory; never performs deletion. */
export function erasurePlan() {
  return recoveryCollections.map(collection => ({ collection,
    ordinaryDisposition: ["authorizedSearchDocuments", "rateLimits"].includes(collection) ? "delete-and-rebuild-survivors"
      : ["authSessions", "authVerificationTokens", "bankDevelopmentMigrationLocks"].includes(collection) ? "revoke-and-delete"
      : collection.startsWith("household") ? "detach-revoke-and-delete-subject-fields"
      : "delete-subject-personal-data",
    sharedConsequence: collection.startsWith("household") || ["financialReports", "financialSnapshots", "forecastSnapshots", "netWorthSnapshots"].includes(collection) ? "shared-owner-and-evidence-policy-required" : "preserve-other-owners",
    retention: "no-indefinite-audit-exception",
    release: "owner-policy-pending",
    execute: false,
  }));
}
