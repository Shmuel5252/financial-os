import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import {
  ConflictError,
  InputValidationError,
} from "@/lib/errors/application-error";
import {
  createManualRecord,
  deleteManualRecord,
  listManualRecords,
  updateManualRecord,
} from "@/lib/onboarding/manual-record-service";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("manual record persistence and isolation", () => {
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
  let profileRepository: UserProfileRepository;
  let accountRepository: ManualRecordRepository;
  let safetyRepository: ManualRecordRepository;

  beforeAll(async () => {
    await client.connect();
    const database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    accountRepository = manualRecordRepositoryForDatabase(database, "accounts");
    safetyRepository = manualRecordRepositoryForDatabase(
      database,
      "safety_margin",
    );
    await Promise.all([
      profileRepository.ensureIndexes(),
      accountRepository.ensureIndexes(),
      safetyRepository.ensureIndexes(),
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
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("stores BSON int64 money, isolates owners, audits updates, and soft-deletes", async () => {
    const dependencies = {
      profileRepository,
      repository: accountRepository,
    };
    const created = await createManualRecord(
      firstActor,
      "accounts",
      {
        balance: { amount: "-12.34", currency: "ILS" },
        name: "Current account",
        type: "bank",
      },
      randomUUID(),
      dependencies,
    );

    expect(await listManualRecords(firstActor, "accounts", dependencies)).toHaveLength(
      1,
    );
    expect(
      await listManualRecords(secondActor, "accounts", dependencies),
    ).toHaveLength(0);

    await expect(
      updateManualRecord(
        secondActor,
        "accounts",
        created.id,
        created.version,
        {
          balance: { amount: "10", currency: "USD" },
          name: "Forbidden",
          type: "bank",
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const updated = await updateManualRecord(
      firstActor,
      "accounts",
      created.id,
      created.version,
      {
        balance: { amount: "25.50", currency: "ILS" },
        name: "Current account",
        type: "bank",
      },
      dependencies,
    );
    await deleteManualRecord(
      firstActor,
      "accounts",
      updated.id,
      updated.version,
      dependencies,
    );

    expect(await listManualRecords(firstActor, "accounts", dependencies)).toHaveLength(
      0,
    );

    const raw = await client
      .db(databaseName)
      .collection("accounts")
      .findOne({ _id: new ObjectId(created.id) });

    expect(raw?.fields.balance.amountMinor).toBeInstanceOf(Long);
    expect(raw?.auditTrail.map((event: { action: string }) => event.action)).toEqual([
      "created",
      "updated",
      "deleted",
    ]);
    expect(raw?.deletedAt).toBeInstanceOf(Date);
  });

  it("enforces profile currency and one active safety margin", async () => {
    const accountDependencies = {
      profileRepository,
      repository: accountRepository,
    };

    await expect(
      createManualRecord(
        firstActor,
        "accounts",
        {
          balance: { amount: "10", currency: "USD" },
          name: "Wrong currency",
          type: "bank",
        },
        randomUUID(),
        accountDependencies,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);

    const safetyDependencies = {
      profileRepository,
      repository: safetyRepository,
    };
    await createManualRecord(
      firstActor,
      "safety_margin",
      {
        amount: { amount: "1500", currency: "ILS" },
        kind: "fixed",
      },
      randomUUID(),
      safetyDependencies,
    );

    await expect(
      createManualRecord(
        firstActor,
        "safety_margin",
        {
          basisPoints: 1_000,
          kind: "income_percentage",
        },
        randomUUID(),
        safetyDependencies,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
