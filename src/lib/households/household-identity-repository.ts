import "server-only";

import { createHash } from "node:crypto";

import { type Collection, type Db, ObjectId } from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import { InputValidationError } from "@/lib/errors/application-error";

type AuthUserDocument = Readonly<{
  _id: ObjectId;
  email?: string | null;
  name?: string | null;
}>;

type ProfileIdentityDocument = Readonly<{
  displayName: string;
  userId: ObjectId;
}>;

export type HouseholdIdentity = Readonly<{
  displayName: string;
  emailHash: string;
  userId: string;
}>;

export function normalizeHouseholdEmail(email: string): string {
  return email.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function hashHouseholdEmail(email: string): string {
  return createHash("sha256")
    .update(normalizeHouseholdEmail(email), "utf8")
    .digest("hex");
}

export function maskHouseholdEmail(email: string): string {
  const normalized = normalizeHouseholdEmail(email);
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return "***";
  return `${normalized.slice(0, 1)}***@${normalized.slice(separator + 1)}`;
}

export class HouseholdIdentityRepository {
  constructor(
    private readonly authUsers: Collection<AuthUserDocument>,
    private readonly profiles: Collection<ProfileIdentityDocument>,
  ) {}

  async resolveActor(actor: Actor): Promise<HouseholdIdentity> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const [authUser, profile] = await Promise.all([
      this.authUsers.findOne({ _id: userId }, { projection: { email: 1, name: 1 } }),
      this.profiles.findOne({ userId }, { projection: { displayName: 1 } }),
    ]);
    const email = authUser?.email;
    const displayName = profile?.displayName ?? authUser?.name;
    if (
      typeof email !== "string" ||
      email.trim().length === 0 ||
      typeof displayName !== "string" ||
      displayName.trim().length === 0
    ) {
      throw new InputValidationError([
        {
          field: "identity",
          message: "An authenticated email and Financial OS profile are required for households.",
        },
      ]);
    }
    return {
      displayName: displayName.trim().slice(0, 100),
      emailHash: hashHouseholdEmail(email),
      userId: userId.toHexString(),
    };
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const normalized = normalizeHouseholdEmail(email);
    const document = await this.authUsers.findOne(
      { email: { $regex: `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { projection: { _id: 1 } },
    );
    return document?._id.toHexString() ?? null;
  }

  async displayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(userIds)].map((userId) => parseObjectId(userId, "userId"));
    if (unique.length === 0) return new Map();
    const documents = await this.profiles
      .find({ userId: { $in: unique } }, { projection: { displayName: 1, userId: 1 } })
      .toArray();
    return new Map(
      documents.map((document) => [document.userId.toHexString(), document.displayName]),
    );
  }
}

export function householdIdentityRepositoryForDatabase(
  database: Db,
): HouseholdIdentityRepository {
  return new HouseholdIdentityRepository(
    database.collection<AuthUserDocument>("authUsers"),
    database.collection<ProfileIdentityDocument>("profiles"),
  );
}

export async function getHouseholdIdentityRepository(): Promise<HouseholdIdentityRepository> {
  return householdIdentityRepositoryForDatabase(await getDatabase());
}
