import { createHmac } from "node:crypto";

import { MongoClient } from "mongodb";
import { describe, expect, it } from "vitest";

import { FinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import { requireDatabaseEnv, requireOpenFinanceEnv, getServerEnv } from "@/lib/config/server-env";
import { OPEN_BANKING_MAX_PAGES, OPEN_BANKING_PROVIDER } from "@/lib/open-banking/open-banking";
import { ReconciliationRequiredError } from "@/lib/errors/application-error";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";

// Explicit operational gate: reads the existing staged database but NEVER writes
// to it, deletes data, invokes paid refresh, or changes provider consent.
const operational = process.env.RUN_REAL_OPEN_FINANCE_RECONNECTION_TESTS === "1"
  ? describe : describe.skip;

operational("Phase 9 real post-reconnection identity preflight (read-only)", () => {
  it("retains known account and transaction identities before any canonical synchronization", async () => {
    const configuration = requireDatabaseEnv();
    const secret = getServerEnv().AUTH_SECRET;
    if (secret === undefined) throw new Error("Authentication configuration unavailable.");
    const alias = (kind: string, external: string) => createHmac("sha256", secret)
      .update(`${OPEN_BANKING_PROVIDER}:${kind}:${external}`, "utf8").digest("hex");
    const client = new MongoClient(configuration.uri, { promoteLongs: false });
    try {
      await client.connect();
      const database = client.db(configuration.databaseName);
      const binding = await database.collection("bankProviderBindings").findOne({
        provider: OPEN_BANKING_PROVIDER,
        subjectAlias: alias("subject", requireOpenFinanceEnv().userId),
      });
      expect(binding !== null, "Existing owner binding is required").toBe(true);
      if (binding === null) return;
      let additionalConnectionPage = false;
      let diagnosticConnectionFilter: string | null = null;
      const provider = new FinancyOpenBankingProvider(async (input, init) => {
        const url = new URL(String(input));
        // Only used after the ordinary current-data read, to determine whether
        // the provider still exposes legacy records through documented filters.
        if (diagnosticConnectionFilter !== null && url.pathname.startsWith("/v2/data/")) {
          url.searchParams.set("connectionId", diagnosticConnectionFilter);
          url.searchParams.set("includeDuplicates", "1");
        }
        const response = await fetch(url, init);
        if (new URL(String(input)).pathname === "/v2/connections" && response.ok) {
          const envelope: unknown = await response.clone().json();
          additionalConnectionPage = typeof envelope === "object" && envelope !== null &&
            "nextPage" in envelope && typeof envelope.nextPage === "string" && envelope.nextPage.length > 0;
        }
        return response;
      });
      const connections = await provider.listConnections();
      const historicalConnections = await database.collection("bankConnections").find({
        userId: binding.userId, provider: OPEN_BANKING_PROVIDER,
      }).project({ connectionAlias: 1, providerAlias: 1 }).toArray();
      const configuredSubject = requireOpenFinanceEnv().userId;
      const subjectScopeMatches = connections.every((item) => item.subjectExternalId === configuredSubject);
      expect(subjectScopeMatches, "Provider explicitly reports the configured subject for all connections").toBe(true);
      const activeConnections = connections.filter((item) => ["CONNECTED", "ACTIVE", "COMPLETED"].includes(item.status));
      const knownStatuses = new Set([
        "CONNECTED", "ACTIVE", "COMPLETED", "FETCHING", "INACTIVE", "PARTIALLY_AUTHORIZED",
        "REPLACED", "EXPIRED", "REVOKED", "TERMINATED_BY_USER", "SUSPENDED_BY_PROVIDER",
        "REJECTED", "CREDENTIALS_ERROR", "FETCHING_ERROR", "ERROR", "UNKNOWN",
      ]);
      console.info("Reconnection provider status preflight", {
        connectionCount: connections.length,
        additionalConnectionPage,
        existingOwnerBindingFound: true,
        subjectScopeMatches,
        readableConnectionSharesHistoricalInstitution: activeConnections.some((item) =>
          historicalConnections.some((prior) => prior.providerAlias === alias("institution", item.providerExternalId))),
        statuses: connections.map((item) => knownStatuses.has(item.status) ? item.status : "OTHER"),
        accountPageCount: (await provider.listAccountsPage()).items.length,
        transactionPageCount: (await provider.listTransactionsPage()).items.length,
      });
      expect(additionalConnectionPage, "No hidden connection page in this staged preflight").toBe(false);
      expect(connections.some((item) => ["CONNECTED", "ACTIVE", "COMPLETED"].includes(item.status)), "Real provider connection readable").toBe(true);
      const beforeAccounts = await database.collection("accounts").distinct("source.recordAlias", {
        userId: binding.userId, "source.kind": "open_banking",
      });
      const beforeTransactions = await database.collection("transactions").distinct("source.recordAlias", {
        userId: binding.userId, "source.kind": "open_banking",
      });
      const currentAccounts = new Set<string>();
      const currentTransactions = new Set<string>();
      let cursor: string | undefined;
      for (let index = 0; index < OPEN_BANKING_MAX_PAGES; index += 1) {
        const page = await provider.listAccountsPage(cursor);
        for (const item of page.items) currentAccounts.add(alias("account", item.externalId));
        if (page.nextCursor === null) { cursor = undefined; break; }
        cursor = page.nextCursor;
      }
      expect(cursor === undefined, "All account pages retrieved").toBe(true);
      for (let index = 0; index < OPEN_BANKING_MAX_PAGES; index += 1) {
        const page = await provider.listTransactionsPage(cursor);
        for (const item of page.items) currentTransactions.add(alias("transaction", item.stableExternalKey));
        if (page.nextCursor === null) { cursor = undefined; break; }
        cursor = page.nextCursor;
      }
      expect(cursor === undefined, "All transaction pages retrieved").toBe(true);
      const retainedAccounts = beforeAccounts.filter((item) => currentAccounts.has(item)).length;
      const retainedTransactions = beforeTransactions.filter((item) => currentTransactions.has(item)).length;
      // Counts only: no IDs, money, names, payloads, credentials, or tokens.
      console.info("Reconnection identity preflight", {
        previousCanonicalAccounts: beforeAccounts.length,
        currentProviderAccounts: currentAccounts.size,
        retainedAccountIdentities: retainedAccounts,
        previousCanonicalTransactions: beforeTransactions.length,
        currentProviderTransactions: currentTransactions.size,
        retainedTransactionIdentities: retainedTransactions,
      });
      if (retainedAccounts !== beforeAccounts.length || retainedTransactions !== beforeTransactions.length) {
        let continuityGuardBlocked = false;
        try {
          await openBankingRepositoryForDatabase(database).assertConnectionContinuity(
            { kind: "user", userId: binding.userId.toHexString() },
            connections.map((item) => ({
              connectionAlias: alias("connection", item.externalId),
              providerAlias: alias("institution", item.providerExternalId),
              status: item.status,
            })),
          );
        } catch (error) {
          if (!(error instanceof ReconciliationRequiredError)) throw error;
          continuityGuardBlocked = true;
        }
        console.info("Reconnection safety gate (read-only)", { continuityGuardBlocked });
        expect(continuityGuardBlocked, "Unmapped reconnection must be blocked by the server repository gate").toBe(true);
        const previous = connections.find((item) => item.status === "TERMINATED_BY_USER" &&
          historicalConnections.some((prior) => prior.connectionAlias === alias("connection", item.externalId)));
        if (previous !== undefined) {
          diagnosticConnectionFilter = previous.externalId;
          const legacyAccounts = await provider.listAccountsPage();
          const legacyTransactions = await provider.listTransactionsPage();
          console.info("Documented legacy-connection read (including duplicates)", {
            accountPageCount: legacyAccounts.items.length,
            transactionPageCount: legacyTransactions.items.length,
            moreAccountPages: legacyAccounts.nextCursor !== null,
            moreTransactionPages: legacyTransactions.nextCursor !== null,
          });
        }
      }
      expect(beforeAccounts.length > 0 && beforeTransactions.length > 0, "Historical checkpoint exists").toBe(true);
      expect(retainedAccounts, "Known canonical accounts survive reconnection without duplicate truth").toBe(beforeAccounts.length);
      expect(retainedTransactions, "Known canonical transactions survive reconnection without duplicate truth").toBe(beforeTransactions.length);
    } finally {
      await client.close();
    }
  }, 180_000);
});
