// Owner-run capability probe for a candidate ledger cluster (runbook S1, P1). Exercises exactly what the ledger needs: a
// multi-document transaction with snapshot read concern and majority write concern, a snapshot session pinned without touching a
// collection, and snapshot reads of the probe's collections at that cluster time.
// Needs only readWrite on the probe database (default ledger_probe) — use a temporary probe user, never ledger-app.
// Each run creates two collections with a random run id and drops exactly those (dropCollection, part of readWrite); it never
// touches, lists for deletion, or drops anything else, so it can be re-run on the same database. Cleanup is verified by listing.
// Output: one line per capability, then `cleanup: done` or `cleanup: incomplete (<n> probe collections remain)`. Prints no URI,
// credential or data. Exit 0 = every capability passed AND cleanup done; 1 = a capability failed (or no connection);
// 3 = capabilities passed but cleanup incomplete (not a PASS); 2 = usage.
// Usage (PowerShell): $env:PROBE_MONGODB_URI = Read-Host "uri"; node scripts/ledger-probe.mjs
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const code = error => error?.codeName ?? error?.name ?? "error";
export const CAPABILITIES = ["transaction (snapshot read concern, majority write concern)", "snapshot session pinned without a collection read"];

/** Runs the probe on a connected client. `drop` is injectable only so tests can prove a failed cleanup is reported. */
export async function runLedgerProbe({ client, database, runId = randomBytes(4).toString("hex"), drop = collection => collection.drop() }) {
  const db = client.db(database);
  const names = { head: `ledger_probe_${runId}_head`, receipts: `ledger_probe_${runId}_receipts` };
  const ours = name => name === names.head || name === names.receipts;
  const results = [];
  const check = async (name, work) => { try { await work(); results.push([name, "pass"]); } catch (error) { results.push([name, `fail (${code(error)})`]); } };
  try {
    for (const name of Object.values(names)) await db.createCollection(name, { writeConcern: { w: "majority" } }).catch(() => undefined);
    await check(CAPABILITIES[0], async () => {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const head = await db.collection(names.head).findOneAndUpdate({ _id: "head" }, { $inc: { revision: 1 } }, { upsert: true, returnDocument: "after", session });
          await db.collection(names.receipts).insertOne({ revision: head.revision }, { session });
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } finally { await session.endSession(); }
    });
    await check(CAPABILITIES[1], async () => {
      const session = client.startSession({ snapshot: true });
      try {
        await db.aggregate([{ $documents: [{}] }], { session }).toArray();
        if (session.snapshotTime === undefined) throw Object.assign(new Error("no cluster time"), { codeName: "NoSnapshotTime" });
        await db.collection(names.head).findOne({ _id: "head" }, { session });
        await db.collection(names.receipts).find({}, { session }).toArray();
      } finally { await session.endSession(); }
    });
  } finally {
    // Drop only this run's collections, then verify: a failed drop or an unverifiable listing is reported, never hidden.
    for (const name of Object.values(names)) await drop(db.collection(name)).catch(() => undefined);
  }
  let remaining;
  try { remaining = (await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).filter(ours).length; }
  catch { remaining = Object.values(names).length; }
  const capabilitiesPassed = results.length === CAPABILITIES.length && results.every(([, value]) => value === "pass");
  const lines = [...results.map(([name, value]) => `${value === "pass" ? "supported" : "unsupported"}: ${name} — ${value}`),
    remaining === 0 ? "cleanup: done" : `cleanup: incomplete (${remaining} probe collections remain)`];
  return { lines, capabilitiesPassed, cleanupDone: remaining === 0, exitCode: !capabilitiesPassed ? 1 : remaining === 0 ? 0 : 3 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const uri = process.env.PROBE_MONGODB_URI; const database = process.env.PROBE_DATABASE ?? "ledger_probe";
  // Never the ledger itself or a system database.
  if (!uri || !/^[A-Za-z0-9_-]{1,38}$/.test(database) || ["deletion_ledger", "admin", "local", "config"].includes(database)) {
    console.log("failed: PROBE_MONGODB_URI and a valid, dedicated PROBE_DATABASE are required"); process.exit(2);
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const outcome = await runLedgerProbe({ client, database });
    for (const line of outcome.lines) console.log(line);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    // Nothing was created without a connection.
    console.log(`unsupported: connection — fail (${code(error)})`); console.log("cleanup: done"); process.exitCode = 1;
  } finally { await client.close(); }
}
