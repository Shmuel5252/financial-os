import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";

// Owner-run ledger scripts (runbook S1) against local servers only: the replica set must pass, a standalone must not.
const replica = process.env.MONGODB_TEST_REPLICA_URI; const standalone = process.env.MONGODB_TEST_URI;
const run = async (script: string, env: Record<string, string>) => {
  try { const { stdout } = await promisify(execFile)(process.execPath, [script], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env }, timeout: 60_000 }); return { code: 0, stdout }; }
  catch (error) { const failed = error as { code?: number; stdout?: string }; return { code: failed.code ?? -1, stdout: failed.stdout ?? "" }; }
};
const databases: [string, string][] = [];

(replica ? describe : describe.skip)("ledger bootstrap and capability probe scripts", () => {
  afterEach(async () => {
    while (databases.length) { const [uri, name] = databases.pop()!; const client = await new MongoClient(uri).connect(); await client.db(name).dropDatabase(); await client.close(); }
  });

  it("probe: passes every capability on a replica set, fails on a standalone, and leaves no probe database", async () => {
    const database = `probe_${randomBytes(6).toString("hex")}`;
    const passed = await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: replica!, PROBE_DATABASE: database });
    expect(passed.code).toBe(0); expect(passed.stdout.match(/^supported: /gm)).toHaveLength(2);
    const client = await new MongoClient(replica!).connect();
    try { expect((await client.db().admin().listDatabases()).databases.map(item => item.name)).not.toContain(database); } finally { await client.close(); }
    if (standalone) {
      const failed = await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: standalone, PROBE_DATABASE: database });
      expect(failed.code).toBe(1); expect(failed.stdout).toMatch(/^unsupported: /m);
    }
    expect((await run("scripts/ledger-probe.mjs", {})).code).toBe(2);
    // Pointed at a database that already holds data, the probe refuses and drops nothing.
    const occupied = `occupied_${randomBytes(6).toString("hex")}`; databases.push([replica!, occupied]);
    const owner = await new MongoClient(replica!).connect();
    try {
      await owner.db(occupied).collection("keep").insertOne({ kept: true });
      const refused = await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: replica!, PROBE_DATABASE: occupied });
      expect(refused.code).toBe(1); expect(refused.stdout).toContain("ProbeDatabaseNotEmpty");
      expect(await owner.db(occupied).collection("keep").countDocuments()).toBe(1);
    } finally { await owner.close(); }
    expect(passed.stdout).not.toContain(replica!);
  }, 90_000);

  it("bootstrap: idempotent head at revision 0, refuses a database holding anything else, never prints the URI", async () => {
    const database = `ledger_${randomBytes(6).toString("hex")}`; databases.push([replica!, database]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await run("scripts/ledger-bootstrap.mjs", { LEDGER_BOOTSTRAP_URI: replica!, LEDGER_BOOTSTRAP_DATABASE: database });
      expect(result).toEqual({ code: 0, stdout: "ok: ledger collections present; head revision 0\n" });
    }
    const client = await new MongoClient(replica!).connect();
    try {
      const db = client.db(database);
      expect((await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).sort()).toEqual(["deletionLedgerHead", "deletionReceipts"]);
      await db.collection("deletionLedgerHead").updateOne({ _id: "head" as never }, { $set: { revision: 5 } });
      expect((await run("scripts/ledger-bootstrap.mjs", { LEDGER_BOOTSTRAP_URI: replica!, LEDGER_BOOTSTRAP_DATABASE: database })).stdout).toContain("head revision 5");
      await db.createCollection("other");
      expect(await run("scripts/ledger-bootstrap.mjs", { LEDGER_BOOTSTRAP_URI: replica!, LEDGER_BOOTSTRAP_DATABASE: database }))
        .toEqual({ code: 1, stdout: "failed: the ledger database contains other collections\n" });
    } finally { await client.close(); }
    expect((await run("scripts/ledger-bootstrap.mjs", { LEDGER_BOOTSTRAP_URI: replica!, LEDGER_BOOTSTRAP_DATABASE: "bad name" })).code).toBe(2);
  }, 90_000);
});
