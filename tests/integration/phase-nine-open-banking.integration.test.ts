import { createHash, randomUUID } from "node:crypto";

import { BSON, Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { buildFinancialEngineInput, type FinancialEngineSourceRecords } from "@/lib/financial-engine/financial-engine-input";
import { money } from "@/lib/domain/money/money";
import { ConflictError, DependencyUnavailableError, ReconciliationRequiredError, UnauthorizedError } from "@/lib/errors/application-error";
import type { ManualFields } from "@/lib/onboarding/manual-record";
import { manualRecordRepositoryForDatabase, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { updateManualRecord, deleteManualRecord } from "@/lib/onboarding/manual-record-service";
import { openBankingRepositoryForDatabase, type OpenBankingRepository } from "@/lib/open-banking/open-banking-repository";
import type {
  OpenBankingAccountObservation,
  OpenBankingConnectionObservation,
  OpenBankingPage,
  OpenBankingProvider,
  OpenBankingRefreshResult,
  OpenBankingTransactionObservation,
} from "@/lib/open-banking/open-banking-provider";
import {
  claimConfiguredOpenBankingSubject,
  loadOpenBankingCenter,
  requestOpenBankingRefresh,
  synchronizeOpenBanking,
} from "@/lib/open-banking/open-banking-service";
import { profileRepositoryForDatabase, type UserProfileRepository } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

class FixtureProvider implements OpenBankingProvider {
  failTransactions = false;
  modified = false;
  promotePending = false;
  reconnected = false;
  refreshCalls = 0;

  private readonly connection: OpenBankingConnectionObservation = {
    expiryDate: "2026-12-01",
    externalId: "raw-connection-one",
    lastFetchedAt: "2026-09-03T08:00:00.000Z",
    lastFetchedDataDate: "2026-09-03",
    mode: "PSD2",
    providerExternalId: "raw-provider-one",
    status: "ACTIVE",
    subjectExternalId: "fixture-provider-user",
  };

  async listConnections() {
    return this.reconnected ? [
      { ...this.connection, status: "TERMINATED_BY_USER" },
      { ...this.connection, externalId: "raw-reconnected-connection", status: "ACTIVE" },
    ] : [this.connection];
  }

  async listAccountsPage(cursor?: string): Promise<OpenBankingPage<OpenBankingAccountObservation>> {
    if (cursor === undefined) return {
      items: [{
        accountType: "CHECKING",
        balances: [{ amount: money(10_000_050n, "ILS"), creditLimitIncluded: false, referenceDate: "2026-09-03", type: "interimAvailable" }],
        connectionExternalId: this.connection.externalId,
        currency: "ILS",
        displayName: "Primary 123456789",
        externalId: "raw-account-primary",
        isDuplicate: false,
        providerExternalId: this.connection.providerExternalId,
      }],
      nextCursor: "accounts-page-two",
    };
    return {
      items: [{
        accountType: "CHECKING",
        balances: [{ amount: money(4_200n, "USD"), creditLimitIncluded: false, referenceDate: null, type: "closingBooked" }],
        connectionExternalId: this.connection.externalId,
        currency: "USD",
        displayName: "Foreign account",
        externalId: "raw-account-foreign",
        isDuplicate: false,
        providerExternalId: this.connection.providerExternalId,
      }],
      nextCursor: null,
    };
  }

  async listTransactionsPage(cursor?: string): Promise<OpenBankingPage<OpenBankingTransactionObservation>> {
    if (this.failTransactions) throw new DependencyUnavailableError("fixture outage");
    const common = {
      bookingDate: "2026-09-02",
      categoryMain: "shopping",
      categorySub: "retail",
      changedCategoryMain: null,
      changedCategorySub: null,
      connectionExternalId: this.connection.externalId,
      installmentNumber: null,
      installmentTotal: null,
      isDuplicate: false,
      originalAmount: null,
      providerExternalId: this.connection.providerExternalId,
      transactionDate: "2026-09-02",
      type: "CHECKING",
      valueDate: "2026-09-02",
    } as const;
    if (cursor === undefined) return {
      items: [
        {
          ...common,
          accountExternalId: "raw-account-primary",
          amount: money(this.modified ? -1_334n : -1_234n, "ILS"),
          externalId: "raw-transaction-booked",
          merchantName: "Merchant 987654321",
          stableExternalKey: "raw-stable-booked",
          status: "BOOKED",
        },
        {
          ...common,
          accountExternalId: "raw-account-primary",
          amount: money(-500n, "ILS"),
          externalId: "raw-transaction-pending",
          merchantName: "Pending merchant",
          stableExternalKey: "raw-stable-pending",
          status: this.promotePending ? "BOOKED" : "PENDING",
        },
      ],
      nextCursor: "transactions-page-two",
    };
    return {
      items: [{
        ...common,
        accountExternalId: "raw-account-foreign",
        amount: money(-700n, "USD"),
        externalId: "raw-transaction-foreign",
        merchantName: "Foreign merchant",
        stableExternalKey: "raw-stable-foreign",
        status: "BOOKED",
      }],
      nextCursor: null,
    };
  }

  async refreshConnections(): Promise<OpenBankingRefreshResult> {
    this.refreshCalls += 1;
    return { costCredits: 20, status: "accepted" };
  }

  async deleteConnection(): Promise<void> {}
}

describeWithMongo("Phase 9 Open Banking persistence, reconciliation, and isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const provider = new FixtureProvider();
  let database: Db;
  let profileRepository: UserProfileRepository;
  let repository: OpenBankingRepository;
  let accounts: ManualRecordRepository;
  let transactions: ManualRecordRepository;
  let manualAccountId: string;
  let manualTransactionId: string;

  function deps() { return { now: () => new Date("2026-09-03T10:00:00.000Z"), profileRepository, provider, repository }; }

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_SECRET", "fixture-auth-secret-at-least-32-characters-long");
    vi.stubEnv("OPEN_FINANCE_USER_ID", "fixture-provider-user");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "fixture-client");
    vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "fixture-secret");
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    repository = openBankingRepositoryForDatabase(database, () => new Date("2026-09-03T10:00:00.000Z"));
    accounts = manualRecordRepositoryForDatabase(database, "accounts", () => new Date("2026-09-03T09:00:00.000Z"));
    transactions = manualRecordRepositoryForDatabase(database, "transactions", () => new Date("2026-09-03T09:00:00.000Z"));
    await Promise.all([profileRepository.ensureIndexes(), repository.ensureIndexes(), accounts.ensureIndexes(), transactions.ensureIndexes()]);
    await saveProfile(firstActor, { countryCode: "IL", displayName: "Owner", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profileRepository });
    await saveProfile(secondActor, { countryCode: "IL", displayName: "Other", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profileRepository });
    const manualAccount = await accounts.createForActor(firstActor, { balance: money(1_000n, "ILS"), name: "Manual cash", type: "cash" } as ManualFields, randomUUID());
    manualAccountId = manualAccount.id;
    const manualTransaction = await transactions.createForActor(firstActor, {
      accountId: manualAccount.id, amount: money(100n, "ILS"), category: "food", confidenceBps: 10_000,
      date: "2026-09-01", destinationAccountId: null, merchant: "Manual", notes: null, recurring: false,
      refundOfTransactionId: null, type: "expense",
    } as ManualFields, randomUUID());
    manualTransactionId = manualTransaction.id;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("requires an explicit unique Auth.js-owner binding", async () => {
    await claimConfiguredOpenBankingSubject(firstActor, deps());
    await claimConfiguredOpenBankingSubject(firstActor, deps());
    await expect(claimConfiguredOpenBankingSubject(secondActor, deps())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(synchronizeOpenBanking(secondActor, randomUUID(), deps())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("paginates, stores exact evidence, keeps pending/foreign data noncanonical, and preserves manual truth", async () => {
    const run = await synchronizeOpenBanking(firstActor, randomUUID(), deps());
    expect(run.status).toBe("completed");
    expect(run.connectionObservationCount).toBe(1);
    expect(run.accountObservationCount).toBe(2);
    expect(run.transactionObservationCount).toBe(3);
    expect(run.canonicalAccountCount).toBe(1);
    expect(run.canonicalTransactionCount).toBe(1);

    const accountRecords = await accounts.listAllForActor(firstActor);
    const transactionRecords = await transactions.listAllForActor(firstActor);
    expect(accountRecords).toHaveLength(2);
    expect(transactionRecords).toHaveLength(2);
    expect(accountRecords.some((record) => record.id === manualAccountId && record.source.kind === "manual")).toBe(true);
    expect(transactionRecords.some((record) => record.id === manualTransactionId && record.source.kind === "manual")).toBe(true);
    const providerAccount = accountRecords.find((record) => record.source.kind === "open_banking");
    const providerTransaction = transactionRecords.find((record) => record.source.kind === "open_banking");
    expect((providerAccount?.fields as { balance: { amountMinor: bigint } }).balance.amountMinor).toBe(10_000_050n);
    expect((providerTransaction?.fields as { amount: { amountMinor: bigint } }).amount.amountMinor).toBe(1_234n);

    const storedMoney = await database.collection("accounts").findOne({ _id: new ObjectId(providerAccount?.id) });
    expect((storedMoney?.fields as { balance: { amountMinor: unknown } }).balance.amountMinor).toBeInstanceOf(Long);
    expect(await database.collection("bankRecordRevisions").countDocuments({ recordKind: "transaction" })).toBe(3);
    const serialized = BSON.EJSON.stringify(await database.collection("bankRecordRevisions").find({}).toArray());
    expect(["raw-connection-one", "raw-account-primary", "raw-stable-booked", "fixture-provider-user"].some((value) => serialized.includes(value))).toBe(false);

    const secondCenter = await loadOpenBankingCenter(secondActor, deps());
    expect(secondCenter.bindingClaimed).toBe(false);
    expect(secondCenter.accounts).toHaveLength(0);
    expect(secondCenter.connections).toHaveLength(0);

    const primaryRecord = await profileRepository.findForActor(firstActor);
    expect(primaryRecord).not.toBeNull();
    const sourceRecords: FinancialEngineSourceRecords = {
      accounts: accountRecords,
      cards: [], expenses: [], income: [], loans: [], recurring_transactions: [], safety_margin: [], savings: [],
      transactions: transactionRecords,
    };
    const engineInput = buildFinancialEngineInput(primaryRecord!, sourceRecords, "2026-09-03T10:00:00.000Z");
    expect(engineInput.availableCash.amountMinor).toBe(10_001_050n);
    expect(engineInput.actualMonthlyExpenses.amountMinor).toBe(1_334n);
  });

  it("is idempotent, then appends modifications and pending-to-booked evidence without duplicates", async () => {
    const revisionsBefore = await database.collection("bankRecordRevisions").countDocuments();
    const repeated = await synchronizeOpenBanking(firstActor, randomUUID(), deps());
    expect(repeated.canonicalAccountCount).toBe(0);
    expect(repeated.canonicalTransactionCount).toBe(0);
    expect(await database.collection("bankRecordRevisions").countDocuments()).toBe(revisionsBefore);

    provider.modified = true;
    provider.promotePending = true;
    const changed = await synchronizeOpenBanking(firstActor, randomUUID(), deps());
    expect(changed.canonicalTransactionCount).toBe(2);
    const providerTransactions = (await transactions.listAllForActor(firstActor)).filter((record) => record.source.kind === "open_banking");
    expect(providerTransactions).toHaveLength(2);
    expect(providerTransactions.map((record) => (record.fields as { amount: { amountMinor: bigint } }).amount.amountMinor).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)).toEqual([500n, 1_334n]);
    expect(await database.collection("bankRecordRevisions").countDocuments({ recordKind: "transaction" })).toBe(5);

    const repeatKey = randomUUID();
    const first = await synchronizeOpenBanking(firstActor, repeatKey, deps());
    const sameCommand = await synchronizeOpenBanking(firstActor, repeatKey, deps());
    expect(sameCommand.id).toBe(first.id);
  });

  it("fails manual mutation of provider records and recovers a durable partial run", async () => {
    const providerAccount = (await accounts.listAllForActor(firstActor)).find((record) => record.source.kind === "open_banking");
    expect(providerAccount).toBeDefined();
    await expect(updateManualRecord(firstActor, "accounts", providerAccount!.id, providerAccount!.version, {
      balance: { amount: "1", currency: "ILS" }, name: "Forbidden rewrite", type: "bank",
    }, { profileRepository, repository: accounts })).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteManualRecord(firstActor, "accounts", providerAccount!.id, providerAccount!.version, { repository: accounts })).rejects.toBeInstanceOf(ConflictError);

    provider.failTransactions = true;
    const recoveryKey = randomUUID();
    await expect(synchronizeOpenBanking(firstActor, recoveryKey, deps())).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect((await loadOpenBankingCenter(firstActor, deps())).latestRun?.status).toBe("partial");
    provider.failTransactions = false;
    expect((await synchronizeOpenBanking(firstActor, recoveryKey, deps())).status).toBe("completed");
  });

  it("deduplicates an explicitly confirmed refresh command", async () => {
    const key = randomUUID();
    expect((await requestOpenBankingRefresh(firstActor, key, deps())).costCredits).toBe(20);
    expect((await requestOpenBankingRefresh(firstActor, key, deps())).status).toBe("accepted");
    expect(provider.refreshCalls).toBe(1);
  });

  it("never replays an uncertain failed paid command and preserves its failure receipt", async () => {
    const key = randomUUID();
    const refresh = vi.spyOn(provider, "refreshConnections").mockRejectedValue(new DependencyUnavailableError("uncertain fixture response"));
    try {
      await expect(requestOpenBankingRefresh(firstActor, key, deps())).rejects.toBeInstanceOf(DependencyUnavailableError);
      const receipt = await database.collection("bankLifecycleCommands").findOne({ userId: new ObjectId(firstActor.userId), idempotencyKeyHash: createHash("sha256").update(key).digest("hex") });
      expect(receipt?.status).toBe("failed");
      await expect(requestOpenBankingRefresh(firstActor, key, deps())).rejects.toBeInstanceOf(ConflictError);
      await expect(requestOpenBankingRefresh(secondActor, key, deps())).rejects.toBeInstanceOf(UnauthorizedError);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(BSON.EJSON.stringify(await database.collection("bankLifecycleCommands").findOne({ _id: receipt!._id }))).toBe(BSON.EJSON.stringify(receipt));
    } finally {
      refresh.mockRestore();
    }
  });

  it("blocks ambiguous reconnection before any sync write or account/transaction fetch", async () => {
    const collectionNames = ["accounts", "transactions", "bankConnections", "bankRecordRevisions", "bankSyncRuns", "bankLifecycleCommands"];
    const checkpoint = async () => BSON.EJSON.stringify(await Promise.all(collectionNames.map((name) =>
      database.collection(name).find({}).sort({ _id: 1 }).toArray())));
    const before = await checkpoint();
    const accountRead = vi.spyOn(provider, "listAccountsPage");
    const transactionRead = vi.spyOn(provider, "listTransactionsPage");
    provider.reconnected = true;
    try {
      await expect(synchronizeOpenBanking(firstActor, randomUUID(), deps())).rejects.toBeInstanceOf(ReconciliationRequiredError);
      await expect(synchronizeOpenBanking(secondActor, randomUUID(), deps())).rejects.toBeInstanceOf(UnauthorizedError);
      expect(accountRead).not.toHaveBeenCalled();
      expect(transactionRead).not.toHaveBeenCalled();
      expect((await checkpoint()) === before, "All canonical and audit collections unchanged").toBe(true);
    } finally {
      provider.reconnected = false;
    }
    const prior = await database.collection("bankConnections").findOne({ userId: new ObjectId(firstActor.userId) });
    expect(prior !== null).toBe(true);
    const incoming = [
      { connectionAlias: prior!.connectionAlias, providerAlias: prior!.providerAlias, status: "TERMINATED_BY_USER" },
      { connectionAlias: "new-connection-alias", providerAlias: prior!.providerAlias, status: "ACTIVE" },
    ];
    await expect(repository.assertConnectionContinuity(firstActor, incoming)).rejects.toBeInstanceOf(ReconciliationRequiredError);
    await expect(repository.assertConnectionContinuity(secondActor, incoming)).resolves.toBeUndefined();
    await expect(repository.assertConnectionContinuity(firstActor, [incoming[0]!, { ...incoming[1]!, providerAlias: "different-institution" }])).resolves.toBeUndefined();
    await expect(repository.assertConnectionContinuity(firstActor, [{ ...incoming[0]!, status: "ACTIVE" }])).resolves.toBeUndefined();
  });

  it("creates owner-first indexes for every Phase 9 persistence boundary", async () => {
    for (const collectionName of ["bankConnections", "bankRecordRevisions", "bankSyncRuns", "bankLifecycleCommands"]) {
      const indexes = await database.collection(collectionName).indexes();
      expect(indexes.some((index) => Object.keys(index.key)[0] === "userId")).toBe(true);
    }
  });

  it("rejects missing subject ownership and foreign account/transaction parent scopes", async () => {
    const currentConnections = await provider.listConnections();
    const subjectRead = vi.spyOn(provider, "listConnections").mockResolvedValue(currentConnections.map((item) => ({ ...item, subjectExternalId: null })));
    await expect(synchronizeOpenBanking(firstActor, randomUUID(), deps())).rejects.toBeInstanceOf(DependencyUnavailableError);
    subjectRead.mockRestore();
    const currentAccounts = await provider.listAccountsPage();
    const accountRead = vi.spyOn(provider, "listAccountsPage").mockResolvedValue({ ...currentAccounts, items: currentAccounts.items.map((item) => ({ ...item, connectionExternalId: "foreign-connection" })) });
    const before = BSON.EJSON.stringify(await database.collection("accounts").find({}).sort({ _id: 1 }).toArray());
    await expect(synchronizeOpenBanking(firstActor, randomUUID(), deps())).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(BSON.EJSON.stringify(await database.collection("accounts").find({}).sort({ _id: 1 }).toArray()) === before).toBe(true);
    accountRead.mockRestore();
    const currentTransactions = await provider.listTransactionsPage();
    const transactionRead = vi.spyOn(provider, "listTransactionsPage").mockResolvedValue({ ...currentTransactions, items: currentTransactions.items.map((item) => ({ ...item, accountExternalId: "foreign-account" })) });
    const beforeTransactions = BSON.EJSON.stringify(await database.collection("transactions").find({}).sort({ _id: 1 }).toArray());
    await expect(synchronizeOpenBanking(firstActor, randomUUID(), deps())).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(BSON.EJSON.stringify(await database.collection("transactions").find({}).sort({ _id: 1 }).toArray()) === beforeTransactions).toBe(true);
    transactionRead.mockRestore();
  });

  it("excludes only the exact completed development retirement aliases for that owner", async () => {
    await database.collection("bankDevelopmentMigrations").insertMany([
      { userId: new ObjectId(firstActor.userId), policyVersion: "financy-development-baseline-2026-09-06-v1", state: "retired", oldConnectionAliases: ["retired-one"] },
      { userId: new ObjectId(firstActor.userId), policyVersion: "financy-development-baseline-2026-09-06-v1", state: "prepared", oldConnectionAliases: ["not-retired"] },
      { userId: new ObjectId(secondActor.userId), policyVersion: "financy-development-baseline-2026-09-06-v1", state: "retired", oldConnectionAliases: ["other-owner-retired"] },
    ]);
    expect([...await repository.retiredDevelopmentConnectionAliases(firstActor)]).toEqual(["retired-one"]);
    expect([...await repository.retiredDevelopmentConnectionAliases(secondActor)]).toEqual(["other-owner-retired"]);
  });
});
