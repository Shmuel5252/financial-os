import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { budgetRepositoryForDatabase, type BudgetRepository } from "@/lib/budgets/budget-repository";
import { closeBudgetPeriod, loadBudgetView, saveBudgetPeriod } from "@/lib/budgets/budget-service";
import { money } from "@/lib/domain/money/money";
import { ConflictError, InputValidationError } from "@/lib/errors/application-error";
import { buildFinancialDataExport } from "@/lib/financial-data/financial-data-export-service";
import {
  financialEngineSourceSections,
  type FinancialEngineSourceSection,
} from "@/lib/financial-engine/financial-engine-input";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { calculateFinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot-service";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import type { GoalDefinitionConfiguration } from "@/lib/goals/goal";
import { goalRepositoryForDatabase, type GoalRepository } from "@/lib/goals/goal-repository";
import { netWorthRepositoryForDatabase } from "@/lib/net-worth/net-worth-repository";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import {
  createGoalDefinition,
  evaluateGoal,
  loadGoalCenterView,
  type GoalDependencies,
} from "@/lib/goals/goal-service";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  createManualRecord,
  deleteManualRecord,
  updateManualRecord,
} from "@/lib/onboarding/manual-record-service";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { purchaseSimulationRepositoryForDatabase } from "@/lib/purchase-simulations/purchase-simulation-repository";
import { transactionIntelligenceRepositoryForDatabase } from "@/lib/transaction-intelligence/transaction-intelligence-repository";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

type GoalKind = GoalDefinitionConfiguration["kind"];

describeWithMongo("Phase 6 deterministic Goal Engine persistence", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(
    testUri ?? "mongodb://integration-test-not-configured",
    { promoteLongs: false },
  );
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  let database: Db;
  let profileRepository: UserProfileRepository;
  let budgetRepository: BudgetRepository;
  let goalRepository: GoalRepository;
  let engineRepository: ReturnType<typeof financialEngineSnapshotRepositoryForDatabase>;
  let sourceManifestRepository: ReturnType<typeof financialSnapshotRepositoryForDatabase>;
  let engineSources: Readonly<Record<FinancialEngineSourceSection, ManualRecordRepository>>;
  let goalsRepository: ManualRecordRepository;
  let primaryAccountId: string;
  let overdraftAccountId: string;
  let debtLoanId: string;
  let creditLoanId: string;
  let cardId: string;
  let liquidSavingId: string;
  const trackedGoals = new Map<GoalKind, string>();

  function dependencies(now: string): GoalDependencies {
    return {
      budgetRepository,
      budgetViewLoader: (actor, month) => loadBudgetView(actor, month, {
        budgetRepository,
        engineRepository,
        now: () => new Date(now),
        profileRepository,
        sourceRepositories: engineSources,
      }),
      engineRepository,
      goalRepository,
      now: () => new Date(now),
      profileRepository,
      sourceRepositories: {
        accounts: engineSources.accounts,
        cards: engineSources.cards,
        goals: goalsRepository,
        loans: engineSources.loans,
        savings: engineSources.savings,
      },
    };
  }

  async function createGoal(kind: GoalKind, target = "1000") {
    const goal = await createManualRecord(firstActor, "goals", {
      currentValue: { amount: "250", currency: "ILS" },
      priority: trackedGoals.size + 1 > 5 ? 5 : trackedGoals.size + 1,
      startingValue: { amount: "100", currency: "ILS" },
      targetAmount: { amount: target, currency: "ILS" },
      targetDate: "2026-12-31",
      title: `Goal ${kind}`,
      type: kind,
    }, randomUUID(), { profileRepository, repository: goalsRepository });
    trackedGoals.set(kind, goal.id);
    return goal;
  }

  async function activate(
    goalId: string,
    configuration: GoalDefinitionConfiguration,
    now = "2026-09-02T09:00:00.000Z",
  ) {
    return createGoalDefinition(firstActor, {
      configuration,
      expectedDefinitionVersion: null,
      expectedGoalRecordVersion: 1,
      goalId,
      idempotencyKey: randomUUID(),
      targetDate: "2026-12-31",
    }, dependencies(now));
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    budgetRepository = budgetRepositoryForDatabase(database);
    goalRepository = goalRepositoryForDatabase(database);
    engineRepository = financialEngineSnapshotRepositoryForDatabase(database);
    sourceManifestRepository = financialSnapshotRepositoryForDatabase(database);
    engineSources = Object.fromEntries(
      financialEngineSourceSections.map((section) => [
        section,
        manualRecordRepositoryForDatabase(database, section),
      ]),
    ) as unknown as Readonly<Record<FinancialEngineSourceSection, ManualRecordRepository>>;
    goalsRepository = manualRecordRepositoryForDatabase(database, "goals");

    await Promise.all([
      profileRepository.ensureIndexes(),
      budgetRepository.ensureIndexes(),
      goalRepository.ensureIndexes(),
      engineRepository.ensureIndexes(),
      sourceManifestRepository.ensureIndexes(),
      goalsRepository.ensureIndexes(),
      ...Object.values(engineSources).map((repository) => repository.ensureIndexes()),
    ]);
    await saveProfile(firstActor, {
      countryCode: "IL",
      displayName: "Goal owner",
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

    const primary = await createManualRecord(firstActor, "accounts", {
      balance: { amount: "10000", currency: "ILS" },
      name: "Primary",
      type: "bank",
    }, randomUUID(), { profileRepository, repository: engineSources.accounts });
    primaryAccountId = primary.id;
    const overdraft = await createManualRecord(firstActor, "accounts", {
      balance: { amount: "-1000", currency: "ILS" },
      name: "Overdraft",
      type: "bank",
    }, randomUUID(), { profileRepository, repository: engineSources.accounts });
    overdraftAccountId = overdraft.id;
    const debt = await createManualRecord(firstActor, "loans", {
      annualInterestRateBps: 500,
      endDate: null,
      monthlyPayment: { amount: "100", currency: "ILS" },
      name: "Debt",
      nextPaymentDate: "2026-08-20",
      originalAmount: { amount: "1000", currency: "ILS" },
      remainingBalance: { amount: "1000", currency: "ILS" },
    }, randomUUID(), { profileRepository, repository: engineSources.loans });
    debtLoanId = debt.id;
    const creditLoan = await createManualRecord(firstActor, "loans", {
      annualInterestRateBps: 0,
      endDate: null,
      monthlyPayment: { amount: "1", currency: "ILS" },
      name: "Credit dependence scope",
      nextPaymentDate: "2027-01-20",
      originalAmount: { amount: "1", currency: "ILS" },
      remainingBalance: { amount: "0", currency: "ILS" },
    }, randomUUID(), { profileRepository, repository: engineSources.loans });
    creditLoanId = creditLoan.id;
    const card = await createManualRecord(firstActor, "cards", {
      billingDay: 15,
      issuer: "Issuer",
      limit: { amount: "5000", currency: "ILS" },
      name: "Card",
      used: { amount: "0", currency: "ILS" },
    }, randomUUID(), { profileRepository, repository: engineSources.cards });
    cardId = card.id;
    const saving = await createManualRecord(firstActor, "savings", {
      accountIdentifierLast4: "1234",
      availability: "liquid",
      balance: { amount: "600", currency: "ILS" },
      institution: "Bank",
      maturityDate: null,
      name: "Emergency reserve",
    }, randomUUID(), { profileRepository, repository: engineSources.savings });
    liquidSavingId = saving.id;
    await createManualRecord(firstActor, "income", {
      amount: { amount: "2000", currency: "ILS" },
      certaintyBps: 10_000,
      destination: "bank_account",
      expectedDate: "2026-08-10",
      frequency: "one_time",
      name: "Confirmed income",
    }, randomUUID(), { profileRepository, repository: engineSources.income });
    await createManualRecord(firstActor, "safety_margin", {
      amount: { amount: "0", currency: "ILS" },
      kind: "fixed",
    }, randomUUID(), { profileRepository, repository: engineSources.safety_margin });
    await createManualRecord(firstActor, "transactions", {
      accountId: primary.id,
      amount: { amount: "200", currency: "ILS" },
      category: "food",
      confidenceBps: 10_000,
      date: "2026-08-05",
      destinationAccountId: null,
      merchant: "Market",
      notes: null,
      recurring: false,
      type: "expense",
    }, randomUUID(), {
      accountRepository: engineSources.accounts,
      profileRepository,
      repository: engineSources.transactions,
    });

    await calculateFinancialEngineSnapshot(firstActor, {
      asOf: "2026-08-01T09:00:00.000Z",
      horizonDays: 30,
      idempotencyKey: randomUUID(),
    }, {
      engineRepository,
      profileRepository,
      sourceManifestRepository,
      sourceRepositories: engineSources,
    });
    const savedBudget = await saveBudgetPeriod(firstActor, {
      allocations: [{ amount: money(500_00n, "ILS"), categoryId: "system:food" }],
      calendarMonth: "2026-08",
      expectedVersion: null,
    }, {
      budgetRepository,
      engineRepository,
      now: () => new Date("2026-08-31T09:00:00.000Z"),
      profileRepository,
      sourceRepositories: engineSources,
    });
    if (savedBudget.period.version === null) {
      throw new Error("Expected the persisted budget period to have a version.");
    }
    await closeBudgetPeriod(firstActor, {
      calendarMonth: "2026-08",
      expectedVersion: savedBudget.period.version,
    }, {
      budgetRepository,
      engineRepository,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
      profileRepository,
      sourceRepositories: engineSources,
    });
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("activates every canonical metric without converting manual evidence into verified truth", async () => {
    const debt = await createGoal("debt_free");
    const overdraft = await createGoal("no_overdraft");
    const credit = await createGoal("no_credit_dependency");
    const emergency = await createGoal("emergency_fund", "600");
    const savings = await createGoal("savings_target", "600");
    const spending = await createGoal("monthly_spending", "300");
    const custom = await createGoal("custom");

    const results = await Promise.all([
      activate(debt.id, { kind: "debt_free", liabilityIds: [debtLoanId] }),
      activate(overdraft.id, { accountIds: [overdraftAccountId], kind: "no_overdraft", sustainedSuccessDays: 30 }),
      activate(credit.id, {
        accountIds: [primaryAccountId],
        cardIds: [cardId],
        horizonDays: 30,
        kind: "no_credit_dependency",
        liabilityIds: [creditLoanId],
        sustainedSuccessDays: 30,
      }),
      activate(emergency.id, {
        fundScope: { recordIds: [liquidSavingId], source: "savings" },
        kind: "emergency_fund",
        targetBasis: {
          essentialCategoryIds: ["system:food"],
          kind: "months_of_essential_expenses",
          months: 3,
        },
      }),
      activate(savings.id, {
        fundScope: { recordIds: [liquidSavingId], source: "savings" },
        kind: "savings_target",
        targetAmount: money(600_00n, "ILS"),
      }),
      activate(spending.id, {
        categoryIds: ["system:food"],
        kind: "monthly_spending",
        spendingCeiling: money(300_00n, "ILS"),
      }, "2026-08-31T09:00:00.000Z"),
      activate(custom.id, {
        direction: "increase",
        kind: "custom",
        metricLabel: "Manual metric",
        targetAmount: money(1000_00n, "ILS"),
      }),
    ]);

    const byKind = new Map(results.map((result) => [result.definition.configuration.kind, result]));
    expect(byKind.get("debt_free")?.progress.result.currentValue.amountMinor).toBe(1000_00n);
    expect(byKind.get("no_overdraft")?.progress.result.currentValue.amountMinor).toBe(-1000_00n);
    expect(byKind.get("no_credit_dependency")?.progress.result.status).toBe("target_reached_pending_confirmation");
    expect(byKind.get("emergency_fund")?.progress.result.targetValue.amountMinor).toBe(600_00n);
    expect(byKind.get("emergency_fund")?.progress.sourceReferences.some((source) => source.kind === "budget_period")).toBe(true);
    expect(byKind.get("savings_target")?.progress.result.status).toBe("completed");
    expect(byKind.get("monthly_spending")?.progress.result.currentValue.amountMinor).toBe(200_00n);
    expect(byKind.get("monthly_spending")?.progress.result.status).toBe("completed");
    expect(byKind.get("custom")?.progress.result.verification).toBe("manual_unverified");
    expect(byKind.get("debt_free")?.definition.reportedEvidence.startingValue.amountMinor).toBe(100_00n);
    expect(byKind.get("debt_free")?.progress.result.baselineValue.amountMinor).toBe(1000_00n);
  });

  it("records direction-aware milestones, completion, regression, and sustained reopening immutably", async () => {
    const debtGoalId = trackedGoals.get("debt_free")!;
    const originalDebt = await engineSources.loans.findForActor(firstActor, debtLoanId);
    expect(originalDebt).not.toBeNull();
    await updateManualRecord(firstActor, "loans", debtLoanId, originalDebt!.version, {
      ...originalDebt!.fields,
      monthlyPayment: { amount: "100", currency: "ILS" },
      originalAmount: { amount: "1000", currency: "ILS" },
      remainingBalance: { amount: "500", currency: "ILS" },
    }, { profileRepository, repository: engineSources.loans });
    const halfway = await evaluateGoal(firstActor, {
      goalId: debtGoalId,
      idempotencyKey: randomUUID(),
    }, dependencies("2026-09-10T09:00:00.000Z"));
    expect(halfway.result.normalizedProgressBasisPoints).toBe(5_000);
    expect(halfway.milestonesCrossed).toEqual([2_500, 5_000]);

    const halfDebt = await engineSources.loans.findForActor(firstActor, debtLoanId);
    await updateManualRecord(firstActor, "loans", debtLoanId, halfDebt!.version, {
      ...halfDebt!.fields,
      monthlyPayment: { amount: "100", currency: "ILS" },
      originalAmount: { amount: "1000", currency: "ILS" },
      remainingBalance: { amount: "0", currency: "ILS" },
    }, { profileRepository, repository: engineSources.loans });
    const completed = await evaluateGoal(firstActor, {
      goalId: debtGoalId,
      idempotencyKey: randomUUID(),
    }, dependencies("2026-09-20T09:00:00.000Z"));
    expect(completed.result.status).toBe("completed");
    expect(completed.milestonesCrossed).toEqual([7_500, 10_000]);

    const clearedDebt = await engineSources.loans.findForActor(firstActor, debtLoanId);
    await updateManualRecord(firstActor, "loans", debtLoanId, clearedDebt!.version, {
      ...clearedDebt!.fields,
      monthlyPayment: { amount: "100", currency: "ILS" },
      originalAmount: { amount: "1000", currency: "ILS" },
      remainingBalance: { amount: "200", currency: "ILS" },
    }, { profileRepository, repository: engineSources.loans });
    const regressed = await evaluateGoal(firstActor, {
      goalId: debtGoalId,
      idempotencyKey: randomUUID(),
    }, dependencies("2026-09-25T09:00:00.000Z"));
    expect(regressed.result.status).toBe("regressed");
    expect(regressed.result.completedAt).toBe(completed.result.completedAt);

    const overdraftGoalId = trackedGoals.get("no_overdraft")!;
    const overdraft = await engineSources.accounts.findForActor(firstActor, overdraftAccountId);
    await updateManualRecord(firstActor, "accounts", overdraftAccountId, overdraft!.version, {
      ...overdraft!.fields,
      balance: { amount: "100", currency: "ILS" },
    }, { profileRepository, repository: engineSources.accounts });
    const pending = await evaluateGoal(firstActor, {
      goalId: overdraftGoalId,
      idempotencyKey: randomUUID(),
    }, dependencies("2026-09-03T09:00:00.000Z"));
    const stable = await evaluateGoal(firstActor, {
      goalId: overdraftGoalId,
      idempotencyKey: randomUUID(),
    }, dependencies("2026-10-03T09:00:00.000Z"));
    expect(pending.result.status).toBe("target_reached_pending_confirmation");
    expect(stable.result.status).toBe("completed");
    expect(stable.result.qualifiedSince).toBe("2026-09-03");
  });

  it("versions material definitions while protecting tracked source history", async () => {
    const goalId = trackedGoals.get("debt_free")!;
    const existingGoal = await goalsRepository.findForActor(firstActor, goalId);
    expect(existingGoal).not.toBeNull();
    const presentationOnly = await updateManualRecord(firstActor, "goals", goalId, existingGoal!.version, {
      ...existingGoal!.fields,
      currentValue: { amount: "250", currency: "ILS" },
      startingValue: { amount: "100", currency: "ILS" },
      targetAmount: { amount: "1000", currency: "ILS" },
      title: "Renamed goal",
    }, {
      goalTrackingRepository: goalRepository,
      profileRepository,
      repository: goalsRepository,
    });
    expect(presentationOnly.version).toBe(2);
    await expect(updateManualRecord(firstActor, "goals", goalId, presentationOnly.version, {
      ...presentationOnly.fields,
      currentValue: { amount: "300", currency: "ILS" },
      startingValue: { amount: "100", currency: "ILS" },
      targetAmount: { amount: "1000", currency: "ILS" },
    }, {
      goalTrackingRepository: goalRepository,
      profileRepository,
      repository: goalsRepository,
    })).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteManualRecord(firstActor, "goals", goalId, presentationOnly.version, {
      goalTrackingRepository: goalRepository,
      profileRepository,
      repository: goalsRepository,
    })).rejects.toBeInstanceOf(ConflictError);

    const extraLoan = await createManualRecord(firstActor, "loans", {
      annualInterestRateBps: 0,
      endDate: null,
      monthlyPayment: { amount: "1", currency: "ILS" },
      name: "Added scope",
      nextPaymentDate: "2027-01-20",
      originalAmount: { amount: "1", currency: "ILS" },
      remainingBalance: { amount: "1", currency: "ILS" },
    }, randomUUID(), { profileRepository, repository: engineSources.loans });
    const versioned = await createGoalDefinition(firstActor, {
      configuration: { kind: "debt_free", liabilityIds: [debtLoanId, extraLoan.id] },
      expectedDefinitionVersion: 1,
      expectedGoalRecordVersion: presentationOnly.version,
      goalId,
      idempotencyKey: randomUUID(),
      targetDate: "2026-12-31",
    }, dependencies("2026-10-04T09:00:00.000Z"));
    expect(versioned.definition.version).toBe(2);
    expect(versioned.progress.reason).toBe("material_version_created");
    const firstVersionHistory = await goalRepository.listProgressForActor(firstActor, goalId, 1);
    expect(firstVersionHistory.length).toBeGreaterThanOrEqual(4);
    expect(firstVersionHistory.every((entry) => entry.goalVersion === 1)).toBe(true);
  });

  it("enforces server-derived ownership, idempotency, BSON int64 money, and owner-first indexes", async () => {
    const firstGoalId = trackedGoals.get("savings_target")!;
    expect(await goalRepository.findLatestDefinitionForActor(secondActor, firstGoalId)).toBeNull();
    expect(await goalRepository.listProgressForActor(secondActor, firstGoalId, 1)).toEqual([]);

    const secondGoal = await createManualRecord(secondActor, "goals", {
      currentValue: { amount: "0", currency: "USD" },
      priority: 1,
      startingValue: { amount: "0", currency: "USD" },
      targetAmount: { amount: "1", currency: "USD" },
      targetDate: null,
      title: "Other debt",
      type: "debt_free",
    }, randomUUID(), { profileRepository, repository: goalsRepository });
    await expect(createGoalDefinition(secondActor, {
      configuration: { kind: "debt_free", liabilityIds: [debtLoanId] },
      expectedDefinitionVersion: null,
      expectedGoalRecordVersion: secondGoal.version,
      goalId: secondGoal.id,
      idempotencyKey: randomUUID(),
      targetDate: null,
    }, dependencies("2026-10-05T09:00:00.000Z"))).rejects.toBeInstanceOf(InputValidationError);

    const customGoalId = trackedGoals.get("custom")!;
    const key = randomUUID();
    const first = await evaluateGoal(firstActor, {
      goalId: customGoalId,
      idempotencyKey: key,
      manualCurrentValue: money(400_00n, "ILS"),
    }, dependencies("2026-10-05T09:00:00.000Z"));
    const retry = await evaluateGoal(firstActor, {
      goalId: customGoalId,
      idempotencyKey: key,
      manualCurrentValue: money(400_00n, "ILS"),
    }, dependencies("2026-10-05T09:00:00.000Z"));
    expect(retry.id).toBe(first.id);

    const aliasKey = randomUUID();
    const deduplicated = await evaluateGoal(firstActor, {
      goalId: customGoalId,
      idempotencyKey: aliasKey,
      manualCurrentValue: money(400_00n, "ILS"),
    }, dependencies("2026-10-05T09:00:00.000Z"));
    expect(deduplicated.id).toBe(first.id);
    await expect(evaluateGoal(firstActor, {
      goalId: customGoalId,
      idempotencyKey: aliasKey,
      manualCurrentValue: money(401_00n, "ILS"),
    }, dependencies("2026-10-05T09:00:00.000Z"))).rejects.toBeInstanceOf(ConflictError);

    const customDefinition = await goalRepository.findLatestDefinitionForActor(firstActor, customGoalId);
    expect(customDefinition).not.toBeNull();
    const definitionAliasKey = randomUUID();
    const unchangedDefinition = await createGoalDefinition(firstActor, {
      configuration: customDefinition!.configuration,
      expectedDefinitionVersion: customDefinition!.version,
      expectedGoalRecordVersion: 1,
      goalId: customGoalId,
      idempotencyKey: definitionAliasKey,
      targetDate: customDefinition!.targetDate,
    }, dependencies("2026-10-05T09:00:00.000Z"));
    expect(unchangedDefinition.definition.id).toBe(customDefinition!.id);
    expect(unchangedDefinition.progress.id).toBe(first.id);
    await expect(createGoalDefinition(firstActor, {
      configuration: {
        direction: "increase",
        kind: "custom",
        metricLabel: "Changed metric",
        targetAmount: money(1001_00n, "ILS"),
      },
      expectedDefinitionVersion: customDefinition!.version,
      expectedGoalRecordVersion: 1,
      goalId: customGoalId,
      idempotencyKey: definitionAliasKey,
      targetDate: customDefinition!.targetDate,
    }, dependencies("2026-10-05T09:00:00.000Z"))).rejects.toBeInstanceOf(ConflictError);

    for (const collectionName of ["goalDefinitions", "goalProgress", "goalCommandReceipts"]) {
      const indexes = await database.collection(collectionName).indexes();
      const customIndexes = indexes.filter((index) => index.name !== "_id_");
      expect(customIndexes.length).toBeGreaterThan(0);
      expect(customIndexes.every((index) => Object.keys(index.key)[0] === "userId")).toBe(true);
    }
    const rawProgress = await database.collection("goalProgress").findOne({
      userId: new ObjectId(firstActor.userId),
      goalId: new ObjectId(firstGoalId),
    });
    expect(rawProgress?.result.currentValue.amountMinor).toBeInstanceOf(Long);
    expect(rawProgress?.result.targetValue.amountMinor).toBeInstanceOf(Long);

    const center = await loadGoalCenterView(firstActor, dependencies("2026-10-05T09:00:00.000Z"));
    expect(center.goals).toHaveLength(7);
    expect(center.goals.every((item) => item.reported.id !== secondGoal.id)).toBe(true);

    const exported = await buildFinancialDataExport(firstActor, {
      budgetRepository,
      goalRepository,
      netWorthRepository: netWorthRepositoryForDatabase(database),
      notificationRepository: notificationRepositoryForDatabase(database),
      now: () => new Date("2026-10-05T09:00:00.000Z"),
      profileRepository,
      purchaseSimulationRepository:
        purchaseSimulationRepositoryForDatabase(database),
      repositories: { ...engineSources, goals: goalsRepository },
      transactionIntelligenceRepository:
        transactionIntelligenceRepositoryForDatabase(database),
    });
    expect(exported.schemaVersion).toBe(8);
    expect(exported.goalEngine.definitions.length).toBeGreaterThanOrEqual(7);
    expect(exported.goalEngine.progressEvidence.length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(exported.goalEngine)).not.toContain("userId");
  });
});
