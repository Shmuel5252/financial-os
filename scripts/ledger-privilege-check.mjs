// Owner-run least-privilege check for the `ledger-app` principal (runbook S1, P2). Proves the principal can do exactly what
// DeletionReceiptStore needs and cannot delete, drop, create or write elsewhere — without changing anything:
// - positive checks read both ledger collections and perform the store's write shapes (insert, update, upsert
//   findAndModify) inside a transaction that is ALWAYS aborted (this script never commits);
// - negative checks target only names that do not exist (a receipt id, a collection, a sibling database), so even a
//   wrongly granted privilege deletes or drops nothing; create and foreign writes also run inside an aborted transaction;
// - a denial counts only as `Unauthorized`; any other error is inconclusive, never a pass;
// - the state (receipt count, head revision, probe ids absent) must be identical before and after.
// Output: one line per check. Exit 0 = every check passed; 1 = any failure or inconclusive result; 2 = usage.
// Prints no URI, credential or document. Usage (PowerShell): $env:LEDGER_CHECK_URI = <built from Read-Host>; node scripts/ledger-privilege-check.mjs
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const code = error => error?.codeName ?? error?.name ?? "error";
const unauthorized = error => error?.code === 13 || error?.codeName === "Unauthorized";
// Atlas shared tiers may report a denial as AtlasError 8000 "user is not allowed to do action [x] on [db.coll]". The same code
// also covers tier restrictions, so it counts only when the message is that exact denial for the exact target namespace.
const atlasDenied = (error, namespace) => error?.code === 8000 && namespace !== undefined
  && /^user is not allowed to do action \[[A-Za-z]+\] on \[/.test(String(error?.errmsg ?? error?.message ?? ""))
  && String(error?.errmsg ?? error?.message).includes(`] on [${namespace}]`);
const detail = error => `${code(error)}${typeof error?.code === "number" ? ` ${error.code}` : ""}`;
/** A required operation must succeed. */
export const classifyAllowed = error => (error === undefined ? "pass" : `FAIL (${detail(error)})`);
/** A forbidden operation must be refused as unauthorized for its target namespace; success is a failure, anything else is inconclusive. */
export const classifyDenied = (error, succeeded, namespace) => (succeeded ? "FAIL (allowed)"
  : unauthorized(error) || atlasDenied(error, namespace) ? "pass (Unauthorized)" : `inconclusive (${detail(error)})`);

export async function runLedgerPrivilegeCheck({ client, database, runId = randomBytes(6).toString("hex") }) {
  const db = client.db(database);
  const receipts = db.collection("deletionReceipts"); const head = db.collection("deletionLedgerHead");
  const probeId = `privilege-check-${runId}`; const missing = `privilege_check_missing_${runId}`;
  const lines = [];
  const attempt = async work => { try { await work(); return { error: undefined, succeeded: true }; } catch (error) { return { error, succeeded: false }; } };
  // Every write runs here: a fresh transaction per check, aborted in all paths. There is no commit in this script.
  // Positive writes use the store's snapshot read concern; creating a collection in a transaction requires "local".
  const inAbortedTransaction = (work, level = "snapshot") => attempt(async () => {
    const session = client.startSession();
    try { session.startTransaction({ readConcern: { level }, writeConcern: { w: "majority" } }); await work(session); }
    finally { if (session.inTransaction()) await session.abortTransaction().catch(() => undefined); await session.endSession(); }
  });
  const state = async () => ({ receipts: await receipts.countDocuments({}), revision: (await head.findOne({ _id: "head" }))?.revision ?? null,
    probes: (await receipts.countDocuments({ _id: probeId })) + (await head.countDocuments({ _id: probeId })) });

  let before;
  try { before = await state(); lines.push(`allowed: read deletionReceipts and deletionLedgerHead — pass`); }
  catch (error) { lines.push(`allowed: read deletionReceipts and deletionLedgerHead — ${classifyAllowed(error)}`); return finish(lines); }

  const writes = await inAbortedTransaction(async session => {
    await receipts.findOne({ _id: probeId }, { session });
    await receipts.insertOne({ _id: probeId, privilegeCheck: true }, { session });
    await receipts.updateOne({ _id: probeId }, { $set: { privilegeCheck: false } }, { session });
    await head.findOneAndUpdate({ _id: probeId }, { $inc: { revision: 1 } }, { upsert: true, returnDocument: "after", session });
  });
  lines.push(`allowed: insert, update and upsert in a transaction (aborted, nothing kept) — ${classifyAllowed(writes.error)}`);

  const outside = `privilege_check_${runId}`;
  const denied = [
    ["delete in deletionReceipts", `${database}.deletionReceipts`, () => attempt(() => receipts.deleteOne({ _id: `${probeId}-missing` }))],
    ["drop a collection", `${database}.${missing}`, () => attempt(async () => { await db.collection(missing).drop(); })],
    ["create a collection (aborted transaction)", `${database}.${missing}`, () => inAbortedTransaction(session => db.createCollection(missing, { session }), "local")],
    ["write outside the ledger database (aborted transaction)", `${outside}.probe`,
      () => inAbortedTransaction(session => client.db(outside).collection("probe").insertOne({ privilegeCheck: true }, { session }), "local")],
  ];
  for (const [name, namespace, run] of denied) { const outcome = await run(); lines.push(`denied: ${name} — ${classifyDenied(outcome.error, outcome.succeeded, namespace)}`); }

  let after;
  try { after = await state(); } catch (error) { lines.push(`state: unverifiable (${code(error)})`); return finish(lines); }
  const unchanged = after.receipts === before.receipts && after.revision === before.revision && after.probes === 0;
  lines.push(unchanged ? `state: unchanged (receipts ${after.receipts}, head revision ${after.revision ?? "none"}) — pass`
    : `state: CHANGED (receipts ${before.receipts} → ${after.receipts}, head revision ${before.revision ?? "none"} → ${after.revision ?? "none"}, probe documents ${after.probes}) — FAIL`);
  return finish(lines);
}

function finish(lines) {
  const passed = lines.length === 7 && lines.every(line => /— pass/.test(line));
  return { lines, passed, exitCode: passed ? 0 : 1 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const uri = process.env.LEDGER_CHECK_URI; const database = process.env.LEDGER_CHECK_DATABASE ?? "deletion_ledger";
  if (!uri || !/^[A-Za-z0-9_-]{1,38}$/.test(database) || ["admin", "local", "config"].includes(database)) {
    console.log("failed: LEDGER_CHECK_URI and a valid LEDGER_CHECK_DATABASE are required"); process.exit(2);
  }
  // Constructed inside try: a malformed URI's parse error embeds the URI (password included); only its name is printed.
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const outcome = await runLedgerPrivilegeCheck({ client, database });
    for (const line of outcome.lines) console.log(line);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    console.log(`failed: connection (${code(error)})`); process.exitCode = 1;
  } finally { await client?.close(); }
}
