import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import {
  budgetRepositoryForDatabase,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import { ConflictError, NotFoundError } from "@/lib/errors/application-error";
import { buildFinancialDataExport } from "@/lib/financial-data/financial-data-export-service";
import {
  financialEngineSourceSections,
  type FinancialEngineSourceSection,
} from "@/lib/financial-engine/financial-engine-input";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { calculateFinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot-service";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { goalRepositoryForDatabase } from "@/lib/goals/goal-repository";
import { netWorthRepositoryForDatabase } from "@/lib/net-worth/net-worth-repository";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  createManualRecord,
  updateManualRecord,
} from "@/lib/onboarding/manual-record-service";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { purchaseSimulationRepositoryForDatabase } from "@/lib/purchase-simulations/purchase-simulation-repository";
import { transactionIntelligenceRepositoryForDatabase } from "@/lib/transaction-intelligence/transaction-intelligence-repository";
import {
  evaluatePurchaseSimulation,
  loadPurchaseSimulationCenter,
  savePurchaseSimulation,
  type PurchaseSimulationDependencies,
} from "@/lib/purchase-simulations/purchase-simulation-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 7 purchase simulation persistence and isolation", () => {
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
  let budgetRepository: BudgetRepository;
  let engineRepository: ReturnType<
    typeof financialEngineSnapshotRepositoryForDatabase
  >;
  let manifestRepository: ReturnType<
    typeof financialSnapshotRepositoryForDatabase
  >;
  let simulationRepository: ReturnType<
    typeof purchaseSimulationRepositoryForDatabase
  >;
  let goalRepository: ReturnType<typeof goalRepositoryForDatabase>;
  let sourceRepositories: Readonly<
    Record<FinancialEngineSourceSection, ManualRecordRepository>
  >;
  let goalsRepository: ManualRecordRepository;
  let accountId: string;
  let snapshotId: string;

  function dependencies(): PurchaseSimulationDependencies {
    return {
      budgetRepository,
      engineRepository,
      freshness: {
        manifestRepository,
        now: () => new Date("2026-09-01T12:00:00.000Z"),
        sourceRepositories,
      },
      profileRepository,
      simulationRepository,
    };
  }

  function command() {
    return {
      charges: [
        {
          amount: { amount: "10.01", currency: "ILS" },
          kind: "fee" as const,
          label: "Known fee",
          provenance: { kind: "user_reported" as const, note: "Contract" },
        },
      ],
      inputMode: "installments" as const,
      installmentCount: 3,
      installmentFrequency: "monthly" as const,
      proposedDate: "2026-09-01",
      sourceSnapshotId: snapshotId,
      totalPurchasePrice: { amount: "500", currency: "ILS" },
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    budgetRepository = budgetRepositoryForDatabase(database);
    engineRepository = financialEngineSnapshotRepositoryForDatabase(database);
    manifestRepository = financialSnapshotRepositoryForDatabase(database);
    goalRepository = goalRepositoryForDatabase(database);
    simulationRepository = purchaseSimulationRepositoryForDatabase(
      database,
      () => new Date("2026-09-01T13:00:00.000Z"),
    );
    sourceRepositories = Object.fromEntries(
      financialEngineSourceSections.map((section) => [
        section,
        manualRecordRepositoryForDatabase(database, section),
      ]),
    ) as unknown as Readonly<
      Record<FinancialEngineSourceSection, ManualRecordRepository>
    >;
    goalsRepository = manualRecordRepositoryForDatabase(database, "goals");
    await Promise.all([
      profileRepository.ensureIndexes(),
      budgetRepository.ensureIndexes(),
      engineRepository.ensureIndexes(),
      manifestRepository.ensureIndexes(),
      goalRepository.ensureIndexes(),
      simulationRepository.ensureIndexes(),
      goalsRepository.ensureIndexes(),
      ...Object.values(sourceRepositories).map((repository) =>
        repository.ensureIndexes(),
      ),
    ]);
    await saveProfile(
      firstActor,
      {
        countryCode: "IL",
        displayName: "Simulation owner",
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
        displayName: "Other owner",
        expectedVersion: null,
        householdType: "single",
        primaryCurrency: "USD",
        timeZone: "America/New_York",
      },
      { repository: profileRepository },
    );
    const account = await createManualRecord(
      firstActor,
      "accounts",
      {
        balance: { amount: "1000", currency: "ILS" },
        name: "Primary",
        type: "bank",
      },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.accounts },
    );
    accountId = account.id;
    await createManualRecord(
      firstActor,
      "safety_margin",
      { amount: { amount: "100", currency: "ILS" }, kind: "fixed" },
      randomUUID(),
      {
        profileRepository,
        repository: sourceRepositories.safety_margin,
      },
    );
    await budgetRepository.savePeriodForActor(firstActor, {
      allocations: [],
      calendarMonth: "2026-09",
      carryIn: [],
      currency: "ILS",
      expectedVersion: null,
    });
    const snapshot = await calculateFinancialEngineSnapshot(
      firstActor,
      {
        asOf: "2026-09-01T09:00:00.000Z",
        horizonDays: 210,
        idempotencyKey: randomUUID(),
      },
      {
        engineRepository,
        profileRepository,
        sourceManifestRepository: manifestRepository,
        sourceRepositories,
      },
    );
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("keeps evaluation ephemeral and attaches owned snapshot/budget provenance", async () => {
    const before = await database
      .collection("purchaseSimulations")
      .countDocuments({});
    const evaluated = await evaluatePurchaseSimulation(
      firstActor,
      command(),
      dependencies(),
    );

    expect(evaluated.evaluation.dataFreshness).toBe("FRESH");
    expect(evaluated.evaluation.sourceSnapshot.id).toBe(snapshotId);
    expect(evaluated.evaluation.budgetPeriodReference?.calendarMonth).toBe(
      "2026-09",
    );
    expect(evaluated.evaluation.result.trueFinancedCost.amountMinor).toBe(
      51_001n,
    );
    expect(
      evaluated.evaluation.result.installmentSchedule.reduce(
        (sum, installment) => sum + installment.amount.amountMinor,
        0n,
      ),
    ).toBe(51_001n);
    expect(
      await database.collection("purchaseSimulations").countDocuments({}),
    ).toBe(before);
    const center = await loadPurchaseSimulationCenter(firstActor, dependencies());
    expect(center.baseline?.id).toBe(snapshotId);
    expect(center.saved).toHaveLength(0);
  });

  it("keeps stale status separate without changing snapshot mathematics", async () => {
    const before = await evaluatePurchaseSimulation(
      firstActor,
      command(),
      dependencies(),
    );
    await updateManualRecord(
      firstActor,
      "accounts",
      accountId,
      1,
      {
        balance: { amount: "900", currency: "ILS" },
        name: "Primary",
        type: "bank",
      },
      { profileRepository, repository: sourceRepositories.accounts },
    );
    const after = await evaluatePurchaseSimulation(
      firstActor,
      command(),
      dependencies(),
    );

    expect(after.evaluation.dataFreshness).toBe("STALE");
    expect(after.evaluation.freshnessReasons).toContain("source_changed");
    expect(after.evaluation.result.riskClassification).toBe(
      before.evaluation.result.riskClassification,
    );
    expect(after.evaluation.result.minimumConfirmedBalance.amountMinor).toBe(
      before.evaluation.result.minimumConfirmedBalance.amountMinor,
    );
  });

  it("saves immutable exact evidence only on explicit save and preserves source truth", async () => {
    const accountBefore = await database.collection("accounts").findOne({
      _id: new ObjectId(accountId),
    });
    const budgetBefore = await database.collection("budgetPeriods").findOne({});
    const snapshotCount = await database
      .collection("financialSnapshots")
      .countDocuments({});
    const idempotencyKey = randomUUID();
    const saved = await savePurchaseSimulation(
      firstActor,
      {
        ...command(),
        idempotencyKey,
        name: "Laptop scenario",
        note: "Explicitly hypothetical",
      },
      dependencies(),
    );
    const retry = await savePurchaseSimulation(
      firstActor,
      {
        ...command(),
        idempotencyKey,
        name: "Laptop scenario",
        note: "Explicitly hypothetical",
      },
      dependencies(),
    );
    const stored = await database.collection("purchaseSimulations").findOne({
      _id: new ObjectId(saved.id),
    });

    expect(retry.id).toBe(saved.id);
    expect(stored?.input.totalPurchasePrice.amountMinor).toBeInstanceOf(Long);
    expect(stored?.evaluation.result.trueFinancedCost.amountMinor).toBeInstanceOf(
      Long,
    );
    expect(stored?.auditTrail).toHaveLength(1);
    expect(await database.collection("transactions").countDocuments({})).toBe(0);
    expect(await database.collection("accounts").findOne({
      _id: new ObjectId(accountId),
    })).toEqual(accountBefore);
    expect(await database.collection("budgetPeriods").findOne({})).toEqual(
      budgetBefore,
    );
    expect(
      await database.collection("financialSnapshots").countDocuments({}),
    ).toBe(snapshotCount);
    const exported = await buildFinancialDataExport(firstActor, {
      budgetRepository,
      goalRepository,
      netWorthRepository: netWorthRepositoryForDatabase(database),
      profileRepository,
      purchaseSimulationRepository: simulationRepository,
      repositories: { ...sourceRepositories, goals: goalsRepository },
      transactionIntelligenceRepository:
        transactionIntelligenceRepositoryForDatabase(database),
    });
    const serialized = JSON.stringify(exported.purchaseSimulations);
    expect(exported.schemaVersion).toBe(7);
    expect(exported.purchaseSimulations).toHaveLength(1);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("idempotencyKeyHash");
    expect(serialized).not.toContain("auditTrail");

    await expect(
      savePurchaseSimulation(
        firstActor,
        {
          ...command(),
          idempotencyKey,
          name: "Changed name",
          note: "Explicitly hypothetical",
        },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("enforces source and saved-simulation ownership for a second actor", async () => {
    await expect(
      evaluatePurchaseSimulation(secondActor, command(), dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    const firstPage = await simulationRepository.listForActor(firstActor, {
      limit: 10,
    });
    const simulation = firstPage.simulations[0];
    expect(simulation).toBeDefined();
    expect(
      await simulationRepository.findForActor(secondActor, simulation?.id ?? ""),
    ).toBeNull();
    expect(
      (await simulationRepository.listForActor(secondActor, { limit: 10 }))
        .simulations,
    ).toHaveLength(0);
    const secondCenter = await loadPurchaseSimulationCenter(
      secondActor,
      dependencies(),
    );
    expect(secondCenter.baseline).toBeNull();
    expect(secondCenter.saved).toHaveLength(0);
  });

  it("creates owner-first indexes for simulation access paths", async () => {
    const indexes = await database
      .collection("purchaseSimulations")
      .listIndexes()
      .toArray();
    for (const name of [
      "purchase_simulations_owner_idempotency",
      "purchase_simulations_owner_page",
      "purchase_simulations_owner_snapshot",
    ]) {
      const index = indexes.find((candidate) => candidate.name === name);
      expect(index).toBeDefined();
      expect(Object.keys(index?.key ?? {})[0]).toBe("userId");
    }
  });
});
