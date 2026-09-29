// Owner-run, idempotent bootstrap of the independent deletion ledger (runbook S1, C4): creates the two ledger collections
// and the head document (revision 0) so first writers never race on implicit collection creation. Touches nothing else.
// Usage (PowerShell): $env:LEDGER_BOOTSTRAP_URI='<ledger-app uri>'; $env:LEDGER_BOOTSTRAP_DATABASE='deletion_ledger'; node scripts/ledger-bootstrap.mjs
// Prints only a status line; never a URI, credential or document.
import { MongoClient } from "mongodb";

const uri = process.env.LEDGER_BOOTSTRAP_URI; const database = process.env.LEDGER_BOOTSTRAP_DATABASE;
if (!uri || !database || !/^[A-Za-z0-9_-]{1,63}$/.test(database)) { console.log("failed: LEDGER_BOOTSTRAP_URI and a valid LEDGER_BOOTSTRAP_DATABASE are required"); process.exit(2); }
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const db = client.db(database);
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name));
  const unexpected = [...existing].filter(name => !["deletionReceipts", "deletionLedgerHead"].includes(name) && !name.startsWith("system."));
  if (unexpected.length > 0) { console.log("failed: the ledger database contains other collections"); process.exitCode = 1; }
  else {
    for (const name of ["deletionReceipts", "deletionLedgerHead"]) if (!existing.has(name)) await db.createCollection(name, { writeConcern: { w: "majority" } });
    const head = db.collection("deletionLedgerHead", { writeConcern: { w: "majority" } });
    await head.updateOne({ _id: "head" }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    const current = await head.findOne({ _id: "head" });
    console.log(`ok: ledger collections present; head revision ${current?.revision}`);
  }
} catch (error) {
  console.log(`failed: ${error?.codeName ?? error?.name ?? "error"}`); process.exitCode = 1;
} finally { await client.close(); }
