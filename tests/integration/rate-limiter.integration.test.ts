import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { RateLimitedError } from "@/lib/errors/application-error";
import {
  rateLimiterForDatabase,
  MongoRateLimiter,
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

  it("isolates actor and scope, resets by clock without TTL deletion, and bounds concurrent requests", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const scoped = new MongoRateLimiter(client.db(databaseName).collection("rateLimits"), () => now);
    const policy = { limit: 2, windowMs: 60_000 };
    await scoped.consume(actor, "exports", policy);
    await scoped.consume(actor, "exports", policy);
    await expect(scoped.consume(actor, "exports", policy)).rejects.toBeInstanceOf(RateLimitedError);
    await scoped.consume({ kind: "user", userId: new ObjectId().toHexString() }, "exports", policy);
    await scoped.consume(actor, "different-export", policy);
    now = new Date("2026-01-01T00:01:00Z");
    await scoped.consume(actor, "exports", policy);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => scoped.consume(actor, "concurrent", policy)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
  });
});
