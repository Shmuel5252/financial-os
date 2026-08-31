import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { budgetRepositoryForDatabase } from "@/lib/budgets/budget-repository";
import { buildFinancialDataExport } from "@/lib/financial-data/financial-data-export-service";
import { goalRepositoryForDatabase } from "@/lib/goals/goal-repository";
import {
  captureFinancialSnapshot,
  listFinancialSnapshots,
} from "@/lib/financial-snapshots/financial-snapshot-service";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { ConflictError, InputValidationError } from "@/lib/errors/application-error";
import {
  manualSectionSchema,
  type ManualRecord,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  createManualRecord,
  listManualRecordPage,
  listManualRecords,
  updateManualRecord,
} from "@/lib/onboarding/manual-record-service";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 2 financial data foundation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(
    testUri ?? "mongodb://integration-test-not-configured",
    { promoteLongs: false },
  );
  const firstActor: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  const secondActor: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  let database: Db;
  let profileRepository: UserProfileRepository;
  let repositories: Readonly<Record<ManualSection, ManualRecordRepository>>;
  let firstAccount: ManualRecord;
  let secondAccount: ManualRecord;

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    repositories = Object.fromEntries(
      manualSectionSchema.options.map((section) => [
        section,
        manualRecordRepositoryForDatabase(database, section),
      ]),
    ) as unknown as Readonly<
      Record<ManualSection, ManualRecordRepository>
    >;

    await Promise.all([
      profileRepository.ensureIndexes(),
      ...Object.values(repositories).map((repository) =>
        repository.ensureIndexes(),
      ),
    ]);
    await saveProfile(
      firstActor,
      {
        countryCode: "IL",
        displayName: "First",
        expectedVersion: null,
        householdType: "single",
        primaryCurrency: "ILS",
        timeZone: "Asia/Jerusalem",
      },
      { repository: profileRepository },
    );
    await saveProfile(
      secondActor,
      {
        countryCode: "US",
        displayName: "Second",
        expectedVersion: null,
        householdType: "single",
        primaryCurrency: "USD",
        timeZone: "America/New_York",
      },
      { repository: profileRepository },
    );
    firstAccount = await createManualRecord(
      firstActor,
      "accounts",
      {
        balance: { amount: "90071992547409.91", currency: "ILS" },
        name: "First account",
        type: "bank",
      },
      randomUUID(),
      {
        profileRepository,
        repository: repositories.accounts,
      },
    );
    secondAccount = await createManualRecord(
      secondActor,
      "accounts",
      {
        balance: { amount: "1000.00", currency: "USD" },
        name: "Second account",
        type: "bank",
      },
      randomUUID(),
      {
        profileRepository,
        repository: repositories.accounts,
      },
    );
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("makes creation idempotent per owner and rejects key reuse with different data", async () => {
    const key = randomUUID();
    const input = {
      accountId: firstAccount.id,
      amount: { amount: "123.45", currency: "ILS" },
      category: "food",
      confidenceBps: 10_000,
      date: "2026-08-31",
      destinationAccountId: null,
      merchant: "Market",
      notes: null,
      recurring: false,
      type: "expense",
    };
    const dependencies = {
      accountRepository: repositories.accounts,
      profileRepository,
      repository: repositories.transactions,
    };
    const first = await createManualRecord(
      firstActor,
      "transactions",
      input,
      key,
      dependencies,
    );
    const retried = await createManualRecord(
      firstActor,
      "transactions",
      input,
      key,
      dependencies,
    );

    expect(retried.id).toBe(first.id);
    expect(await listManualRecords(firstActor, "transactions", dependencies)).toHaveLength(1);
    await expect(
      createManualRecord(
        firstActor,
        "transactions",
        { ...input, amount: { amount: "999", currency: "ILS" } },
        key,
        dependencies,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const raw = await database
      .collection("transactions")
      .findOne({ _id: new ObjectId(first.id) });
    expect(raw?.fields.amount.amountMinor).toBeInstanceOf(Long);
    expect(raw?.fields.amount.amountMinor.toBigInt()).toBe(12_345n);
    expect(raw?.source).toEqual({ kind: "manual" });
    expect(raw?.idempotencyKeyHash).not.toBe(key);
  });

  it("rejects cross-user account references and isolates CRUD operations", async () => {
    const secondDependencies = {
      accountRepository: repositories.accounts,
      profileRepository,
      repository: repositories.transactions,
    };

    await expect(
      createManualRecord(
        secondActor,
        "transactions",
        {
          accountId: firstAccount.id,
          amount: { amount: "10", currency: "USD" },
          category: "other",
          confidenceBps: 10_000,
          date: "2026-08-31",
          destinationAccountId: null,
          merchant: null,
          notes: null,
          recurring: false,
          type: "expense",
        },
        randomUUID(),
        secondDependencies,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);

    const secondTransaction = await createManualRecord(
      secondActor,
      "transactions",
      {
        accountId: secondAccount.id,
        amount: { amount: "10", currency: "USD" },
        category: "other",
        confidenceBps: 10_000,
        date: "2026-08-31",
        destinationAccountId: null,
        merchant: null,
        notes: null,
        recurring: false,
        type: "expense",
      },
      randomUUID(),
      secondDependencies,
    );
    const firstVisible = await listManualRecords(firstActor, "transactions", {
      profileRepository,
      repository: repositories.transactions,
    });

    expect(firstVisible.every((record) => record.id !== secondTransaction.id)).toBe(true);
    await expect(
      updateManualRecord(
        firstActor,
        "transactions",
        secondTransaction.id,
        secondTransaction.version,
        {
          accountId: firstAccount.id,
          amount: { amount: "20", currency: "ILS" },
          category: "other",
          confidenceBps: 10_000,
          date: "2026-08-31",
          destinationAccountId: null,
          merchant: null,
          notes: null,
          recurring: false,
          type: "expense",
        },
        {
          accountRepository: repositories.accounts,
          profileRepository,
          repository: repositories.transactions,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("paginates deterministically and preserves exact savings money", async () => {
    for (const [index, amount] of ["1.01", "2.02", "3.03"].entries()) {
      await createManualRecord(
        firstActor,
        "savings",
        {
          accountIdentifierLast4: null,
          availability: "liquid",
          balance: { amount, currency: "ILS" },
          institution: null,
          maturityDate: null,
          name: `Saving ${index}`,
        },
        randomUUID(),
        {
          profileRepository,
          repository: repositories.savings,
        },
      );
    }

    const firstPage = await listManualRecordPage(
      firstActor,
      "savings",
      { limit: 2 },
      { profileRepository, repository: repositories.savings },
    );
    const secondPage = await listManualRecordPage(
      firstActor,
      "savings",
      { cursor: firstPage.nextCursor ?? undefined, limit: 2 },
      { profileRepository, repository: repositories.savings },
    );

    expect(firstPage.records).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.records).toHaveLength(1);
    expect(
      new Set([...firstPage.records, ...secondPage.records].map((record) => record.id)).size,
    ).toBe(3);
  });

  it("creates immutable source manifests and isolates snapshot listings", async () => {
    const snapshotRepository = financialSnapshotRepositoryForDatabase(database);
    await snapshotRepository.ensureIndexes();
    const dependencies = {
      profileRepository,
      repository: snapshotRepository,
      sourceRepositories: repositories,
    };
    const key = randomUUID();
    const snapshot = await captureFinancialSnapshot(
      firstActor,
      key,
      dependencies,
    );
    const retried = await captureFinancialSnapshot(
      firstActor,
      key,
      dependencies,
    );

    expect(retried.id).toBe(snapshot.id);
    expect(snapshot.kind).toBe("source_manifest");
    expect(snapshot.sources.find((source) => source.section === "accounts")?.records).toHaveLength(1);
    expect(
      (await listFinancialSnapshots(secondActor, { limit: 10 }, dependencies))
        .snapshots,
    ).toHaveLength(0);
  });

  it("exports only public owned data and keeps every custom index owner-prefixed", async () => {
    const exported = await buildFinancialDataExport(firstActor, {
      budgetRepository: budgetRepositoryForDatabase(database),
      goalRepository: goalRepositoryForDatabase(database),
      now: () => new Date("2026-08-31T12:00:00.000Z"),
      profileRepository,
      repositories,
    });
    const serialized = JSON.stringify(exported);

    expect(exported.profile?.primaryCurrency).toBe("ILS");
    expect(exported.records.transactions).toHaveLength(1);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("auditTrail");
    expect(serialized).not.toContain("idempotencyKeyHash");

    for (const collectionName of [
      "transactions",
      "recurringTransactions",
      "savings",
      "financialSnapshots",
    ]) {
      const indexes = await database.collection(collectionName).indexes();
      const customIndexes = indexes.filter((index) => index.name !== "_id_");

      expect(customIndexes.length).toBeGreaterThan(0);
      expect(
        customIndexes.every((index) => Object.keys(index.key)[0] === "userId"),
      ).toBe(true);
    }
  });
});
