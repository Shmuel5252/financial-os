import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { budgetRepositoryForDatabase, type BudgetRepository } from "@/lib/budgets/budget-repository";
import {
  closeBudgetPeriod,
  createBudgetCategory,
  createBudgetCorrection,
  loadBudgetView,
  saveBudgetPeriod,
  updateBudgetCategory,
  type BudgetDependencies,
} from "@/lib/budgets/budget-service";
import { money } from "@/lib/domain/money/money";
import { InputValidationError } from "@/lib/errors/application-error";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import { createManualRecord } from "@/lib/onboarding/manual-record-service";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 5 budgets and monthly allocation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(
    testUri ?? "mongodb://integration-test-not-configured",
    { promoteLongs: false },
  );
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  let database: Db;
  let budgetRepository: BudgetRepository;
  let profileRepository: UserProfileRepository;
  let sources: Readonly<Record<"expenses" | "income" | "loans" | "recurring_transactions" | "transactions" | "accounts", ManualRecordRepository>>;
  let dependencies: BudgetDependencies;
  let firstExpenseId: string;
  let customCategoryId: string;

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    budgetRepository = budgetRepositoryForDatabase(database);
    profileRepository = profileRepositoryForDatabase(database);
    sources = {
      accounts: manualRecordRepositoryForDatabase(database, "accounts"),
      expenses: manualRecordRepositoryForDatabase(database, "expenses"),
      income: manualRecordRepositoryForDatabase(database, "income"),
      loans: manualRecordRepositoryForDatabase(database, "loans"),
      recurring_transactions: manualRecordRepositoryForDatabase(database, "recurring_transactions"),
      transactions: manualRecordRepositoryForDatabase(database, "transactions"),
    };
    const engineRepository = financialEngineSnapshotRepositoryForDatabase(database);
    await Promise.all([
      budgetRepository.ensureIndexes(),
      profileRepository.ensureIndexes(),
      engineRepository.ensureIndexes(),
      ...Object.values(sources).map((repository) => repository.ensureIndexes()),
    ]);
    await saveProfile(firstActor, {
      countryCode: "IL",
      displayName: "Budget owner",
      expectedVersion: null,
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
    }, { repository: profileRepository });
    await saveProfile(secondActor, {
      countryCode: "US",
      displayName: "Other owner",
      expectedVersion: null,
      householdType: "single",
      primaryCurrency: "USD",
      timeZone: "America/New_York",
    }, { repository: profileRepository });
    dependencies = {
      budgetRepository,
      engineRepository,
      now: () => new Date("2026-08-15T09:00:00.000Z"),
      profileRepository,
      sourceRepositories: sources,
    };
    const account = await createManualRecord(firstActor, "accounts", {
      balance: { amount: "10000", currency: "ILS" },
      name: "Budget account",
      type: "bank",
    }, randomUUID(), { profileRepository, repository: sources.accounts });
    await createManualRecord(firstActor, "income", {
      amount: { amount: "5000", currency: "ILS" },
      certaintyBps: 10_000,
      destination: "bank_account",
      expectedDate: "2026-08-15",
      frequency: "one_time",
      name: "Confirmed income",
    }, randomUUID(), { profileRepository, repository: sources.income });
    await createManualRecord(firstActor, "income", {
      amount: { amount: "1000", currency: "ILS" },
      certaintyBps: 7_500,
      destination: "bank_account",
      expectedDate: "2026-08-20",
      frequency: "one_time",
      name: "Expected income",
    }, randomUUID(), { profileRepository, repository: sources.income });
    await createManualRecord(firstActor, "expenses", {
      amount: { amount: "300", currency: "ILS" },
      category: "utilities",
      frequency: "monthly",
      name: "Known utility",
      nextDueDate: "2026-08-20",
    }, randomUUID(), { profileRepository, repository: sources.expenses });
    const expense = await createManualRecord(firstActor, "transactions", {
      accountId: account.id,
      amount: { amount: "1200", currency: "ILS" },
      category: "food",
      confidenceBps: 10_000,
      date: "2026-08-05",
      destinationAccountId: null,
      merchant: "Market",
      notes: null,
      recurring: false,
      type: "expense",
    }, randomUUID(), {
      accountRepository: sources.accounts,
      profileRepository,
      repository: sources.transactions,
    });
    firstExpenseId = expense.id;
    await createManualRecord(firstActor, "transactions", {
      accountId: account.id,
      amount: { amount: "200", currency: "ILS" },
      category: "food",
      confidenceBps: 10_000,
      date: "2026-08-10",
      destinationAccountId: null,
      merchant: "Market refund",
      notes: null,
      recurring: false,
      refundOfTransactionId: expense.id,
      type: "refund",
    }, randomUUID(), {
      accountRepository: sources.accounts,
      profileRepository,
      repository: sources.transactions,
    });
    await createManualRecord(firstActor, "transactions", {
      accountId: account.id,
      amount: { amount: "100", currency: "ILS" },
      category: "salary",
      confidenceBps: 10_000,
      date: "2026-08-12",
      destinationAccountId: null,
      merchant: "Uncategorized expense",
      notes: null,
      recurring: false,
      type: "expense",
    }, randomUUID(), {
      accountRepository: sources.accounts,
      profileRepository,
      repository: sources.transactions,
    });
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("keeps confirmed allocation, uncertain income, refunds, forecasts, and deficits separate", async () => {
    const custom = await createBudgetCategory(firstActor, {
      idempotencyKey: randomUUID(),
      label: "גמיש",
      rolloverPolicy: "carry",
    }, dependencies);
    customCategoryId = custom.categoryId;
    await updateBudgetCategory(firstActor, {
      categoryId: "system:housing",
      expectedVersion: 0,
      hidden: false,
      label: "דיור מותאם",
      rolloverPolicy: "reset",
      sortOrder: 5,
    }, dependencies);
    await createBudgetCorrection(firstActor, {
      idempotencyKey: randomUUID(),
      reason: "הוצאה גמישה ולא מזון",
      toCategoryId: custom.categoryId,
      transactionId: firstExpenseId,
    }, dependencies);
    const saved = await saveBudgetPeriod(firstActor, {
      allocations: [
        { amount: money(300_000n, "ILS"), categoryId: custom.categoryId },
        { amount: money(250_000n, "ILS"), categoryId: "system:housing" },
      ],
      calendarMonth: "2026-08",
      expectedVersion: null,
    }, dependencies);
    const customLine = saved.calculation.lines.find(
      (line) => line.categoryId === custom.categoryId,
    );

    expect(saved.calculation.confirmedIncome.amountMinor).toBe("500000");
    expect(saved.calculation.uncertainIncome.amountMinor).toBe("100000");
    expect(saved.calculation.unallocated.amountMinor).toBe("-50000");
    expect(customLine?.spent.amountMinor).toBe("100000");
    expect(saved.calculation.uncategorizedSpent.amountMinor).toBe("10000");
    expect(
      saved.calculation.lines.find((line) => line.categoryId === "system:utilities")
        ?.forecastSpent.amountMinor,
    ).toBe("30000");
    expect(saved.period.version).toBe(1);
  });

  it("freezes closing rollover while later corrections and refunds affect their real periods", async () => {
    const closed = await closeBudgetPeriod(firstActor, {
      calendarMonth: "2026-08",
      expectedVersion: 1,
    }, { ...dependencies, now: () => new Date("2026-09-01T09:00:00.000Z") });
    const closingCustom = closed.period.closingSnapshot?.lines.find(
      (line) => line.categoryId === customCategoryId,
    );
    expect(closingCustom?.carryOut.amountMinor).toBe("200000");
    expect(
      closed.period.closingSnapshot?.lines.find(
        (line) => line.categoryId === "system:housing",
      )?.carryOut.amountMinor,
    ).toBe("0");

    await createBudgetCorrection(firstActor, {
      idempotencyKey: randomUUID(),
      reason: "תיקון מאוחר עם ראיה",
      toCategoryId: "system:housing",
      transactionId: firstExpenseId,
    }, dependencies);
    const correctedHistory = await loadBudgetView(firstActor, "2026-08", {
      ...dependencies,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
    });
    expect(
      correctedHistory.calculation.lines.find(
        (line) => line.categoryId === "system:housing",
      )?.spent.amountMinor,
    ).toBe("100000");
    expect(
      correctedHistory.period.closingSnapshot?.lines.find(
        (line) => line.categoryId === customCategoryId,
      )?.spent.amountMinor,
    ).toBe("100000");

    const account = (await sources.accounts.listForActor(firstActor))[0]!;
    await createManualRecord(firstActor, "transactions", {
      accountId: account.id,
      amount: { amount: "100", currency: "ILS" },
      category: "food",
      confidenceBps: 10_000,
      date: "2026-09-05",
      destinationAccountId: null,
      merchant: "Late refund",
      notes: null,
      recurring: false,
      refundOfTransactionId: firstExpenseId,
      type: "refund",
    }, randomUUID(), {
      accountRepository: sources.accounts,
      profileRepository,
      repository: sources.transactions,
    });
    const september = await saveBudgetPeriod(firstActor, {
      allocations: [],
      calendarMonth: "2026-09",
      expectedVersion: null,
    }, { ...dependencies, now: () => new Date("2026-09-10T09:00:00.000Z") });
    expect(
      september.period.carryIn.find(
        (allocation) => allocation.categoryId === customCategoryId,
      )?.amount.amountMinor,
    ).toBe("200000");
    expect(
      september.calculation.lines.find(
        (line) => line.categoryId === "system:housing",
      )?.spent.amountMinor,
    ).toBe("-10000");
    expect(correctedHistory.calculation.totalSpent.amountMinor).toBe("110000");
  });

  it("enforces category, period, correction, and index ownership", async () => {
    await expect(
      saveBudgetPeriod(secondActor, {
        allocations: [
          { amount: money(100n, "USD"), categoryId: customCategoryId },
        ],
        calendarMonth: "2026-08",
        expectedVersion: null,
      }, { ...dependencies, now: () => new Date("2026-08-15T09:00:00.000Z") }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      createBudgetCorrection(secondActor, {
        idempotencyKey: randomUUID(),
        reason: "cross owner",
        toCategoryId: "system:food",
        transactionId: firstExpenseId,
      }, dependencies),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(await budgetRepository.findPeriodForActor(secondActor, "2026-08")).toBeNull();
    expect(await budgetRepository.findCategoryForActor(secondActor, customCategoryId)).toBeNull();

    for (const collectionName of [
      "budgetCategories",
      "budgetPeriods",
      "budgetCategoryCorrections",
    ]) {
      const indexes = await database.collection(collectionName).indexes();
      const customIndexes = indexes.filter((index) => index.name !== "_id_");
      expect(customIndexes.length).toBeGreaterThan(0);
      expect(
        customIndexes.every((index) => Object.keys(index.key)[0] === "userId"),
      ).toBe(true);
    }
    const rawPeriod = await database.collection("budgetPeriods").findOne({
      userId: new ObjectId(firstActor.userId),
      calendarMonth: "2026-08",
    });
    expect(rawPeriod?.allocations[0].amount.amountMinor).toBeInstanceOf(Long);
    expect(rawPeriod?.closingSnapshot.unallocated.amountMinor).toBeInstanceOf(Long);
    expect(rawPeriod?.auditTrail).toHaveLength(2);
    const corrections = await database.collection("budgetCategoryCorrections")
      .find({ userId: new ObjectId(firstActor.userId), transactionId: new ObjectId(firstExpenseId) })
      .toArray();
    expect(corrections).toHaveLength(2);
  });
});
