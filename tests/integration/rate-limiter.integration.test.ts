import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { RateLimitedError } from "@/lib/errors/application-error";
import {
  rateLimiterForDatabase,
  type MongoRateLimiter,
} from "@/lib/security/rate-limiter";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("MongoDB mutation rate limiter", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured");
  const actor: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  let limiter: MongoRateLimiter;

  beforeAll(async () => {
    await client.connect();
    limiter = rateLimiterForDatabase(client.db(databaseName));
    await limiter.ensureIndexes();
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("atomically limits an actor without storing the raw user ID in its key", async () => {
    const policy = { limit: 2, windowMs: 60_000 };

    await limiter.consume(actor, "profile", policy);
    await limiter.consume(actor, "profile", policy);
    await expect(limiter.consume(actor, "profile", policy)).rejects.toBeInstanceOf(
      RateLimitedError,
    );

    const stored = await client.db(databaseName).collection("rateLimits").findOne();

    expect(stored?._id).not.toContain(actor.userId);
    expect(stored?.count).toBe(3);
  });
});
