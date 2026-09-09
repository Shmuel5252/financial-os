import "server-only";

import type { Db } from "mongodb";
import { getConfigurationStatus, parseServerEnv } from "@/lib/config/server-env";

export const stagingBindingContract = {
  database: "financial_os_staging",
  origin: "https://financial-os-staging-nine.vercel.app",
} as const;

type Match = "match" | "mismatch" | "unknown";
export type BindingEvidence = Readonly<{
  policy: "staging-binding-v1";
  classification: Match;
  configuredDatabase: Match;
  connectedNamespace: Match;
  authOrigin: Match;
  requiredConfiguration: "present" | "incomplete" | "unknown";
  clusterIdentity: "unknown";
  credentialIdentity: "unknown";
}>;

/** Fixed contract only: never echo an environment value, URI or driver error. */
export async function inspectStagingBinding(
  input: Record<string, unknown>,
  database: () => Promise<Db>,
): Promise<BindingEvidence> {
  const result: BindingEvidence = {
    policy: "staging-binding-v1",
    classification: input.FINANCIAL_OS_ENVIRONMENT === undefined || input.FINANCIAL_OS_ENVIRONMENT === ""
      ? "unknown" : input.FINANCIAL_OS_ENVIRONMENT === "staging" ? "match" : "mismatch",
    configuredDatabase: "unknown", connectedNamespace: "unknown", authOrigin: "unknown",
    requiredConfiguration: "unknown", clusterIdentity: "unknown", credentialIdentity: "unknown",
  };
  try {
    const env = parseServerEnv(input);
    const configuredDatabase: Match = env.MONGODB_DB_NAME === undefined ? "unknown"
      : env.MONGODB_DB_NAME === stagingBindingContract.database ? "match" : "mismatch";
    const evidence: BindingEvidence = {
      ...result, configuredDatabase,
      authOrigin: env.AUTH_URL === undefined ? "unknown" : env.AUTH_URL === stagingBindingContract.origin ? "match" : "mismatch",
      requiredConfiguration: getConfigurationStatus(env).authentication.ready ? "present" : "incomplete",
    };
    // Do not inspect an unintended or unclassified environment's database.
    if (result.classification !== "match" || configuredDatabase !== "match") return evidence;
    try {
      const db = await database();
      if (db.databaseName !== stagingBindingContract.database) return { ...evidence, connectedNamespace: "mismatch" };
      // ping alone succeeds against nonexistent namespaces. Inspect schema metadata,
      // not documents, to distinguish a connected populated namespace from a typo.
      const collections = await db.listCollections({ name: "authUsers" }, { nameOnly: true, timeoutMS: 3_000 }).toArray();
      return { ...evidence, connectedNamespace: collections.some(({ name }) => name === "authUsers") ? "match" : "unknown" };
    } catch { return evidence; }
  } catch { return result; }
}
