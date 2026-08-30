import "server-only";

import {
  type Collection,
  type Db,
  MongoServerError,
  ObjectId,
} from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import {
  ConflictError,
  DependencyUnavailableError,
} from "@/lib/errors/application-error";
import {
  onboardingStepSchema,
  profileFieldsSchema,
  type OnboardingStep,
  type ProfileFields,
  type UserProfile,
} from "@/lib/profiles/profile";

export type UserProfileDocument = Readonly<{
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "created" | "updated";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: number;
    source: "manual";
  }>[];
  countryCode: string;
  createdAt: Date;
  displayName: string;
  householdType: "single" | "couple" | "family" | "other";
  onboarding: Readonly<{
    completedAt: Date | null;
    completedSteps: readonly string[];
    currentStep: string;
    status: "complete" | "in_progress";
  }>;
  primaryCurrency: string;
  timeZone: string;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
}>;

const storedProfileSchema = z.object({
  _id: z.instanceof(ObjectId),
  auditTrail: z.array(
    z.object({
      action: z.enum(["created", "updated"]),
      actorUserId: z.instanceof(ObjectId),
      at: z.date(),
      changedFields: z.array(z.string()),
      revision: z.number().int().positive(),
      source: z.literal("manual"),
    }),
  ),
  countryCode: profileFieldsSchema.shape.countryCode,
  createdAt: z.date(),
  displayName: profileFieldsSchema.shape.displayName,
  householdType: profileFieldsSchema.shape.householdType,
  onboarding: z.object({
    completedAt: z.date().nullable(),
    completedSteps: z.array(onboardingStepSchema),
    currentStep: onboardingStepSchema,
    status: z.enum(["complete", "in_progress"]),
  }),
  primaryCurrency: profileFieldsSchema.shape.primaryCurrency,
  timeZone: profileFieldsSchema.shape.timeZone,
  updatedAt: z.date(),
  userId: z.instanceof(ObjectId),
  version: z.number().int().positive(),
});

function mapStoredProfile(document: UserProfileDocument): UserProfile {
  const parsed = storedProfileSchema.safeParse(document);

  if (!parsed.success) {
    throw new DependencyUnavailableError("Stored profile data is invalid.");
  }

  return {
    createdAt: parsed.data.createdAt,
    fields: {
      countryCode: parsed.data.countryCode,
      displayName: parsed.data.displayName,
      householdType: parsed.data.householdType,
      primaryCurrency: parsed.data.primaryCurrency,
      timeZone: parsed.data.timeZone,
    },
    id: parsed.data._id.toHexString(),
    onboarding: parsed.data.onboarding,
    updatedAt: parsed.data.updatedAt,
    version: parsed.data.version,
  };
}

export class UserProfileRepository {
  constructor(
    private readonly collection: Collection<UserProfileDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1 },
      { name: "profiles_unique_user", unique: true },
    );
  }

  async findForActor(actor: Actor): Promise<UserProfile | null> {
    const document = await this.collection.findOne({
      userId: parseObjectId(actor.userId, "actor.userId"),
    });

    return document === null ? null : mapStoredProfile(document);
  }

  async saveForActor(
    actor: Actor,
    fields: ProfileFields,
    expectedVersion: number | null,
  ): Promise<UserProfile> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const now = this.now();

    if (expectedVersion === null) {
      const document: UserProfileDocument = {
        _id: new ObjectId(),
        ...fields,
        auditTrail: [
          {
            action: "created",
            actorUserId: userId,
            at: now,
            changedFields: Object.keys(fields),
            revision: 1,
            source: "manual",
          },
        ],
        createdAt: now,
        onboarding: {
          completedAt: null,
          completedSteps: ["profile"],
          currentStep: "income",
          status: "in_progress",
        },
        updatedAt: now,
        userId,
        version: 1,
      };

      try {
        await this.collection.insertOne(document);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new ConflictError();
        }

        throw error;
      }

      return mapStoredProfile(document);
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        userId,
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "updated",
            actorUserId: userId,
            at: now,
            changedFields: Object.keys(fields),
            revision: expectedVersion + 1,
            source: "manual",
          },
        },
        $set: {
          ...fields,
          updatedAt: now,
        },
      },
      {
        returnDocument: "after",
      },
    );

    if (updated === null) {
      throw new ConflictError();
    }

    return mapStoredProfile(updated);
  }

  async completeOnboardingStep(
    actor: Actor,
    step: OnboardingStep,
    expectedVersion: number,
  ): Promise<UserProfile> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const now = this.now();
    const orderedSteps: readonly OnboardingStep[] = [
      "profile",
      "income",
      "accounts",
      "cards",
      "expenses",
      "debts",
      "safety_margin",
      "goals",
      "review",
    ];
    const index = orderedSteps.indexOf(step);
    const nextStep = orderedSteps[index + 1] ?? "review";
    const completesOnboarding = step === "review";
    const updated = await this.collection.findOneAndUpdate(
      {
        "onboarding.currentStep": step,
        "onboarding.status": "in_progress",
        userId,
        version: expectedVersion,
      },
      {
        $addToSet: { "onboarding.completedSteps": step },
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "updated",
            actorUserId: userId,
            at: now,
            changedFields: ["onboarding"],
            revision: expectedVersion + 1,
            source: "manual",
          },
        },
        $set: {
          "onboarding.completedAt": completesOnboarding ? now : null,
          "onboarding.currentStep": nextStep,
          "onboarding.status": completesOnboarding ? "complete" : "in_progress",
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (updated === null) {
      throw new ConflictError(
        "The onboarding step changed. Reload it and try again.",
      );
    }

    return mapStoredProfile(updated);
  }
}

export function profileRepositoryForDatabase(database: Db): UserProfileRepository {
  return new UserProfileRepository(
    database.collection<UserProfileDocument>("profiles"),
  );
}

export async function getUserProfileRepository(): Promise<UserProfileRepository> {
  const repository = profileRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
