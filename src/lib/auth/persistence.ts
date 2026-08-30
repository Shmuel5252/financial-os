import type { MongoDBAdapterOptions } from "@auth/mongodb-adapter";

export const financialOsAuthCollections = {
  Accounts: "authAccounts",
  Sessions: "authSessions",
  Users: "authUsers",
  VerificationTokens: "authVerificationTokens",
} as const;

export function financialOsMongoAdapterOptions(
  databaseName: string,
): MongoDBAdapterOptions {
  return {
    collections: financialOsAuthCollections,
    databaseName,
  };
}
