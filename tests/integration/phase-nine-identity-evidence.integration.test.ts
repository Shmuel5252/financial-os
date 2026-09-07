import { createHash, createHmac } from "node:crypto";

import { BSON, MongoClient } from "mongodb";
import { describe, expect, it } from "vitest";

import { FinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import { parseJsonPreservingNumbers } from "@/lib/adapters/financy/financy-json";
import { getServerEnv, requireDatabaseEnv, requireOpenFinanceEnv } from "@/lib/config/server-env";
import { ReconciliationRequiredError } from "@/lib/errors/application-error";
import { OPEN_BANKING_MAX_PAGES, OPEN_BANKING_PROVIDER } from "@/lib/open-banking/open-banking";
import type { OpenBankingAccountObservation } from "@/lib/open-banking/open-banking-provider";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import { AccountReconciliationRepository } from "@/lib/open-banking/account-reconciliation-repository";
import { loadAccountReconciliation } from "@/lib/open-banking/account-reconciliation-service";

// A diagnostic, NOT reconnect acceptance. Uses the existing owner-scoped staged
// database and actual provider; no writes, paid refresh, disconnect, or billing.
// Only fixed field names/counts/booleans may be emitted. Never print source rows,
// hashes, identifiers, money, request headers, credentials, or provider payloads.
const operational = process.env.RUN_REAL_OPEN_FINANCE_IDENTITY_EVIDENCE_TESTS === "1"
  ? describe : describe.skip;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function identityPresence(value: unknown) {
  const item = record(value);
  const parsed = record(item.parsedAccount);
  return {
    accountNumber: present(item.accountNumber),
    parsedBank: present(parsed.bank),
    parsedBranch: present(parsed.branch),
    parsedNumber: present(parsed.number),
  };
}

function summarizePresence(items: readonly unknown[]) {
  const rows = items.map(identityPresence);
  return {
    recordCount: rows.length,
    accountNumber: rows.filter((row) => row.accountNumber).length,
    parsedBank: rows.filter((row) => row.parsedBank).length,
    parsedBranch: rows.filter((row) => row.parsedBranch).length,
    parsedNumber: rows.filter((row) => row.parsedNumber).length,
  };
}

// Match the existing historical display minimization, not raw account numbers.
// These weak-label counts are diagnostic only and never authorize reconciliation.
function label(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\d{5,}/g, "••••")
    .replace(/\s+/g, " ").trim().slice(0, 120).toLowerCase() : "";
}

operational("Phase 9 real identity-evidence sufficiency inventory (read-only diagnostic)", () => {
  it("inventories actual current and retained fields without authorizing a financial mapping", async () => {
    const configuration = requireDatabaseEnv();
    const secret = getServerEnv().AUTH_SECRET;
    if (secret === undefined) throw new Error("Authentication configuration unavailable.");
    const alias = (kind: string, external: string) => createHmac("sha256", secret)
      .update(`${OPEN_BANKING_PROVIDER}:${kind}:${external}`, "utf8").digest("hex");
    const client = new MongoClient(configuration.uri, { promoteLongs: false, monitorCommands: true });
    let unexpectedDatabaseCommand = false;
    client.on("commandStarted", (event) => {
      if (!["find", "getMore", "killCursors", "endSessions"].includes(event.commandName)) {
        unexpectedDatabaseCommand = true;
      }
    });
    try {
      await client.connect();
      const database = client.db(configuration.databaseName);
      const binding = await database.collection("bankProviderBindings").findOne({
        provider: OPEN_BANKING_PROVIDER,
        subjectAlias: alias("subject", requireOpenFinanceEnv().userId),
      });
      expect(binding !== null, "Existing owner binding must be present").toBe(true);
      if (binding === null) return;
      const owner = { userId: binding.userId };
      const checkpoint = async () => {
        const digest = createHash("sha256");
        for (const name of ["accounts", "transactions", "bankRecordRevisions", "bankConnections",
          "bankProviderBindings", "bankSyncRuns", "bankLifecycleCommands", "bankAccountReconciliations"]) {
          digest.update(name);
          for await (const row of database.collection(name).find(owner).sort({ _id: 1 })) {
            digest.update(BSON.EJSON.stringify(row, { relaxed: false }));
          }
        }
        return digest.digest("hex");
      };
      const before = await checkpoint();
      const historicalConnections = await database.collection("bankConnections").find(owner)
        .project({ connectionAlias: 1, providerAlias: 1 }).toArray();
      const canonicalAccounts = await database.collection("accounts").find({
        ...owner, "source.kind": "open_banking", "source.provider": OPEN_BANKING_PROVIDER,
      }).project({ source: 1 }).toArray();
      const revisions = await database.collection("bankRecordRevisions").find({
        ...owner, provider: OPEN_BANKING_PROVIDER, recordKind: "account",
      }).project({ recordAlias: 1, connectionAlias: 1, account: 1 }).sort({ sequence: -1 }).toArray();
      const latest = [...new Map([...revisions].reverse().map((row) => [row.recordAlias, row])).values()];
      const historicalCanonical = canonicalAccounts.map((row) =>
        latest.find((prior) => prior.recordAlias === record(row.source).recordAlias));
      expect(historicalCanonical.every((row) => row !== undefined), "Canonical account observation evidence retained").toBe(true);

      const currentIdentity: unknown[] = [];
      let detailReads = 0;
      const provider = new FinancyOpenBankingProvider(async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (url.origin !== "https://api.open-finance.ai" || !(
          (url.pathname === "/oauth/token" && method === "POST") ||
          (["/v2/connections", "/v2/data/accounts"].includes(url.pathname) && method === "GET")
        )) throw new Error("Read-only diagnostic transport rejected an operation.");
        const response = await fetch(url, { ...init, redirect: "error" });
        if (response.ok && url.pathname === "/v2/data/accounts") {
          const envelope = record(parseJsonPreservingNumbers(await response.clone().text()));
          if (!Array.isArray(envelope.items)) throw new Error("Account inventory envelope unavailable.");
          for (const value of envelope.items) {
            const item = record(value);
            const identity = identityPresence(item);
            // The official detail endpoint may expose fields absent from list.
            // Reuse the adapter request's ephemeral authorization only for that
            // same provider origin. Neither headers nor raw details are retained.
            if (!identity.accountNumber && !identity.parsedNumber && typeof item.id === "string") {
              const detail = await fetch(`https://api.open-finance.ai/v2/data/accounts/${encodeURIComponent(item.id)}`, {
                ...init, method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
              });
              detailReads += 1;
              if (!detail.ok) throw new Error("Documented account detail inventory unavailable.");
              const body = record(parseJsonPreservingNumbers(await detail.text()));
              if (body.id !== item.id || body.connectionId !== item.connectionId) {
                throw new Error("Account detail identity did not match its requested list record.");
              }
              // Store presence booleans only; not the actual raw number/reference.
              currentIdentity.push(identityPresence(body));
            } else currentIdentity.push(identity);
          }
        }
        return response;
      });
      const connections = await provider.listConnections();
      expect(connections.every((row) => row.subjectExternalId === requireOpenFinanceEnv().userId),
        "Real provider subject must match existing owner binding").toBe(true);
      expect(connections.some((row) => ["ACTIVE", "CONNECTED", "COMPLETED"].includes(row.status)),
        "Real reconnected consent must be readable").toBe(true);
      const accounts: OpenBankingAccountObservation[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < OPEN_BANKING_MAX_PAGES; index += 1) {
        const page = await provider.listAccountsPage(cursor);
        accounts.push(...page.items);
        if (page.nextCursor === null) { cursor = undefined; break; }
        cursor = page.nextCursor;
      }
      expect(cursor === undefined, "All account inventory pages read").toBe(true);
      const currentFieldInventory = [...currentIdentity];
      const review = await loadAccountReconciliation({ kind: "user", userId: binding.userId.toHexString() }, {
        bankingRepository: openBankingRepositoryForDatabase(database),
        repository: new AccountReconciliationRepository(database), provider,
      });
      expect(review.rows.length > 0, "Real legacy accounts are available for owner review").toBe(true);
      expect(review.rows.every((row) => row.status !== "confirmed"), "The agent has not confirmed real account identities").toBe(true);
      const publicReview = JSON.stringify(review);
      expect(publicReview.includes("referenceDigest") || publicReview.includes(binding.userId.toHexString()), "Private identities must not reach the public view").toBe(false);
      const weakMatches = accounts.map((account) => historicalCanonical.filter((prior) => {
        if (prior === undefined) return false;
        const data = record(prior.account);
        const institution = historicalConnections.find((row) => row.connectionAlias === prior.connectionAlias)?.providerAlias;
        return institution === alias("institution", account.providerExternalId) &&
          data.accountType === account.accountType && data.currency === account.currency &&
          label(data.displayName) === label(account.displayName);
      }).length);
      let guardBlocked = false;
      try {
        await openBankingRepositoryForDatabase(database).assertConnectionContinuity(
          { kind: "user", userId: binding.userId.toHexString() },
          connections.map((row) => ({
            connectionAlias: alias("connection", row.externalId),
            providerAlias: alias("institution", row.providerExternalId), status: row.status,
          })),
        );
      } catch (error) {
        if (!(error instanceof ReconciliationRequiredError)) throw error;
        guardBlocked = true;
      }
      const stateUnchanged = before === await checkpoint();
      console.info("Real identity inventory (diagnostic only; NOT reconciliation acceptance)", {
        ownerBindingAndProviderSubjectVerified: true,
        historicalCanonicalAccountCount: canonicalAccounts.length,
        historicalAccountEvidence: summarizePresence(latest.map((row) => row.account)),
        historicalCanonicalAccountEvidence: summarizePresence(historicalCanonical.map((row) => row?.account)),
        currentProviderAccountCount: accounts.length,
        currentDocumentedFieldPresence: {
          accountNumber: currentFieldInventory.filter((row) => record(row).accountNumber === true).length,
          parsedBank: currentFieldInventory.filter((row) => record(row).parsedBank === true).length,
          parsedBranch: currentFieldInventory.filter((row) => record(row).parsedBranch === true).length,
          parsedNumber: currentFieldInventory.filter((row) => record(row).parsedNumber === true).length,
        },
        manualReview: {
          unresolvedLegacyAccounts: review.rows.length,
          candidateCounts: review.rows.map((row) => row.candidates.length),
          maskedNumbersAvailable: review.rows.every((row) => row.candidates.every((candidate) => candidate.comparison.maskedNumber !== null)),
          noOwnerConfirmationPerformed: review.rows.every((row) => row.status !== "confirmed"),
          transactionGatePending: review.transactionGate === "pending",
        },
        detailReads,
        weakLabelCandidateCountsNotIdentityProof: {
          none: weakMatches.filter((count) => count === 0).length,
          one: weakMatches.filter((count) => count === 1).length,
          multiple: weakMatches.filter((count) => count > 1).length,
        },
        guardBlocked, stateUnchanged,
        onlyReadDatabaseCommandsObserved: !unexpectedDatabaseCommand,
        canonicalMappingAuthorizedByDiagnostic: false,
      });
      expect(stateUnchanged, "All retained owner financial/provider checkpoints must remain unchanged").toBe(true);
      expect(unexpectedDatabaseCommand, "Only read database commands permitted").toBe(false);
    } finally {
      await client.close();
    }
  }, 180_000);
});
