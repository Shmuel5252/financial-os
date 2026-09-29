// Owner-run, read-only probe: does this cluster support snapshot sessions (required by backup capture)?
// Usage (PowerShell): $env:PROBE_MONGODB_URI='<uri>'; $env:PROBE_DATABASE='<db>'; node scripts/snapshot-session-probe.mjs
// Reads no collection, writes nothing, prints no URI, credential or data. Exit 0 = supported.
import { MongoClient } from "mongodb";

const uri = process.env.PROBE_MONGODB_URI; const database = process.env.PROBE_DATABASE;
if (!uri || !database) { console.log("unsupported: PROBE_MONGODB_URI and PROBE_DATABASE are required"); process.exit(2); }
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const session = client.startSession({ snapshot: true });
  try {
    // Namespace-independent read: pins a snapshot without touching any collection.
    await client.db(database).aggregate([{ $documents: [{}] }], { session }).toArray();
    const supported = session.snapshotTime !== undefined;
    console.log(supported ? "supported: snapshot session established a cluster time" : "unsupported: no snapshot time returned");
    process.exitCode = supported ? 0 : 1;
  } finally { await session.endSession(); }
} catch (error) {
  console.log(`unsupported: ${error?.codeName ?? error?.name ?? "error"}`);
  process.exitCode = 1;
} finally { await client.close(); }
