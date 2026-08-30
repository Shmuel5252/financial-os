import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { ConflictError } from "@/lib/errors/application-error";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("user profile repository isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured");
  const firstActor: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  const secondActor: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  let repository: UserProfileRepository;

  beforeAll(async () => {
    await client.connect();
    repository = profileRepositoryForDatabase(client.db(databaseName));
    await repository.ensureIndexes();
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("persists isolated profiles and rejects stale writes", async () => {
    const first = await saveProfile(
      firstActor,
      {
        countryCode: "IL",
        displayName: "First user",
        expectedVersion: null,
        householdType: "single",
        primaryCurrency: "ILS",
        timeZone: "Asia/Jerusalem",
      },
      { repository },
    );
    const second = await saveProfile(
      secondActor,
      {
        countryCode: "US",
        displayName: "Second user",
        expectedVersion: null,
        householdType: "family",
        primaryCurrency: "USD",
        timeZone: "America/New_York",
      },
      { repository },
    );

    expect((await repository.findForActor(firstActor))?.fields.displayName).toBe(
      "First user",
    );
    expect((await repository.findForActor(secondActor))?.fields.displayName).toBe(
      "Second user",
    );

    const updated = await saveProfile(
      firstActor,
      {
        ...first.fields,
        displayName: "First user updated",
        expectedVersion: first.version,
      },
      { repository },
    );

    expect(updated.version).toBe(2);
    expect((await repository.findForActor(secondActor))?.id).toBe(second.id);
    expect((await repository.findForActor(secondActor))?.fields.displayName).toBe(
      "Second user",
    );

    await expect(
      saveProfile(
        firstActor,
        {
          ...first.fields,
          displayName: "Stale update",
          expectedVersion: first.version,
        },
        { repository },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const progressed = await repository.completeOnboardingStep(
      firstActor,
      "income",
      updated.version,
    );

    expect(progressed.onboarding.completedSteps).toEqual(["profile", "income"]);
    expect(progressed.onboarding.currentStep).toBe("accounts");
    expect(progressed.version).toBe(3);

    await expect(
      repository.completeOnboardingStep(firstActor, "cards", progressed.version),
    ).rejects.toBeInstanceOf(ConflictError);

    let current = progressed;
    for (const step of [
      "accounts",
      "cards",
      "expenses",
      "debts",
      "safety_margin",
      "goals",
      "review",
    ] as const) {
      current = await repository.completeOnboardingStep(
        firstActor,
        step,
        current.version,
      );
    }

    expect(current.onboarding.status).toBe("complete");
    expect(current.onboarding.currentStep).toBe("review");
    expect(current.onboarding.completedAt).toBeInstanceOf(Date);
    expect(current.onboarding.completedSteps).toEqual([
      "profile",
      "income",
      "accounts",
      "cards",
      "expenses",
      "debts",
      "safety_margin",
      "goals",
      "review",
    ]);

    await expect(
      repository.completeOnboardingStep(firstActor, "review", current.version),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
