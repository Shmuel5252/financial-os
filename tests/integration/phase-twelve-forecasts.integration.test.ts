import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import {
  budgetRepositoryForDatabase,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import { createBudgetCorrection } from "@/lib/budgets/budget-service";
import { ConflictError, NotFoundError } from "@/lib/errors/application-error";
import {
  financialEngineSourceSections,
  type FinancialEngineSourceSection,
} from "@/lib/financial-engine/financial-engine-input";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { calculateFinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot-service";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { forecastRepositoryForDatabase } from "@/lib/forecasts/forecast-repository";
import {
  createForecastScenario,
  createOperationalForecast,
  loadForecastCenter,
  type ForecastDependencies,
} from "@/lib/forecasts/forecast-service";
import type { ManualFields } from "@/lib/onboarding/manual-record";
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
import {
  transactionIntelligenceRepositoryForDatabase,
  type TransactionIntelligenceRepository,
} from "@/lib/transaction-intelligence/transaction-intelligence-repository";
import {
  reviewTransactionIntelligenceSignal,
  runTransactionIntelligence,
} from "@/lib/transaction-intelligence/transaction-intelligence-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

type TransactionFields = Extract<ManualFields, Readonly<{
  confidenceBps: number;
  refundOfTransactionId: string | null;
  recurring: boolean;
}>>;

describeWithMongo("Phase 12 forecast persistence, isolation, and integrity", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const firstAccountId = new ObjectId().toHexString();
  const secondAccountId = new ObjectId().toHexString();
  let database: Db;
  let profileRepository: UserProfileRepository;
  let sourceRepositories: Readonly<Record<FinancialEngineSourceSection, ManualRecordRepository>>;
  let sourceManifestRepository: ReturnType<typeof financialSnapshotRepositoryForDatabase>;
  let engineRepository: ReturnType<typeof financialEngineSnapshotRepositoryForDatabase>;
  let forecastRepository: ReturnType<typeof forecastRepositoryForDatabase>;
  let budgetRepository: BudgetRepository;
  let intelligenceRepository: TransactionIntelligenceRepository;
  let transactionRepository: ManualRecordRepository;
  let dependencies: ForecastDependencies;

  function transaction(
    accountId: string,
    amount: string,
    currency: string,
    date: string,
    merchant: string,
    category: TransactionFields["category"] = "other",
  ): TransactionFields {
    return {
      accountId,
      amount: { amountMinor: BigInt(amount), currency } as TransactionFields["amount"],
      category,
      confidenceBps: 10_000,
      date,
      destinationAccountId: null,
      merchant,
      notes: null,
      recurring: false,
      refundOfTransactionId: null,
      type: "expense",
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    sourceRepositories = Object.fromEntries(
      financialEngineSourceSections.map((section) => [
        section,
        manualRecordRepositoryForDatabase(database, section),
      ]),
    ) as unknown as Readonly<Record<FinancialEngineSourceSection, ManualRecordRepository>>;
    sourceManifestRepository = financialSnapshotRepositoryForDatabase(database);
    engineRepository = financialEngineSnapshotRepositoryForDatabase(database);
    forecastRepository = forecastRepositoryForDatabase(database, () => new Date("2026-09-01T12:00:00.000Z"));
    budgetRepository = budgetRepositoryForDatabase(database);
    intelligenceRepository = transactionIntelligenceRepositoryForDatabase(database, () => new Date("2026-09-01T12:00:00.000Z"));
    transactionRepository = sourceRepositories.transactions;
    await Promise.all([
      profileRepository.ensureIndexes(),
      sourceManifestRepository.ensureIndexes(),
      engineRepository.ensureIndexes(),
      forecastRepository.ensureIndexes(),
      budgetRepository.ensureIndexes(),
      intelligenceRepository.ensureIndexes(),
      ...Object.values(sourceRepositories).map((repository) => repository.ensureIndexes()),
    ]);
    await saveProfile(firstActor, {
      countryCode: "IL", displayName: "Forecast owner", expectedVersion: null,
      householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem",
    }, { repository: profileRepository });
    await saveProfile(secondActor, {
      countryCode: "US", displayName: "Other owner", expectedVersion: null,
      householdType: "single", primaryCurrency: "USD", timeZone: "America/New_York",
    }, { repository: profileRepository });
    await createManualRecord(firstActor, "accounts", {
      balance: { amount: "10000", currency: "ILS" }, name: "Primary", type: "bank",
    }, randomUUID(), { profileRepository, repository: sourceRepositories.accounts });
    await createManualRecord(firstActor, "safety_margin", {
      amount: { amount: "1500", currency: "ILS" }, kind: "fixed",
    }, randomUUID(), { profileRepository, repository: sourceRepositories.safety_margin });
    await createManualRecord(secondActor, "accounts", {
      balance: { amount: "987654.32", currency: "USD" }, name: "Private foreign", type: "bank",
    }, randomUUID(), { profileRepository, repository: sourceRepositories.accounts });
    let latestPatternTransactionId = "";
    for (const transactionDate of [
      "2026-03-01", "2026-04-01", "2026-05-01",
      "2026-06-01", "2026-07-01", "2026-08-01",
    ]) {
      const created = await transactionRepository.createForActor(
        firstActor,
        transaction(firstAccountId, "12500", "ILS", transactionDate, "Netflix"),
        randomUUID(),
      );
      latestPatternTransactionId = created.id;
    }
    await createBudgetCorrection(firstActor, {
      idempotencyKey: randomUUID(),
      reason: "אישור סיווג מנוי לצורך תחזית",
      toCategoryId: "system:subscriptions",
      transactionId: latestPatternTransactionId,
    }, {
      budgetRepository,
      sourceRepositories: { transactions: transactionRepository },
    });
    await transactionRepository.createForActor(
      secondActor,
      transaction(secondAccountId, "98765432", "USD", "2026-08-01", "Private provider text"),
      randomUUID(),
    );
    await database.collection("householdResourceShares").insertOne({
      _id: new ObjectId(),
      householdId: new ObjectId(),
      resourceId: new ObjectId(secondAccountId),
      resourceOwnerId: new ObjectId(secondActor.userId),
      status: "active",
      userId: new ObjectId(secondActor.userId),
    });
    await calculateFinancialEngineSnapshot(firstActor, {
      asOf: "2026-09-01T09:00:00.000Z",
      horizonDays: 90,
      idempotencyKey: randomUUID(),
    }, { engineRepository, now: () => new Date("2026-09-01T09:00:00.000Z"), profileRepository, sourceManifestRepository, sourceRepositories });
    dependencies = {
      engineRepository,
      forecastRepository,
      freshness: {
        manifestRepository: sourceManifestRepository,
        now: () => new Date("2026-09-01T12:00:00.000Z"),
        sourceRepositories,
      },
      profileRepository,
      transactionIntelligence: {
        budgetRepository,
        repository: intelligenceRepository,
        transactionRepository,
      },
    };
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("persists an exact immutable owner-scoped operational forecast", async () => {
    const reviewedRun = await runTransactionIntelligence(
      firstActor,
      randomUUID(),
      dependencies.transactionIntelligence,
    );
    const reviewedSignal = reviewedRun.signals.find(
      (signal) => signal.kind === "subscription_candidate",
    )!;
    await reviewTransactionIntelligenceSignal(firstActor, {
      decision: "confirmed",
      expectedDecision: null,
      idempotencyKey: randomUUID(),
      runId: reviewedRun.id,
      signalId: reviewedSignal.id,
    }, dependencies.transactionIntelligence);
    const idempotencyKey = randomUUID();
    const created = await createOperationalForecast(firstActor, {
      horizonDays: 30,
      idempotencyKey,
    }, dependencies);
    expect(created.result).toMatchObject({
      confidence: "HIGH",
      currency: "ILS",
      dataFreshness: "FRESH",
      horizonDays: 30,
    });
    expect(created.result.events.some((event) => event.source === "phase_10_recurrence")).toBe(true);
    expect(created.result.events.find((event) => event.source === "phase_10_recurrence")?.provenance.reviewed).toBe(true);
    const intelligence = await database.collection("transactionIntelligenceRuns").findOne({ _id: new ObjectId(created.intelligenceRunId!) });
    expect(intelligence?.signals.some((signal: { kind: string }) => signal.kind === "subscription_candidate")).toBe(true);
    const stored = await database.collection("forecastSnapshots").findOne({ _id: new ObjectId(created.id) });
    expect(stored?.userId).toEqual(new ObjectId(firstActor.userId));
    expect(stored?.result.projectedEndBalance.amountMinor).toBeInstanceOf(Long);
    expect(stored?.result.events[0]?.amount.amountMinor).toBeInstanceOf(Long);
    expect(stored?.sourceSnapshotId).toBeInstanceOf(ObjectId);
    expect(stored?.intelligenceRunId).toBeInstanceOf(ObjectId);
    expect(stored).not.toHaveProperty("bankConnectionId");
    const retry = await createOperationalForecast(firstActor, {
      horizonDays: 30,
      idempotencyKey,
    }, dependencies);
    expect(retry.id).toBe(created.id);
    await expect(createOperationalForecast(firstActor, {
      horizonDays: 60,
      idempotencyKey,
    }, dependencies)).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps direct IDs, two users, and household-shared private data isolated", async () => {
    const firstCenter = await loadForecastCenter(firstActor, dependencies);
    const secondCenter = await loadForecastCenter(secondActor, dependencies);
    expect(firstCenter.forecasts).toHaveLength(1);
    expect(secondCenter.forecasts).toHaveLength(0);
    expect(await forecastRepository.findForecastForActor(secondActor, firstCenter.forecasts[0]!.id)).toBeNull();
    expect(JSON.stringify(firstCenter)).not.toContain("98765432");
    expect(JSON.stringify(firstCenter)).not.toContain(secondActor.userId);
    expect(JSON.stringify(firstCenter)).not.toContain("Private provider text");
  });

  it("persists explicit scenarios separately without financial mutation", async () => {
    const center = await loadForecastCenter(firstActor, dependencies);
    const forecastId = center.forecasts[0]!.id;
    const beforeCounts = await Promise.all([
      database.collection("accounts").countDocuments(),
      database.collection("transactions").countDocuments(),
      database.collection("budgetPeriods").countDocuments(),
      database.collection("goalProgress").countDocuments(),
      database.collection("financialSnapshots").countDocuments(),
    ]);
    const scenario = await createForecastScenario(firstActor, {
      adjustments: [{
        amount: { amount: "123.45", currency: "ILS" },
        calendarDate: "2026-09-10",
        kind: "additional_income",
      }],
      forecastId,
      idempotencyKey: randomUUID(),
      name: "תרחיש בדיקה",
      note: null,
    }, dependencies);
    expect(scenario.result.projectedEndDelta.amountMinor).toBe(12_345n);
    const stored = await database.collection("forecastScenarios").findOne({ _id: new ObjectId(scenario.id) });
    expect(stored?.result.adjustments[0]?.amount.amountMinor).toBeInstanceOf(Long);
    expect(stored?.userId).toEqual(new ObjectId(firstActor.userId));
    expect(await Promise.all([
      database.collection("accounts").countDocuments(),
      database.collection("transactions").countDocuments(),
      database.collection("budgetPeriods").countDocuments(),
      database.collection("goalProgress").countDocuments(),
      database.collection("financialSnapshots").countDocuments(),
    ])).toEqual(beforeCounts);
    await expect(createForecastScenario(secondActor, {
      adjustments: [{
        amount: { amount: "1", currency: "USD" },
        calendarDate: "2026-09-10",
        kind: "additional_income",
      }],
      forecastId,
      idempotencyKey: randomUUID(),
      name: "Foreign",
      note: null,
    }, dependencies)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps Phase 9 blocked and creates no Open Banking provenance", async () => {
    const names = (await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name);
    expect(names).not.toContain("bankConnections");
    expect(names).not.toContain("bankSyncRuns");
    expect(names).not.toContain("openBankingConnections");
  });
});
