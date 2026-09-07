import { randomUUID } from "node:crypto";

import { BSON, Long, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import type { Actor } from "@/lib/auth/actor";
import { buildFinancialEngineInput, type FinancialEngineSourceRecords } from "@/lib/financial-engine/financial-engine-input";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import { claimConfiguredOpenBankingSubject, synchronizeOpenBanking } from "@/lib/open-banking/open-banking-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const realEnabled = process.env.RUN_REAL_OPEN_FINANCE_TESTS === "1";
const testUri = process.env.MONGODB_TEST_URI;
const credentialsReady = [
  process.env.OPEN_FINANCE_USER_ID,
  process.env.OPEN_FINANCE_CLIENT_ID,
  process.env.OPEN_FINANCE_CLIENT_SECRET,
].every((value) => typeof value === "string" && value.length > 0);
const describeWithProvider = realEnabled && testUri !== undefined && credentialsReady ? describe : describe.skip;

describeWithProvider("Phase 9 real Financy paid-provider path", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const actor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const provider = new FinancyOpenBankingProvider();

  beforeAll(async () => client.connect());
  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("authenticates, traverses real pagination, and reconciles one exact isolated staged copy", async () => {
    const database = client.db(databaseName);
    const profileRepository = profileRepositoryForDatabase(database);
    const repository = openBankingRepositoryForDatabase(database);
    await Promise.all([profileRepository.ensureIndexes(), repository.ensureIndexes()]);
    await saveProfile(actor, {
      countryCode: "IL",
      displayName: "Provider acceptance actor",
      expectedVersion: null,
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
    }, { repository: profileRepository });

    const connections = await provider.listConnections();
    expect(connections.length > 0).toBe(true);
    expect(connections.some((connection) => connection.status === "ACTIVE" || connection.status === "COMPLETED")).toBe(true);
    expect(connections.some((connection) => connection.expiryDate !== null)).toBe(true);

    const accountPage = await provider.listAccountsPage();
    expect(accountPage.items.length > 0).toBe(true);
    const transactionPage = await provider.listTransactionsPage();
    expect(transactionPage.items.length > 0).toBe(true);

    await claimConfiguredOpenBankingSubject(actor, { profileRepository, provider, repository });
    const first = await synchronizeOpenBanking(actor, randomUUID(), { profileRepository, provider, repository });
    expect(first.status).toBe("completed");
    expect(first.connectionObservationCount > 0).toBe(true);
    expect(first.accountObservationCount > 0).toBe(true);
    expect(first.transactionObservationCount > 500).toBe(true);
    expect(first.canonicalAccountCount > 0).toBe(true);
    expect(first.canonicalTransactionCount > 0).toBe(true);

    const revisionsBefore = await database.collection("bankRecordRevisions").countDocuments();
    const canonicalAccountsBefore = await database.collection("accounts").countDocuments({ "source.kind": "open_banking" });
    const canonicalTransactionsBefore = await database.collection("transactions").countDocuments({ "source.kind": "open_banking" });
    const repeated = await synchronizeOpenBanking(actor, randomUUID(), { profileRepository, provider, repository });
    expect(repeated.status).toBe("completed");
    expect(repeated.canonicalAccountCount).toBe(0);
    expect(repeated.canonicalTransactionCount).toBe(0);
    expect(await database.collection("bankRecordRevisions").countDocuments()).toBe(revisionsBefore);
    expect(await database.collection("accounts").countDocuments({ "source.kind": "open_banking" })).toBe(canonicalAccountsBefore);
    expect(await database.collection("transactions").countDocuments({ "source.kind": "open_banking" })).toBe(canonicalTransactionsBefore);

    expect(await database.collection("bankRecordRevisions").countDocuments({ recordKind: "transaction", "transaction.status": "PENDING" }) > 0).toBe(true);
    expect(await database.collection("bankRecordRevisions").countDocuments({ recordKind: "transaction", "transaction.status": "BOOKED" }) > 0).toBe(true);
    const stored = await database.collection("transactions").findOne({ "source.kind": "open_banking" });
    expect((stored?.fields as { amount: { amountMinor: unknown } }).amount.amountMinor).toBeInstanceOf(Long);

    const allStored = BSON.EJSON.stringify({
      accounts: await database.collection("accounts").find({ "source.kind": "open_banking" }).limit(5).toArray(),
      connections: await database.collection("bankConnections").find({}).toArray(),
      revisions: await database.collection("bankRecordRevisions").find({}).limit(5).toArray(),
    });
    const forbidden = [process.env.OPEN_FINANCE_USER_ID, process.env.OPEN_FINANCE_CLIENT_ID, process.env.OPEN_FINANCE_CLIENT_SECRET]
      .filter((value): value is string => typeof value === "string");
    expect(forbidden.some((value) => allStored.includes(value))).toBe(false);

    const manualRepository = manualRecordRepositoryForDatabase(database, "transactions");
    expect((await manualRepository.listAllForActor(actor)).every((record) => record.source.kind === "open_banking")).toBe(true);

    const profile = await profileRepository.findForActor(actor);
    expect(profile).not.toBeNull();
    const accountRepository = manualRecordRepositoryForDatabase(database, "accounts");
    const sourceRecords: FinancialEngineSourceRecords = {
      accounts: await accountRepository.listAllForActor(actor),
      cards: [],
      expenses: [],
      income: [],
      loans: [],
      recurring_transactions: [],
      safety_margin: [],
      savings: [],
      transactions: await manualRepository.listAllForActor(actor),
    };
    const engineInput = buildFinancialEngineInput(profile!, sourceRecords, new Date().toISOString());
    expect(engineInput.currency).toBe("ILS");
    expect(engineInput.availableCash.currency).toBe("ILS");
    expect(engineInput.events.every((event) => event.amount.currency === "ILS")).toBe(true);
  }, 120_000);
});
