// Owner-run capability probe for a candidate ledger cluster (runbook S1, C7). Exercises exactly what the ledger needs, in a
// throwaway database that it drops afterwards: a multi-document transaction with snapshot read concern and majority write
// concern, a snapshot session pinned without touching a collection, and snapshot reads of both collections.
// Usage (PowerShell): $env:PROBE_MONGODB_URI='<ledger-app uri>'; node scripts/ledger-probe.mjs
// Needs readWrite on the probe database (default ledger_probe) — use a temporary probe user, not ledger-app. Refuses a database that
// already has collections and drops only a database it created. Prints only pass/fail per capability. Exit 0 = all pass.
import { MongoClient } from "mongodb";

const uri = process.env.PROBE_MONGODB_URI; const database = process.env.PROBE_DATABASE ?? "ledger_probe";
if (!uri || !/^[A-Za-z0-9_-]{1,63}$/.test(database)) { console.log("failed: PROBE_MONGODB_URI (and a valid PROBE_DATABASE) required"); process.exit(2); }
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
const results = {}; let created = false;
const check = async (name, work) => { try { await work(); results[name] = "pass"; } catch (error) { results[name] = `fail (${error?.codeName ?? error?.name ?? "error"})`; } };
try {
  await client.connect();
  const db = client.db(database);
  if ((await db.listCollections({}, { nameOnly: true }).toArray()).length !== 0) throw Object.assign(new Error("not empty"), { codeName: "ProbeDatabaseNotEmpty" });
  created = true;
  const durable = { readConcern: { level: "majority" }, writeConcern: { w: "majority" } };
  await db.createCollection("receipts", durable).catch(() => undefined); await db.createCollection("head", durable).catch(() => undefined);
  await check("transaction (snapshot read concern, majority write concern)", async () => {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const head = await db.collection("head").findOneAndUpdate({ _id: "head" }, { $inc: { revision: 1 } }, { upsert: true, returnDocument: "after", session });
        await db.collection("receipts").insertOne({ revision: head.revision }, { session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally { await session.endSession(); }
  });
  await check("snapshot session pinned without a collection read", async () => {
    const session = client.startSession({ snapshot: true });
    try {
      await db.aggregate([{ $documents: [{}] }], { session }).toArray();
      if (session.snapshotTime === undefined) throw Object.assign(new Error("no cluster time"), { codeName: "NoSnapshotTime" });
      await db.collection("head").findOne({ _id: "head" }, { session });
      await db.collection("receipts").find({}, { session }).toArray();
    } finally { await session.endSession(); }
  });
} catch (error) {
  results.connection = `fail (${error?.codeName ?? error?.name ?? "error"})`;
} finally {
  if (created) await client.db(database).dropDatabase().catch(() => undefined);
  await client.close();
}
for (const [name, value] of Object.entries(results)) console.log(`${value.startsWith("pass") ? "supported" : "unsupported"}: ${name} — ${value}`);
process.exitCode = Object.values(results).length >= 2 && Object.values(results).every(value => value === "pass") ? 0 : 1;
