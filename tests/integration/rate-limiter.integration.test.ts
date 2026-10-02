import { randomBytes } from "node:crypto";
import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { RateLimitedError } from "@/lib/errors/application-error";
import { MongoRateLimiter, rateLimiterForDatabase, type RateLimitPolicy } from "@/lib/security/rate-limiter";

// Phase 18 row 18-05: the real MongoRateLimiter against a real local MongoDB (loopback only, random database, dropped afterwards).
// Two independently constructed limiters on two separate MongoClients stand in for two serverless instances sharing one database.
// Run on the standalone test server and on the single-node replica set (production uses a replica set), when configured.
const targets = [...new Set([process.env.MONGODB_TEST_URI, process.env.MONGODB_TEST_REPLICA_URI].filter((value): value is string => Boolean(value)))];
type RateLimitDocument = { _id: string; count: number; expiresAt: Date };
const POLICY: RateLimitPolicy = { limit: 30, windowMs: 60_000 };
const actor = (): Actor => ({ kind: "user", userId: new ObjectId().toHexString() });

/** Settles every attempt and counts outcomes: granted, limited (RateLimitedError) and any other error (must be zero). */
async function race(attempts: readonly (() => Promise<void>)[]) {
  const results = await Promise.allSettled(attempts.map((attempt) => attempt()));
  const limited = results.filter((r) => r.status === "rejected" && r.reason instanceof RateLimitedError).length;
  const other = results.filter((r) => r.status === "rejected" && !(r.reason instanceof RateLimitedError)).map((r) => (r as PromiseRejectedResult).reason);
  return { granted: results.filter((r) => r.status === "fulfilled").length, limited, other };
}

for (const uri of targets.length > 0 ? targets : [undefined]) (uri ? describe : describe.skip)(`rate limiter on a real MongoDB (18-05) ${uri ? new URL(uri).port : ""}`, () => {
  const name = `ratelimit_${randomBytes(6).toString("hex")}`;
  let clientA: MongoClient; let clientB: MongoClient; let db: Db; let collectionA: Collection<RateLimitDocument>; let collectionB: Collection<RateLimitDocument>;
  const at = (ms: number) => () => new Date(ms);
  const window0 = Math.floor(Date.UTC(2030, 0, 1) / POLICY.windowMs) * POLICY.windowMs;

  beforeAll(async () => {
    const host = new URL(uri!).hostname;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error("rate-limiter tests require a loopback database");
    clientA = await new MongoClient(uri!, { directConnection: true }).connect(); clientB = await new MongoClient(uri!, { directConnection: true }).connect();
    db = clientA.db(name);
    collectionA = db.collection<RateLimitDocument>("rateLimits"); collectionB = clientB.db(name).collection<RateLimitDocument>("rateLimits");
    await rateLimiterForDatabase(db).ensureIndexes(); // the production factory: the "rateLimits" collection and its TTL index
  });
  afterAll(async () => { await clientA.db(name).dropDatabase(); await clientA.close(); await clientB.close(); });

  it("[rl-sequential] grants exactly the limit per actor and scope, then refuses; actors and scopes have separate budgets", async () => {
    const limiter = new MongoRateLimiter(collectionA, at(window0 + 1_000));
    const a = actor(); const b = actor();
    for (let i = 0; i < 30; i += 1) await limiter.consume(a, "seq", POLICY);
    await expect(limiter.consume(a, "seq", POLICY)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(limiter.consume(b, "seq", POLICY)).resolves.toBeUndefined(); // another actor
    await expect(limiter.consume(a, "seq-other", POLICY)).resolves.toBeUndefined(); // another scope (separate budget, see 18-05 findings)
  });

  it("[rl-concurrent-first-creation] 100 simultaneous first requests from one actor across two limiter instances grant exactly 30", async () => {
    const a = actor();
    const limiters = [new MongoRateLimiter(collectionA, at(window0 + 2_000)), new MongoRateLimiter(collectionB, at(window0 + 2_000))];
    const outcome = await race(Array.from({ length: 100 }, (_, i) => () => limiters[i % 2]!.consume(a, "first", POLICY)));
    expect(outcome.other, "no duplicate-key or other error when the counter is created concurrently").toEqual([]);
    expect(outcome).toMatchObject({ granted: 30, limited: 70 });
    const documents = await collectionA.find({ _id: { $regex: "^first:" } }).toArray();
    expect(documents).toHaveLength(1); // one counter, not one per instance
    expect(documents[0]!.count).toBe(100);
  });

  it("[rl-concurrent-boundary] with 2 left, 20 simultaneous requests from one actor get exactly 2 grants", async () => {
    const a = actor(); const clock = at(window0 + 3_000);
    const limiters = [new MongoRateLimiter(collectionA, clock), new MongoRateLimiter(collectionB, clock)];
    for (let i = 0; i < 28; i += 1) await limiters[0]!.consume(a, "boundary", POLICY);
    const outcome = await race(Array.from({ length: 20 }, (_, i) => () => limiters[i % 2]!.consume(a, "boundary", POLICY)));
    expect(outcome).toEqual({ granted: 2, limited: 18, other: [] });
  });

  it("[rl-distributed] two instances never get separate budgets: interleaved bursts from both share one counter", async () => {
    const a = actor(); const clock = at(window0 + 4_000);
    const instanceA = new MongoRateLimiter(collectionA, clock); const instanceB = new MongoRateLimiter(collectionB, clock);
    const burstA = race(Array.from({ length: 25 }, () => () => instanceA.consume(a, "shared", POLICY)));
    const burstB = race(Array.from({ length: 25 }, () => () => instanceB.consume(a, "shared", POLICY)));
    const [resultA, resultB] = await Promise.all([burstA, burstB]);
    expect(resultA.other.concat(resultB.other)).toEqual([]);
    expect(resultA.granted + resultB.granted).toBe(30);
  });

  it("[rl-rollover] a fixed window: the budget resets at the boundary, so up to 2x the limit can pass within milliseconds (documented)", async () => {
    const a = actor(); const end = window0 + POLICY.windowMs; // first instant of the next window
    const before = new MongoRateLimiter(collectionA, at(end - 1)); const after = new MongoRateLimiter(collectionB, at(end));
    const outcome = await race([
      ...Array.from({ length: 40 }, () => () => before.consume(a, "rollover", POLICY)),
      ...Array.from({ length: 40 }, () => () => after.consume(a, "rollover", POLICY)),
    ]);
    expect(outcome.other).toEqual([]);
    expect(outcome.granted).toBe(60); // 30 at end-1ms + 30 at end: the fixed-window burst (finding F-18-05-03)
    const ids = (await collectionA.find({ _id: { $regex: "^rollover:" } }).toArray()).map((document) => document._id);
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => Number(id.split(":")[2])).sort()).toEqual([window0, end]);
  });

  it("[rl-key-derivation] the counter key is scope + sha256(userId) + window start; the raw user id is never stored", async () => {
    const a = actor(); const limiter = new MongoRateLimiter(collectionA, at(window0 + 5_000));
    await limiter.consume(a, "keys", POLICY);
    const [document] = await collectionA.find({ _id: { $regex: "^keys:" } }).toArray();
    expect(document!._id).toMatch(/^keys:[0-9a-f]{64}:\d+$/);
    expect(JSON.stringify(document)).not.toContain(a.userId);
    expect(Object.keys(document!).sort()).toEqual(["_id", "count", "expiresAt"]);
  });

  it("[rl-ttl] TTL index on expiresAt (expireAfterSeconds 0), expiry two windows after the window start, and an expired counter never affects a new window", async () => {
    const indexes = await collectionA.indexes();
    expect(indexes.find((index) => index.name === "rate_limits_expiry")).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 0 });
    const a = actor(); const start = window0 + 10 * POLICY.windowMs;
    await new MongoRateLimiter(collectionA, at(start + 5)).consume(a, "ttl", POLICY);
    const [document] = await collectionA.find({ _id: { $regex: "^ttl:" } }).toArray();
    expect(document!.expiresAt.getTime()).toBe(start + 2 * POLICY.windowMs);
    // An exhausted counter from an earlier window (even if TTL has not removed it yet) does not limit the next window.
    for (let i = 0; i < 30; i += 1) await new MongoRateLimiter(collectionA, at(start + 10)).consume(a, "ttl-next", POLICY);
    await expect(new MongoRateLimiter(collectionA, at(start + 20)).consume(a, "ttl-next", POLICY)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(new MongoRateLimiter(collectionA, at(start + POLICY.windowMs)).consume(a, "ttl-next", POLICY)).resolves.toBeUndefined();
  });

  it("[rl-ttl-deletion] the TTL monitor eventually deletes expired counters (asynchronous; polled with a generous bound)", async () => {
    const admin = clientA.db("admin");
    const previous = (await admin.command({ getParameter: 1, ttlMonitorSleepSecs: 1 })).ttlMonitorSleepSecs as number;
    await admin.command({ setParameter: 1, ttlMonitorSleepSecs: 1 }); // local test server only; restored below
    try {
      const expired = `ttl-expired:${"0".repeat(64)}:0`;
      await collectionA.insertOne({ _id: expired, count: 31, expiresAt: new Date(Date.now() - 60_000) });
      let present = true;
      for (let waited = 0; present && waited < 90_000; waited += 1_000) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        present = (await collectionA.countDocuments({ _id: expired })) > 0;
      }
      expect(present, "an expired counter is removed by the TTL monitor").toBe(false);
    } finally { await admin.command({ setParameter: 1, ttlMonitorSleepSecs: previous }); }
  }, 120_000);

  it("[rl-failure-modes] unavailable, timing-out or erroring storage fails the request closed (no grant), and a null result is a refusal", async () => {
    const a = actor();
    // Unreachable server: the driver's server selection fails; consume rejects with that error (it never resolves as a grant).
    const unreachable = new MongoClient("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300&connectTimeoutMS=300");
    try {
      const error = await new MongoRateLimiter(unreachable.db(name).collection<RateLimitDocument>("rateLimits")).consume(a, "down", POLICY).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(RateLimitedError);
      expect((error as Error).name).toBe("MongoServerSelectionError");
    } finally { await unreachable.close(); }
    // An operation timeout or any unexpected driver error propagates the same way.
    const throwing = { findOneAndUpdate: async () => { throw Object.assign(new Error("operation exceeded time limit"), { name: "MongoOperationTimeoutError" }); } };
    await expect(new MongoRateLimiter(throwing as unknown as Collection<RateLimitDocument>).consume(a, "timeout", POLICY)).rejects.toMatchObject({ name: "MongoOperationTimeoutError" });
    // A null result (no document returned) is treated as limited, never as granted.
    const empty = { findOneAndUpdate: async () => null };
    await expect(new MongoRateLimiter(empty as unknown as Collection<RateLimitDocument>).consume(a, "null", POLICY)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
