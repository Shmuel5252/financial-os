import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { BSON, MongoClient, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { FinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import { requireDatabaseEnv, requireOpenFinanceEnv } from "@/lib/config/server-env";
import { bankAlias } from "@/lib/open-banking/account-identity";
import { planDevelopmentBaseline, retireDevelopmentBaseline, verifyProtectedBaseline } from "@/lib/open-banking/development-baseline";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import { synchronizeOpenBanking } from "@/lib/open-banking/open-banking-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";

// Separate explicit operational command, excluded from routine regression.
// Default path is READ ONLY. Mutation requires the dated approval flag below.
const enabled = process.env.RUN_PHASE9_DEVELOPMENT_BASELINE_PREFLIGHT === "1";
const approved = process.env.RUN_APPROVED_PHASE9_DEVELOPMENT_BASELINE === "owner-approved-development-reset-2026-09-06";
const operational = enabled ? describe : describe.skip;
const notListening = (host: string) => new Promise<boolean>((resolve) => {
  const socket = createConnection({ host, port: 3001 });
  socket.once("connect", () => { socket.destroy(); resolve(false); });
  socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); resolve(error.code === "ECONNREFUSED"); });
  socket.setTimeout(1_000, () => { socket.destroy(); resolve(false); });
});

operational("Phase 9 approved development baseline operation", () => {
  it("proves exact scope and, only with explicit approval, archives and imports the real active connection twice", async () => {
    const config = requireDatabaseEnv();
    expect(process.env.AUTH_URL === "http://localhost:3001", "Local application only").toBe(true);
    const databaseUrl = new URL(config.uri);
    expect(databaseUrl.protocol === "mongodb:" && ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname), "Loopback MongoDB only").toBe(true);
    const client = new MongoClient(config.uri, { promoteLongs: false });
    try {
      await client.connect();
      const database = client.db(config.databaseName);
      // Fail closed to an allowlist: this operation can never refresh, revoke,
      // initiate payment, or change subscription/billing, even by accident.
      const provider = new FinancyOpenBankingProvider(async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const allowed = url.origin === "https://api.open-finance.ai" && (
          (method === "POST" && url.pathname === "/oauth/token") ||
          (method === "GET" && ["/v2/connections", "/v2/data/accounts", "/v2/data/transactions"].includes(url.pathname))
        );
        if (!allowed) throw new Error("Forbidden operational provider action.");
        const response = await fetch(url, init);
        if (url.pathname === "/v2/connections" && response.ok) {
          const envelope = await response.clone().json() as { nextPage?: unknown };
          if (envelope.nextPage) throw new Error("Uninspected provider connection page.");
        }
        return response;
      });
      const connections = await provider.listConnections();
      const activeConnections = connections.filter((item) => item.status === "ACTIVE");
      expect(activeConnections.length === 1, "Exactly one current ACTIVE connection").toBe(true);
      expect(connections.every((item) => item.subjectExternalId === requireOpenFinanceEnv().userId), "Configured provider subject").toBe(true);
      const active = activeConnections[0]!;
      const subjectAlias = bankAlias("subject", requireOpenFinanceEnv().userId);
      const binding = await database.collection("bankProviderBindings").findOne({ provider: "financy", subjectAlias });
      expect(binding?.userId instanceof ObjectId, "Existing owner binding").toBe(true);
      const plan = await planDevelopmentBaseline(database, { owner: binding!.userId, subjectAlias, activeConnectionAlias: bankAlias("connection", active.externalId) });
      const counts = Object.fromEntries(["accounts", "transactions", "bankConnections", "bankRecordRevisions"].map((name) => [name, plan.targets.filter((item) => item.collection === name).length]));
      expect(counts, "Exact owner-approved legacy test scope").toEqual({ accounts: 5, transactions: 460, bankConnections: 1, bankRecordRevisions: 1187 });
      const products = [];
      let cursor: string | undefined;
      do {
        const page = await provider.listAccountsPage(cursor);
        products.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (products.length > 100) throw new Error("Unexpected product inventory.");
      } while (cursor !== undefined);
      expect(products.length > 0 && products.every((item) => item.connectionExternalId === active.externalId && item.providerExternalId === active.providerExternalId), "All products belong to active scope").toBe(true);
      expect(new Set(products.map((item) => item.externalId)).size).toBe(products.length);
      console.info("Development baseline safe inventory", {
        legacyCounts: counts, protectedRecords: plan.protectedRecords.length, activeConnections: 1,
        products: products.map((item) => ({ type: item.accountType, currency: item.currency, balanceCount: item.balances.length, stableIdentityPresent: item.identity?.referenceDigest != null })),
        writesApproved: approved,
      });
      if (!approved) return;
      expect(await notListening("127.0.0.1") && await notListening("::1"), "Port 3001 writer must be stopped; never touch port 3000").toBe(true);
      await retireDevelopmentBaseline(database, plan, "owner-approved-development-reset-2026-09-06");
      await verifyProtectedBaseline(database, plan);
      const actor = { kind: "user" as const, userId: plan.userId.toHexString() };
      const repository = openBankingRepositoryForDatabase(database);
      const profileRepository = profileRepositoryForDatabase(database);
      await repository.ensureIndexes();
      const first = await synchronizeOpenBanking(actor, randomUUID(), { provider, repository, profileRepository });
      expect(first.status).toBe("completed");
      expect(first.accountObservationCount).toBe(products.length);
      const financialDigest = async () => {
        const records = await Promise.all(["accounts", "transactions", "bankRecordRevisions"].map(async (name) => [name, await database.collection(name).find({ userId: plan.userId }, { promoteLongs: false, promoteValues: false }).sort({ _id: 1 }).toArray()]));
        return createHash("sha256").update(BSON.serialize({ records })).digest("hex");
      };
      const beforeRepeat = await financialDigest();
      const second = await synchronizeOpenBanking(actor, randomUUID(), { provider, repository, profileRepository });
      expect(second.status).toBe("completed");
      expect(second.canonicalAccountCount === 0 && second.canonicalTransactionCount === 0).toBe(true);
      expect(await financialDigest() === beforeRepeat, "Repeated sync preserves canonical and observation BSON").toBe(true);
      await verifyProtectedBaseline(database, plan, true);
      const canonicalAccounts = await database.collection("accounts").countDocuments({ userId: plan.userId, "source.connectionAlias": plan.activeConnectionAlias });
      const canonicalTransactions = await database.collection("transactions").countDocuments({ userId: plan.userId, "source.connectionAlias": plan.activeConnectionAlias });
      const observations = await database.collection("bankRecordRevisions").countDocuments({ userId: plan.userId, connectionAlias: plan.activeConnectionAlias });
      console.info("Development baseline verified cutover", {
        archivedDocuments: plan.targets.length, protectedDocumentsUnchanged: plan.protectedRecords.length,
        providerProducts: first.accountObservationCount, providerTransactions: first.transactionObservationCount,
        canonicalAccounts, canonicalTransactions, observations, repeatAccountChanges: second.canonicalAccountCount,
        repeatTransactionChanges: second.canonicalTransactionCount, exactRepeatDigestEqual: true,
        paidRefreshInvoked: false, providerDeletionInvoked: false,
      });
    } finally { await client.close(); }
  }, 180_000);
});
