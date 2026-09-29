// Owner-run, read-only probe: does this cluster support what backup capture needs — a snapshot session pinned without a
// collection read, then snapshot reads of every existing collection at that cluster time?
// Usage (PowerShell): $env:PROBE_MONGODB_URI='<uri>'; $env:PROBE_DATABASE='<db>'; node scripts/snapshot-session-probe.mjs
// Reads at most one _id per collection, writes nothing, prints no URI, credential, name or data. Exit 0 = supported.
import { MongoClient } from "mongodb";

const uri = process.env.PROBE_MONGODB_URI; const database = process.env.PROBE_DATABASE;
if (!uri || !database) { console.log("unsupported: PROBE_MONGODB_URI and PROBE_DATABASE are required"); process.exit(2); }
// Constructed inside try: a malformed URI's parse error embeds the URI (password included); only its name is printed.
let client;
try {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(database);
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).filter(name => !name.startsWith("system."));
  const session = client.startSession({ snapshot: true });
  try {
    // Namespace-independent read: pins a snapshot without touching any collection.
    await db.aggregate([{ $documents: [{}] }], { session }).toArray();
    const pinned = session.snapshotTime;
    if (pinned === undefined) { console.log("unsupported: no snapshot time returned"); process.exitCode = 1; }
    else {
      let read = 0;
      for (const name of names) { await db.collection(name).find({}, { session, projection: { _id: 1 }, limit: 1 }).toArray(); read++; }
      const stable = session.snapshotTime?.equals?.(pinned) ?? false;
      console.log(stable ? `supported: snapshot session and snapshot reads of ${read} collections at one cluster time` : "unsupported: cluster time moved");
      process.exitCode = stable ? 0 : 1;
    }
  } finally { await session.endSession(); }
} catch (error) {
  console.log(`unsupported: ${error?.codeName ?? error?.name ?? "error"}`);
  process.exitCode = 1;
} finally { await client?.close(); }
