import "server-only";

import { createHash } from "node:crypto";

import type { Collection, Db } from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { getDatabase } from "@/lib/db/mongodb";
import { RateLimitedError } from "@/lib/errors/application-error";

type RateLimitDocument = {
  _id: string;
  count: number;
  expiresAt: Date;
};

export type RateLimitPolicy = Readonly<{
  limit: number;
  windowMs: number;
}>;

const mutationPolicy: RateLimitPolicy = {
  limit: 30,
  windowMs: 60_000,
};

const aiRequestPolicy: RateLimitPolicy = {
  limit: 10,
  windowMs: 60 * 60_000,
};

export class MongoRateLimiter {
  constructor(
    private readonly collection: Collection<RateLimitDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "rate_limits_expiry" },
    );
  }

  async consume(
    actor: Actor,
    scope: string,
    policy: RateLimitPolicy = mutationPolicy,
  ): Promise<void> {
    const now = this.now();
    const windowStart =
      Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
    const actorHash = createHash("sha256").update(actor.userId).digest("hex");
    const id = `${scope}:${actorHash}:${windowStart}`;
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          expiresAt: new Date(windowStart + policy.windowMs * 2),
        },
      },
      {
        returnDocument: "after",
        upsert: true,
      },
    );

    if (result === null || result.count > policy.limit) {
      throw new RateLimitedError();
    }
  }
}

export function rateLimiterForDatabase(database: Db): MongoRateLimiter {
  return new MongoRateLimiter(
    database.collection<RateLimitDocument>("rateLimits"),
  );
}

export async function consumeMutationRateLimit(
  actor: Actor,
  scope: string,
): Promise<void> {
  const limiter = rateLimiterForDatabase(await getDatabase());
  await limiter.ensureIndexes();
  await limiter.consume(actor, scope);
}

export async function consumeAiRequestRateLimit(actor: Actor): Promise<void> {
  const limiter = rateLimiterForDatabase(await getDatabase());
  await limiter.ensureIndexes();
  await limiter.consume(actor, "ai-copilot", aiRequestPolicy);
}
