import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { loadDashboard } from "@/lib/dashboard/dashboard-service";
import { ConflictError } from "@/lib/errors/application-error";
import {
  financialEngineSourceSections,
  type FinancialEngineSourceSection,
} from "@/lib/financial-engine/financial-engine-input";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import {
  calculateFinancialEngineSnapshot,
  listFinancialEngineSnapshots,
} from "@/lib/financial-engine/financial-engine-snapshot-service";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { listFinancialSnapshots } from "@/lib/financial-snapshots/financial-snapshot-service";
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

describeWithMongo("Phase 3 financial engine persistence", () => {
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
  let sourceRepositories: Readonly<
    Record<FinancialEngineSourceSection, ManualRecordRepository>
  >;
  let goalsRepository: ManualRecordRepository;
  let sourceManifestRepository: ReturnType<
    typeof financialSnapshotRepositoryForDatabase
  >;
  let engineRepository: ReturnType<
    typeof financialEngineSnapshotRepositoryForDatabase
  >;

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    sourceRepositories = Object.fromEntries(
      financialEngineSourceSections.map((section) => [
        section,
        manualRecordRepositoryForDatabase(database, section),
      ]),
    ) as unknown as Readonly<
      Record<FinancialEngineSourceSection, ManualRecordRepository>
    >;
    sourceManifestRepository = financialSnapshotRepositoryForDatabase(database);
    engineRepository = financialEngineSnapshotRepositoryForDatabase(database);
    goalsRepository = manualRecordRepositoryForDatabase(database, "goals");

    await Promise.all([
      profileRepository.ensureIndexes(),
      sourceManifestRepository.ensureIndexes(),
      engineRepository.ensureIndexes(),
      goalsRepository.ensureIndexes(),
      ...Object.values(sourceRepositories).map((repository) =>
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
    await createManualRecord(
      firstActor,
      "accounts",
      { balance: { amount: "12000", currency: "ILS" }, name: "Bank", type: "bank" },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.accounts },
    );
    await createManualRecord(
      firstActor,
      "expenses",
      {
        amount: { amount: "3000", currency: "ILS" },
        category: "housing",
        frequency: "monthly",
        name: "Rent",
        nextDueDate: "2026-09-01",
      },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.expenses },
    );
    await createManualRecord(
      firstActor,
      "cards",
      {
        billingDay: 2,
        issuer: "Issuer",
        limit: { amount: "10000", currency: "ILS" },
        name: "Card",
        used: { amount: "4500", currency: "ILS" },
      },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.cards },
    );
    await createManualRecord(
      firstActor,
      "income",
      {
        amount: { amount: "9000", currency: "ILS" },
        certaintyBps: 10_000,
        destination: "bank_account",
        expectedDate: "2026-09-10",
        frequency: "monthly",
        name: "Salary",
      },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.income },
    );
    await createManualRecord(
      firstActor,
      "income",
      {
        amount: { amount: "5000", currency: "ILS" },
        certaintyBps: 9_999,
        destination: "bank_account",
        expectedDate: "2026-09-05",
        frequency: "one_time",
        name: "Expected",
      },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.income },
    );
    await createManualRecord(
      firstActor,
      "safety_margin",
      { amount: { amount: "1500", currency: "ILS" }, kind: "fixed" },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.safety_margin },
    );
    await createManualRecord(
      secondActor,
      "accounts",
      { balance: { amount: "5000", currency: "USD" }, name: "Bank", type: "bank" },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.accounts },
    );
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  function dependencies() {
    return {
      engineRepository,
      profileRepository,
      sourceManifestRepository,
      sourceRepositories,
    };
  }

  it("persists exact, versioned and reproducible snapshots from owned sources", async () => {
    const request = {
      asOf: "2026-08-31T09:00:00.000Z",
      horizonDays: 30,
      idempotencyKey: randomUUID(),
    };
    const snapshot = await calculateFinancialEngineSnapshot(
      firstActor,
      request,
      dependencies(),
    );
    const retried = await calculateFinancialEngineSnapshot(
      firstActor,
      request,
      dependencies(),
    );
    const independentlyCalculated = await calculateFinancialEngineSnapshot(
      firstActor,
      { ...request, idempotencyKey: randomUUID() },
      dependencies(),
    );

    expect(retried.id).toBe(snapshot.id);
    expect(independentlyCalculated.id).not.toBe(snapshot.id);
    expect(independentlyCalculated.inputHash).toBe(snapshot.inputHash);
    expect(independentlyCalculated.result).toEqual(snapshot.result);
    expect(snapshot.result.safeToSpend.amountMinor).toBe(300_000n);
    expect(snapshot.result.totals.uncertainIncome.amountMinor).toBe(500_000n);
    expect(snapshot.result.futureExpectedBalance.amountMinor).toBe(
      snapshot.result.futureConfirmedBalance.amountMinor + 500_000n,
    );

    const raw = await database
      .collection("financialSnapshots")
      .findOne({ _id: new ObjectId(snapshot.id) });
    expect(raw?.kind).toBe("engine_result");
    expect(raw?.result.safeToSpend.amountMinor).toBeInstanceOf(Long);
    expect(raw?.result.safeToSpend.amountMinor.toBigInt()).toBe(300_000n);
    expect(raw?.auditTrail[0]).toMatchObject({
      action: "calculated",
      actorUserId: new ObjectId(firstActor.userId),
      source: "financial_engine",
    });
    const sourceManifest = await database
      .collection("financialSnapshots")
      .findOne({ _id: raw?.sourceManifestId });
    expect(sourceManifest?.kind).toBe("source_manifest");
    expect(sourceManifest?.userId).toEqual(new ObjectId(firstActor.userId));
    expect(
      sourceManifest?.sources.some(
        (source: { section: string }) => source.section === "safety_margin",
      ),
    ).toBe(true);
  });

  it("isolates engine, manifest, and dashboard reads for two owners", async () => {
    const secondSnapshot = await calculateFinancialEngineSnapshot(
      secondActor,
      {
        asOf: "2026-08-31T09:00:00.000Z",
        horizonDays: 30,
        idempotencyKey: randomUUID(),
      },
      dependencies(),
    );
    const firstPage = await listFinancialEngineSnapshots(
      firstActor,
      { limit: 20 },
      dependencies(),
    );
    const secondPage = await listFinancialEngineSnapshots(
      secondActor,
      { limit: 20 },
      dependencies(),
    );

    expect(firstPage.snapshots.every((snapshot) => snapshot.id !== secondSnapshot.id)).toBe(true);
    expect(secondPage.snapshots.map((snapshot) => snapshot.id)).toEqual([
      secondSnapshot.id,
    ]);
    await expect(
      engineRepository.createForActor(
        secondActor,
        "a".repeat(64),
        secondSnapshot.result,
        firstPage.snapshots[0]?.sourceManifestId ?? "",
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      (await listFinancialSnapshots(firstActor, { limit: 20 }, {
        repository: sourceManifestRepository,
      })).snapshots.every((snapshot) => snapshot.kind === "source_manifest"),
    ).toBe(true);
    const dashboardDependencies = {
      engineRepository,
      manifestRepository: sourceManifestRepository,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
      profileRepository,
      sourceRepositories: { ...sourceRepositories, goals: goalsRepository },
    };
    const firstDashboard = await loadDashboard(
      firstActor,
      dashboardDependencies,
    );
    const secondDashboard = await loadDashboard(
      secondActor,
      dashboardDependencies,
    );
    expect(firstDashboard.kind).toBe("ready");
    expect(secondDashboard.kind).toBe("ready");
    if (firstDashboard.kind !== "ready" || secondDashboard.kind !== "ready") {
      throw new Error("Expected owner-specific dashboard snapshots.");
    }
    expect(firstDashboard.snapshotId).not.toBe(secondDashboard.snapshotId);
    expect(firstDashboard.safeToSpend.currency).toBe("ILS");
    expect(secondDashboard.safeToSpend.currency).toBe("USD");
    expect(
      await sourceManifestRepository.findForActor(
        secondActor,
        firstPage.snapshots[0]?.sourceManifestId ?? "",
      ),
    ).toBeNull();
  });

  it("rejects idempotency reuse after source data changes", async () => {
    const idempotencyKey = randomUUID();
    await calculateFinancialEngineSnapshot(
      firstActor,
      {
        asOf: "2026-08-31T09:00:00.000Z",
        horizonDays: 30,
        idempotencyKey,
      },
      dependencies(),
    );
    await createManualRecord(
      firstActor,
      "expenses",
      {
        amount: { amount: "1", currency: "ILS" },
        category: "other",
        frequency: "irregular",
        name: "Changed input",
        nextDueDate: "2026-09-03",
      },
      randomUUID(),
      { profileRepository, repository: sourceRepositories.expenses },
    );

    await expect(
      calculateFinancialEngineSnapshot(
        firstActor,
        {
          asOf: "2026-08-31T09:00:00.000Z",
          horizonDays: 30,
          idempotencyKey,
        },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
