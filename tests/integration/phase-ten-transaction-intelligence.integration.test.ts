import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import {
  budgetRepositoryForDatabase,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import { money } from "@/lib/domain/money/money";
import { ConflictError, InputValidationError } from "@/lib/errors/application-error";
import type { ManualFields } from "@/lib/onboarding/manual-record";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  transactionIntelligenceRepositoryForDatabase,
  type TransactionIntelligenceRepository,
} from "@/lib/transaction-intelligence/transaction-intelligence-repository";
import {
  loadLatestTransactionIntelligence,
  reviewTransactionIntelligenceSignal,
  runTransactionIntelligence,
  type TransactionIntelligenceDependencies,
} from "@/lib/transaction-intelligence/transaction-intelligence-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

type TransactionRecordFields = Extract<
  ManualFields,
  Readonly<{
    confidenceBps: number;
    refundOfTransactionId: string | null;
    recurring: boolean;
  }>
>;

describeWithMongo("Phase 10 transaction intelligence persistence and isolation", () => {
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
  const accountId = new ObjectId().toHexString();
  let database: Db;
  let budgetRepository: BudgetRepository;
  let intelligenceRepository: TransactionIntelligenceRepository;
  let transactionRepository: ManualRecordRepository;
  let candidateTransactionId: string;
  let runId: string;
  let categorySignalId: string;

  function dependencies(
    overrides: Partial<TransactionIntelligenceDependencies> = {},
  ): TransactionIntelligenceDependencies {
    return {
      budgetRepository,
      repository: intelligenceRepository,
      transactionRepository,
      ...overrides,
    };
  }

  function expense(
    merchant: string,
    date: string,
    category: TransactionRecordFields["category"],
    amountMinor = 1_000n,
  ): TransactionRecordFields {
    return {
      accountId,
      amount: money(amountMinor, "ILS"),
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
    budgetRepository = budgetRepositoryForDatabase(database);
    intelligenceRepository = transactionIntelligenceRepositoryForDatabase(
      database,
      () => new Date("2026-09-01T12:00:00.000Z"),
    );
    transactionRepository = manualRecordRepositoryForDatabase(
      database,
      "transactions",
    );
    await Promise.all([
      budgetRepository.ensureIndexes(),
      intelligenceRepository.ensureIndexes(),
      transactionRepository.ensureIndexes(),
    ]);

    await transactionRepository.createForActor(
      firstActor,
      expense("Netflix", "2026-06-01", "subscriptions"),
      randomUUID(),
    );
    await transactionRepository.createForActor(
      firstActor,
      expense("NETFLIX.COM", "2026-07-01", "subscriptions"),
      randomUUID(),
    );
    const candidate = await transactionRepository.createForActor(
      firstActor,
      expense("Netflix 123", "2026-08-01", "other"),
      randomUUID(),
    );
    candidateTransactionId = candidate.id;
    await transactionRepository.createForActor(
      secondActor,
      {
        ...expense("Other owner merchant", "2026-08-01", "other"),
        accountId: new ObjectId().toHexString(),
        amount: money(5_000n, "USD"),
      },
      randomUUID(),
    );
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("creates an immutable deterministic run with exact BSON evidence", async () => {
    const idempotencyKey = randomUUID();
    const view = await runTransactionIntelligence(
      firstActor,
      idempotencyKey,
      dependencies(),
    );
    runId = view.id;
    const categorySignal = view.signals.find(
      (signal) => signal.kind === "category_suggestion",
    );
    expect(categorySignal).toMatchObject({
      confidenceBps: 9_500,
      currentDecision: null,
      normalizedMerchant: "Netflix",
      suggestedCategoryId: "system:subscriptions",
    });
    categorySignalId = categorySignal!.id;
    expect(view.signals.some((signal) => signal.kind === "subscription_candidate"))
      .toBe(true);

    const stored = await database
      .collection("transactionIntelligenceRuns")
      .findOne({ _id: new ObjectId(view.id) });
    expect(stored?.userId).toEqual(new ObjectId(firstActor.userId));
    expect(stored?.engineVersion).toBe("transaction-intelligence-v1");
    expect(stored?.signals[0]?.amount.amountMinor).toBeInstanceOf(Long);
    expect(stored).not.toHaveProperty("bankConnectionId");
    expect(stored).not.toHaveProperty("providerAccountId");

    const retry = await runTransactionIntelligence(
      firstActor,
      idempotencyKey,
      dependencies(),
    );
    expect(retry.id).toBe(view.id);
    expect(
      await database.collection("transactionIntelligenceRuns").countDocuments({
        userId: new ObjectId(firstActor.userId),
      }),
    ).toBe(1);
  });

  it("keeps runs and reviews strictly isolated by server-derived actor", async () => {
    expect(
      await loadLatestTransactionIntelligence(secondActor, dependencies()),
    ).toBeNull();
    expect(
      await intelligenceRepository.findRunForActor(secondActor, runId),
    ).toBeNull();
    await expect(
      reviewTransactionIntelligenceSignal(
        secondActor,
        {
          decision: "confirmed",
          expectedDecision: null,
          idempotencyKey: randomUUID(),
          runId,
          signalId: categorySignalId,
        },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("confirms category only through immutable correction evidence", async () => {
    const before = await database
      .collection("transactions")
      .findOne({ _id: new ObjectId(candidateTransactionId) });
    const idempotencyKey = randomUUID();
    const reviewed = await reviewTransactionIntelligenceSignal(
      firstActor,
      {
        decision: "confirmed",
        expectedDecision: null,
        idempotencyKey,
        runId,
        signalId: categorySignalId,
      },
      dependencies(),
    );
    expect(
      reviewed.signals.find((signal) => signal.id === categorySignalId)
        ?.currentDecision,
    ).toBe("confirmed");

    const after = await database
      .collection("transactions")
      .findOne({ _id: new ObjectId(candidateTransactionId) });
    expect(after?.fields).toEqual(before?.fields);
    expect(after?.version).toBe(before?.version);
    const corrections = await budgetRepository.listCorrectionsForActor(
      firstActor,
      [candidateTransactionId],
    );
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      fromCategoryId: "system:other",
      toCategoryId: "system:subscriptions",
      transactionId: candidateTransactionId,
    });

    const retry = await reviewTransactionIntelligenceSignal(
      firstActor,
      {
        decision: "confirmed",
        expectedDecision: null,
        idempotencyKey,
        runId,
        signalId: categorySignalId,
      },
      dependencies(),
    );
    expect(
      retry.signals.find((signal) => signal.id === categorySignalId)
        ?.currentDecision,
    ).toBe("confirmed");
    expect(
      await database.collection("transactionIntelligenceReviews").countDocuments({
        userId: new ObjectId(firstActor.userId),
      }),
    ).toBe(1);
  });

  it("supports append-only dismiss and reopen review evidence", async () => {
    const run = await intelligenceRepository.findRunForActor(firstActor, runId);
    const subscription = run?.signals.find(
      (signal) => signal.kind === "subscription_candidate",
    );
    expect(subscription).toBeDefined();
    await reviewTransactionIntelligenceSignal(
      firstActor,
      {
        decision: "dismissed",
        expectedDecision: null,
        idempotencyKey: randomUUID(),
        runId,
        signalId: subscription!.id,
      },
      dependencies(),
    );
    const reopened = await reviewTransactionIntelligenceSignal(
      firstActor,
      {
        decision: "reopened",
        expectedDecision: "dismissed",
        idempotencyKey: randomUUID(),
        runId,
        signalId: subscription!.id,
      },
      dependencies(),
    );
    expect(
      reopened.signals.find((signal) => signal.id === subscription!.id)
        ?.currentDecision,
    ).toBe("reopened");
    const reviews = await intelligenceRepository.listReviewsForActor(
      firstActor,
      runId,
    );
    expect(
      reviews.filter((review) => review.signalId === subscription!.id).map(
        (review) => [review.sequence, review.decision],
      ),
    ).toEqual([
      [1, "dismissed"],
      [2, "reopened"],
    ]);
  });

  it("fails safely before persistence when the analysis engine is unavailable", async () => {
    const runCount = await database
      .collection("transactionIntelligenceRuns")
      .countDocuments({ userId: new ObjectId(firstActor.userId) });
    const transactionCount = await database
      .collection("transactions")
      .countDocuments({ userId: new ObjectId(firstActor.userId) });
    await expect(
      runTransactionIntelligence(firstActor, randomUUID(), dependencies({
        analyze: () => {
          throw new Error("deterministic classifier unavailable");
        },
      })),
    ).rejects.toThrow("deterministic classifier unavailable");
    expect(
      await database.collection("transactionIntelligenceRuns").countDocuments({
        userId: new ObjectId(firstActor.userId),
      }),
    ).toBe(runCount);
    expect(
      await database.collection("transactions").countDocuments({
        userId: new ObjectId(firstActor.userId),
      }),
    ).toBe(transactionCount);
  });

  it("uses owner-first indexes and detects stale idempotency after confirmed facts change", async () => {
    const runIndexes = await database
      .collection("transactionIntelligenceRuns")
      .indexes();
    const reviewIndexes = await database
      .collection("transactionIntelligenceReviews")
      .indexes();
    for (const index of [...runIndexes, ...reviewIndexes].filter(
      (item) => item.name !== "_id_",
    )) {
      expect(Object.keys(index.key ?? {})[0]).toBe("userId");
    }

    const staleKey = randomUUID();
    await runTransactionIntelligence(firstActor, staleKey, dependencies());
    await transactionRepository.createForActor(
      firstActor,
      expense("New source fact", "2026-08-10", "other"),
      randomUUID(),
    );
    await expect(
      runTransactionIntelligence(firstActor, staleKey, dependencies()),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
