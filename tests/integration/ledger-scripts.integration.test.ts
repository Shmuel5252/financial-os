import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MongoClient, type Collection } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";

// Owner-run ledger scripts (runbook S1) against local servers only: the replica set must pass, a standalone must not.
const replica = process.env.MONGODB_TEST_REPLICA_URI; const standalone = process.env.MONGODB_TEST_URI;
const run = async (script: string, env: Record<string, string>) => {
  try { const { stdout } = await promisify(execFile)(process.execPath, [script], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env }, timeout: 60_000 }); return { code: 0, stdout }; }
  catch (error) { const failed = error as { code?: number; stdout?: string }; return { code: failed.code ?? -1, stdout: failed.stdout ?? "" }; }
};
const databases: [string, string][] = [];
const CAPABILITIES = ["transaction (snapshot read concern, majority write concern)", "snapshot session pinned without a collection read"];

(replica ? describe : describe.skip)("ledger bootstrap and capability probe scripts", () => {
  afterEach(async () => {
    while (databases.length) { const [uri, name] = databases.pop()!; const client = await new MongoClient(uri).connect(); await client.db(name).dropDatabase(); await client.close(); }
  });

  // P1 contract: exit 0 only for every capability passing AND a verified cleanup; 1 = capability failure; 3 = cleanup incomplete.
  const expectedPass = `supported: ${CAPABILITIES[0]} — pass\nsupported: ${CAPABILITIES[1]} — pass\ncleanup: done\n`;
  const probeFrom = async () => (await import(pathToFileURL(resolve("scripts/ledger-probe.mjs")).href)) as {
    runLedgerProbe: (input: Record<string, unknown>) => Promise<{ lines: string[]; capabilitiesPassed: boolean; cleanupDone: boolean; exitCode: number }> };
  const collectionsOf = async (uri: string, database: string) => {
    const client = await new MongoClient(uri).connect();
    try { return (await client.db(database).listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).sort(); } finally { await client.close(); }
  };

  it("probe: PASS with a verified cleanup, using only commands covered by readWrite on the probe database", async () => {
    const database = `probe_${randomBytes(6).toString("hex")}`; databases.push([replica!, database]);
    expect(await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: replica!, PROBE_DATABASE: database })).toEqual({ code: 0, stdout: expectedPass });
    expect(await collectionsOf(replica!, database)).toEqual([]);
    // Every command the probe issues maps to a readWrite action (createCollection, find, insert, update, dropCollection,
    // listCollections) or needs no privilege (transactions, sessions). No dropDatabase, no dbAdmin/admin command.
    const { runLedgerProbe } = await probeFrom();
    const client = await new MongoClient(replica!, { monitorCommands: true }).connect(); const commands = new Set<string>();
    client.on("commandStarted", event => { commands.add(event.commandName); });
    try {
      const outcome = await runLedgerProbe({ client, database });
      expect(outcome).toMatchObject({ capabilitiesPassed: true, cleanupDone: true, exitCode: 0 });
    } finally { await client.close(); }
    const readWrite = new Set(["create", "findAndModify", "insert", "find", "getMore", "killCursors", "aggregate", "drop", "listCollections",
      "commitTransaction", "abortTransaction", "endSessions"]);
    expect([...commands].filter(name => !readWrite.has(name))).toEqual([]);
    expect(commands.has("drop")).toBe(true); expect(commands.has("dropDatabase")).toBe(false);
    expect((await run("scripts/ledger-probe.mjs", {})).code).toBe(2);
    for (const reserved of ["deletion_ledger", "admin"]) expect((await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: replica!, PROBE_DATABASE: reserved })).code).toBe(2);
  }, 90_000);

  it("probe: a failed cleanup is reported and is never a PASS", async () => {
    const database = `probe_${randomBytes(6).toString("hex")}`; databases.push([replica!, database]);
    const { runLedgerProbe } = await probeFrom();
    const client = await new MongoClient(replica!).connect();
    try {
      const outcome = await runLedgerProbe({ client, database, runId: "cafe0001",
        drop: async (collection: Collection) => { if (collection.collectionName.endsWith("_receipts")) throw new Error("synthetic Unauthorized"); return collection.drop(); } });
      expect(outcome).toMatchObject({ capabilitiesPassed: true, cleanupDone: false, exitCode: 3 });
      expect(outcome.lines).toEqual([`supported: ${CAPABILITIES[0]} — pass`, `supported: ${CAPABILITIES[1]} — pass`, "cleanup: incomplete (1 probe collections remain)"]);
      // A cleanup that cannot even be verified counts as incomplete too.
      const unverifiable = await runLedgerProbe({ client: { ...client, db: (name: string) => { const db = client.db(name);
        return Object.assign(Object.create(db), { listCollections: () => { throw new Error("synthetic outage"); } }); }, startSession: client.startSession.bind(client) }, database, runId: "cafe0002" });
      expect(unverifiable).toMatchObject({ cleanupDone: false, exitCode: 3 });
    } finally { await client.close(); }
    expect(await collectionsOf(replica!, database)).toContain("ledger_probe_cafe0001_receipts"); // really left behind, and said so
  }, 90_000);

  it("probe: never drops collections it did not create, and re-runs on the same database after a PASS", async () => {
    const database = `probe_${randomBytes(6).toString("hex")}`; databases.push([replica!, database]);
    const seed = await new MongoClient(replica!).connect();
    try {
      await seed.db(database).collection("keep").insertOne({ kept: true });
      await seed.db(database).collection("ledger_probe_deadbeef_head").insertOne({ otherRun: true }); // another run's leftover
    } finally { await seed.close(); }
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: replica!, PROBE_DATABASE: database })).toEqual({ code: 0, stdout: expectedPass });
      expect(await collectionsOf(replica!, database)).toEqual(["keep", "ledger_probe_deadbeef_head"]);
    }
  }, 90_000);

  (standalone ? it : it.skip)("probe: a capability failure stays distinct from a cleanup failure", async () => {
    const database = `probe_${randomBytes(6).toString("hex")}`; databases.push([standalone!, database]);
    const failed = await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: standalone!, PROBE_DATABASE: database });
    expect(failed.code).toBe(1);
    const lines = failed.stdout.trim().split("\n");
    expect(lines.slice(0, 2).every(line => line.startsWith("unsupported: "))).toBe(true); expect(lines[2]).toBe("cleanup: done");
    expect(await collectionsOf(standalone!, database)).toEqual([]);
    // Both failures at once: still exit 1 (capability), with the cleanup failure visible.
    const { runLedgerProbe } = await probeFrom();
    const client = await new MongoClient(standalone!).connect();
    try {
      const outcome = await runLedgerProbe({ client, database, drop: async () => { throw new Error("synthetic"); } });
      expect(outcome).toMatchObject({ capabilitiesPassed: false, cleanupDone: false, exitCode: 1 });
      expect(outcome.lines[2]).toBe("cleanup: incomplete (2 probe collections remain)");
    } finally { await client.close(); }
    const unreachable = await run("scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500", PROBE_DATABASE: database });
    expect(unreachable.code).toBe(1); expect(unreachable.stdout).toMatch(/^unsupported: connection — fail \(/);
  }, 90_000);

  it("snapshot probe (primary): pinned session plus snapshot reads of every collection pass on a replica set, fail on a standalone", async () => {
    const database = `snap_${randomBytes(6).toString("hex")}`; databases.push([replica!, database]);
    const seed = await new MongoClient(replica!).connect();
    try { for (const name of ["accounts", "transactions", "profiles"]) await seed.db(database).collection(name).insertOne({ secret: "synthetic-value" }); }
    finally { await seed.close(); }
    const passed = await run("scripts/snapshot-session-probe.mjs", { PROBE_MONGODB_URI: replica!, PROBE_DATABASE: database });
    expect(passed).toEqual({ code: 0, stdout: "supported: snapshot session and snapshot reads of 3 collections at one cluster time\n" });
    if (standalone) {
      const failed = await run("scripts/snapshot-session-probe.mjs", { PROBE_MONGODB_URI: standalone, PROBE_DATABASE: database });
      expect(failed.code).toBe(1); expect(failed.stdout).toMatch(/^unsupported: /);
    }
    expect((await run("scripts/snapshot-session-probe.mjs", {})).code).toBe(2);
    expect(passed.stdout).not.toMatch(/synthetic-value|accounts|27018/);
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
