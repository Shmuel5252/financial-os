import { randomUUID } from "node:crypto";
import { BSON, Long, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { evaluateReadiness } from "@/lib/operations/readiness";

const uri = process.env.MONGODB_TEST_URI;
const withMongo = uri ? describe : describe.skip;

withMongo("readiness with real isolated MongoDB (not a real Google login)", () => {
  const name = `financial_os_readiness_test_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(uri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const database = client.db(name);
  const owner = new ObjectId().toHexString();
  const other = new ObjectId().toHexString();
  let before: string;

  beforeAll(async () => {
    // This test's cleanup can only target its own random, loopback fixture DB.
    if (!uri || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(uri).hostname)) throw new Error("Readiness test requires isolated loopback MongoDB.");
    await client.connect();
    await database.collection("fixture").insertMany([
      { userId: owner, amount: Long.fromString("9007199254740993"), currency: "ILS" },
      { userId: other, amount: Long.fromString("-9007199254740993"), currency: "USD" },
    ]);
    before = BSON.EJSON.stringify(await database.collection("fixture").find().sort({ _id: 1 }).toArray(), { relaxed: false });
  });

  afterAll(async () => {
    if (uri && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(uri).hostname)) await database.dropDatabase();
    await client.close();
  });

  it("pings without returning or altering either user's exact BSON financial fixture", async () => {
    const probe = vi.fn(async () => { await database.command({ ping: 1 }, { timeoutMS: 3000 }); });
    expect(await evaluateReadiness({ authenticate: async () => ({ kind: "user", userId: other }), operatorIds: [owner], probe })).toEqual({ status: 403, category: "forbidden" });
    expect(probe).not.toHaveBeenCalled();
    expect(await evaluateReadiness({ authenticate: async () => ({ kind: "user", userId: owner }), operatorIds: [owner], probe })).toEqual({ status: 200, category: "ready" });
    expect(BSON.EJSON.stringify(await database.collection("fixture").find().sort({ _id: 1 }).toArray(), { relaxed: false })).toBe(before);
    expect((await database.listCollections().toArray()).map(({ name: collection }) => collection)).toEqual(["fixture"]);
  });

  it("sanitizes a real driver failure from a closed isolated client", async () => {
    const closed = new MongoClient(uri!);
    await closed.connect(); await closed.close();
    expect(await evaluateReadiness({
      authenticate: async () => ({ kind: "user", userId: owner }), operatorIds: [owner],
      probe: async () => { await closed.db(name).command({ ping: 1 }); },
    })).toEqual({ status: 503, category: "unavailable" });
  });
});
