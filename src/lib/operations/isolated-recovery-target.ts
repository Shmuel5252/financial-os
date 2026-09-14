/** Local rehearsal capability only. No deployed database/env fallback and no caller-supplied DB name. */
import "server-only";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";

export function validateRecoveryLoopback(input: string): void {
  try {
    const url = new URL(input);
    if (url.protocol !== "mongodb:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")
      || ["3000", "3001"].includes(url.port)) throw new Error();
  } catch { throw new Error("Isolated recovery target required"); }
}

export async function createIsolatedRecoveryTarget(loopback: string): Promise<Readonly<{ database: Db; dispose: () => Promise<void> }>> {
  validateRecoveryLoopback(loopback);
  const name = `financial_os_recovery_test_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(loopback, { promoteLongs: false, serverSelectionTimeoutMS: 3000 });
  let created = false;
  let disposed = false;
  try {
    await client.connect();
    const database = client.db(name);
    if ((await database.listCollections({}, { nameOnly: true }).toArray()).length !== 0) throw new Error();
    // Collision fails, never reuses/overwrites an existing target. This namespace has no application ingress.
    await database.createCollection("recoveryQuarantine");
    created = true;
    return { database, dispose: async () => {
      if (disposed) return;
      if (!created || !/^financial_os_recovery_test_[a-f0-9]{32}$/.test(name) || database.databaseName !== name) throw new Error("Unsafe recovery cleanup");
      try { await database.dropDatabase(); disposed = true; } finally { await client.close(); }
    } };
  } catch {
    // Never drop an existing/unconfirmed namespace after setup failure.
    await client.close();
    throw new Error("Isolated recovery target unavailable");
  }
}
