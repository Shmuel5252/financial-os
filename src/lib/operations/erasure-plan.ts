import { recoveryCollections } from "@/lib/operations/recovery-plan";

/** Approved policy inventory; execution still requires durable fencing and schema-complete workflow. */
export function erasurePlan() {
  return recoveryCollections.map(collection => ({ collection,
    ordinaryDisposition: ["authorizedSearchDocuments", "rateLimits"].includes(collection) ? "delete-and-rebuild-survivors"
      : ["authSessions", "authVerificationTokens", "bankDevelopmentMigrationLocks"].includes(collection) ? "revoke-and-delete"
      : collection.startsWith("household") ? "detach-revoke-and-delete-subject-fields"
      : "delete-subject-personal-data",
    sharedConsequence: collection.startsWith("household") || ["financialReports", "financialSnapshots", "forecastSnapshots", "netWorthSnapshots"].includes(collection) ? "redact-subject-preserve-independent-owners" : "preserve-other-owners",
    retention: "no-indefinite-audit-exception",
    release: "implementation-verification-required",
    execute: false,
  }));
}
