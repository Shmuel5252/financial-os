import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";

// P2 least privilege on a local, loopback, auth-enforced replica set with synthetic principals only (never Atlas).
// MONGODB_TEST_AUTH_REPLICA_URI carries a synthetic root user for setup; every check runs as a scoped principal.
const adminUri = process.env.MONGODB_TEST_AUTH_REPLICA_URI;
type Check = { runLedgerPrivilegeCheck: (input: Record<string, unknown>) => Promise<{ lines: string[]; passed: boolean; exitCode: number }>;
  classifyAllowed: (error?: unknown) => string; classifyDenied: (error: unknown, succeeded: boolean, namespace?: string) => string };
const load = async () => (await import(pathToFileURL(resolve("scripts/ledger-privilege-check.mjs")).href)) as Check;
/** stdout and stderr together, for leak checks. */
const runAll = async (script: string, env: Record<string, string>) => {
  try { const { stdout, stderr } = await promisify(execFile)(process.execPath, [script], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env }, timeout: 60_000 }); return { code: 0, output: stdout + stderr }; }
  catch (error) { const failed = error as { code?: number; stdout?: string; stderr?: string }; return { code: failed.code ?? -1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` }; }
};
const run = async (script: string, env: Record<string, string>) => {
  try { const { stdout } = await promisify(execFile)(process.execPath, [script], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env }, timeout: 60_000 }); return { code: 0, stdout }; }
  catch (error) { const failed = error as { code?: number; stdout?: string }; return { code: failed.code ?? -1, stdout: failed.stdout ?? "" }; }
};

describe("privilege check classification (no database)", () => {
  it("counts a denial only as Unauthorized; success is a failure and any other error is inconclusive", async () => {
    const { classifyAllowed, classifyDenied } = await load();
    expect(classifyDenied(undefined, true)).toBe("FAIL (allowed)");
    expect(classifyDenied({ code: 13 }, false)).toBe("pass (Unauthorized)");
    expect(classifyDenied({ codeName: "Unauthorized" }, false)).toBe("pass (Unauthorized)");
    expect(classifyDenied({ codeName: "NetworkTimeout" }, false)).toBe("inconclusive (NetworkTimeout)");
    expect(classifyDenied({ codeName: "OperationNotSupportedInTransaction" }, false)).toBe("inconclusive (OperationNotSupportedInTransaction)");
    expect(classifyAllowed(undefined)).toBe("pass");
    expect(classifyAllowed({ codeName: "Unauthorized" })).toBe("FAIL (Unauthorized)");
    expect(classifyAllowed({ codeName: "Unauthorized", code: 13 })).toBe("FAIL (Unauthorized 13)");
  });
  it("accepts an Atlas-form denial only for the exact target namespace, never a tier restriction", async () => {
    const { classifyDenied } = await load();
    const atlas = (errmsg: string) => ({ code: 8000, codeName: "AtlasError", errmsg });
    expect(classifyDenied(atlas("user is not allowed to do action [remove] on [deletion_ledger.deletionReceipts]"), false, "deletion_ledger.deletionReceipts"))
      .toBe("pass (Unauthorized)");
    expect(classifyDenied(atlas("user is not allowed to do action [remove] on [deletion_ledger.other]"), false, "deletion_ledger.deletionReceipts"))
      .toBe("inconclusive (AtlasError 8000)"); // a different namespace
    expect(classifyDenied(atlas("user is not allowed to do action [remove] on [deletion_ledger.deletionReceiptsX]"), false, "deletion_ledger.deletionReceipts"))
      .toBe("inconclusive (AtlasError 8000)"); // a prefix is not the namespace
    expect(classifyDenied(atlas("createCollection is not allowed in this atlas tier"), false, "deletion_ledger.x")).toBe("inconclusive (AtlasError 8000)");
    expect(classifyDenied(atlas("user is not allowed to do action [remove] on [deletion_ledger.deletionReceipts]"), false, undefined)).toBe("inconclusive (AtlasError 8000)");
    expect(classifyDenied({ code: 8000, codeName: "AtlasError", message: "user is not allowed to do action [insert] on [privilege_check_x.probe]" }, false, "privilege_check_x.probe"))
      .toBe("pass (Unauthorized)");
  });
  it("never prints a password when the connection string cannot be parsed", async () => {
    const malformed = "mongodb+srv://ledger-app:synthetic-Secret-Value@/x";
    for (const [script, env] of [["scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: malformed }],
      ["scripts/ledger-bootstrap.mjs", { LEDGER_BOOTSTRAP_URI: malformed, LEDGER_BOOTSTRAP_DATABASE: "deletion_ledger" }],
      ["scripts/ledger-probe.mjs", { PROBE_MONGODB_URI: malformed }], ["scripts/snapshot-session-probe.mjs", { PROBE_MONGODB_URI: malformed, PROBE_DATABASE: "x" }]] as const) {
      const outcome = await runAll(script, env);
      expect(outcome.code).not.toBe(0); expect(outcome.output).toContain("MongoParseError"); expect(outcome.output).not.toContain("synthetic-Secret-Value");
    }
  });
});

(adminUri ? describe : describe.skip)("P2 least privilege: ledgerAppNoRemove and a readWrite-only bootstrap principal", () => {
  const suffix = randomBytes(5).toString("hex"); const database = `ledger_priv_${suffix}`; const role = `ledgerAppNoRemove_${suffix}`;
  const dbWideRole = `ledgerDbWide_${suffix}`;
  const users = { bootstrap: `ledger-admin-${suffix}`, app: `ledger-app-${suffix}`, broad: `broad-${suffix}`, narrow: `narrow-${suffix}`, dbwide: `dbwide-${suffix}` };
  const passwords = Object.fromEntries(Object.keys(users).map(key => [key, randomBytes(18).toString("hex")])) as Record<keyof typeof users, string>;
  const uriFor = (who: keyof typeof users) => { const url = new URL(adminUri!); url.username = users[who]; url.password = passwords[who]; return url.toString(); };
  let admin: MongoClient;
  const expected = (receipts: number, revision: number) => [
    "allowed: read deletionReceipts and deletionLedgerHead — pass",
    "allowed: insert, update and upsert in a transaction (aborted, nothing kept) — pass",
    "denied: delete in deletionReceipts — pass (Unauthorized)",
    "denied: drop a collection — pass (Unauthorized)",
    "denied: create a collection (aborted transaction) — pass (Unauthorized)",
    "denied: write outside the ledger database (aborted transaction) — pass (Unauthorized)",
    `state: unchanged (receipts ${receipts}, head revision ${revision}) — pass`];
  const leftovers = async () => ({
    collections: (await admin.db(database).listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).sort(),
    databases: (await admin.db().admin().listDatabases({ nameOnly: true })).databases.map(item => item.name).filter(name => name.startsWith("privilege_check_")),
    probes: await admin.db(database).collection("deletionReceipts").countDocuments({ _id: { $regex: "^privilege-check-" } } as never)
      + await admin.db(database).collection("deletionLedgerHead").countDocuments({ _id: { $regex: "^privilege-check-" } } as never) });

  beforeAll(async () => {
    admin = await new MongoClient(adminUri!).connect();
    const adminDb = admin.db("admin");
    // The exact Atlas custom role: find, insert, update on the two ledger collections only; nothing else.
    await adminDb.command({ createRole: role, roles: [], privileges: ["deletionReceipts", "deletionLedgerHead"]
      .map(collection => ({ resource: { db: database, collection }, actions: ["find", "insert", "update"] })) });
    // Control: the same actions granted database-wide also allow creating collections (MongoDB authorizes create with insert).
    await adminDb.command({ createRole: dbWideRole, privileges: [{ resource: { db: database, collection: "" }, actions: ["find", "insert", "update"] }], roles: [] });
    await adminDb.command({ createUser: users.bootstrap, pwd: passwords.bootstrap, roles: [{ role: "readWrite", db: database }] });
    await adminDb.command({ createUser: users.app, pwd: passwords.app, roles: [{ role, db: "admin" }] });
    await adminDb.command({ createUser: users.broad, pwd: passwords.broad, roles: [{ role: "readWrite", db: database }] }); // too broad (has remove)
    await adminDb.command({ createUser: users.narrow, pwd: passwords.narrow, roles: [{ role: "read", db: database }] }); // too narrow
    await adminDb.command({ createUser: users.dbwide, pwd: passwords.dbwide, roles: [{ role: dbWideRole, db: "admin" }] });
  }, 60_000);
  afterAll(async () => {
    if (!admin) return;
    const adminDb = admin.db("admin");
    for (const user of Object.values(users)) await adminDb.command({ dropUser: user }).catch(() => undefined);
    for (const name of [role, dbWideRole]) await adminDb.command({ dropRole: name }).catch(() => undefined);
    await admin.db(database).dropDatabase().catch(() => undefined);
    await admin.close();
  });

  it("bootstraps with readWrite only (no dbAdmin), idempotently", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await run("scripts/ledger-bootstrap.mjs", { LEDGER_BOOTSTRAP_URI: uriFor("bootstrap"), LEDGER_BOOTSTRAP_DATABASE: database }))
        .toEqual({ code: 0, stdout: "ok: ledger collections present; head revision 0\n" });
    }
    expect((await leftovers()).collections).toEqual(["deletionLedgerHead", "deletionReceipts"]);
  }, 90_000);

  it("ledgerAppNoRemove passes every positive and negative check and changes nothing", async () => {
    const result = await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: uriFor("app"), LEDGER_CHECK_DATABASE: database });
    expect(result).toEqual({ code: 0, stdout: `${expected(0, 0).join("\n")}\n` });
    expect(await leftovers()).toEqual({ collections: ["deletionLedgerHead", "deletionReceipts"], databases: [], probes: 0 });
    expect(result.stdout).not.toContain(passwords.app);
  }, 90_000);

  it("the real ledger store works as ledgerAppNoRemove, deletes are refused, and the check still passes afterwards", async () => {
    const key = { version: 1, material: randomBytes(32) };
    const client = await new MongoClient(uriFor("app")).connect();
    try {
      const store = new DeletionReceiptStore(client.db(database), "isolated-test", { active: key, keys: [key] });
      const actor = { kind: "user" as const, userId: new ObjectId().toHexString() }; const operation = randomUUID();
      const alias = "a".repeat(64);
      await store.accept(actor, operation, Date.now(), [alias]);
      expect((await store.read(actor))?.status).toBe("suppressed");
      expect((await store.journalRow(actor))?.revision).toBe(1);
      expect(await store.isProviderSubjectErased(alias)).toBe(true);
      expect((await store.recordLocalCompletion(actor, operation, Date.now())).status).toBe("locally-erased");
      await expect(client.db(database).collection("deletionReceipts").deleteMany({})).rejects.toMatchObject({ codeName: "Unauthorized" });
      await expect(client.db(database).dropDatabase()).rejects.toMatchObject({ codeName: "Unauthorized" });
    } finally { await client.close(); }
    expect(await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: uriFor("app"), LEDGER_CHECK_DATABASE: database }))
      .toEqual({ code: 0, stdout: `${expected(1, 2).join("\n")}\n` });
    expect((await leftovers()).probes).toBe(0);
  }, 90_000);

  it("fails a too-broad principal, a database-wide role and a too-narrow one, without changing anything", async () => {
    const before = await admin.db(database).collection("deletionReceipts").countDocuments({});
    const broad = await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: uriFor("broad"), LEDGER_CHECK_DATABASE: database });
    expect(broad.code).toBe(1);
    expect(broad.stdout).toContain("denied: delete in deletionReceipts — FAIL (allowed)");
    expect(broad.stdout).toContain("denied: drop a collection — FAIL (allowed)");
    expect(broad.stdout).toContain("denied: create a collection (aborted transaction) — FAIL (allowed)");
    expect(broad.stdout).toContain("denied: write outside the ledger database (aborted transaction) — pass (Unauthorized)");
    const dbWide = await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: uriFor("dbwide"), LEDGER_CHECK_DATABASE: database });
    expect(dbWide.code).toBe(1); // database-wide insert = can create collections; the role must be collection-scoped
    expect(dbWide.stdout).toContain("denied: create a collection (aborted transaction) — FAIL (allowed)");
    expect(dbWide.stdout).toContain("denied: delete in deletionReceipts — pass (Unauthorized)");
    const narrow = await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: uriFor("narrow"), LEDGER_CHECK_DATABASE: database });
    expect(narrow.code).toBe(1);
    expect(narrow.stdout).toContain("allowed: insert, update and upsert in a transaction (aborted, nothing kept) — FAIL (Unauthorized 13)");
    // Even the over-privileged run deleted, dropped and created nothing: every target was missing or rolled back.
    expect(await admin.db(database).collection("deletionReceipts").countDocuments({})).toBe(before);
    expect(await leftovers()).toEqual({ collections: ["deletionLedgerHead", "deletionReceipts"], databases: [], probes: 0 });
  }, 90_000);

  it("never commits: every write transaction is aborted", async () => {
    const { runLedgerPrivilegeCheck } = await load();
    const client = await new MongoClient(uriFor("app"), { monitorCommands: true }).connect(); const commands: string[] = [];
    client.on("commandStarted", event => { commands.push(event.commandName); });
    try { expect((await runLedgerPrivilegeCheck({ client, database })).passed).toBe(true); } finally { await client.close(); }
    expect(commands).not.toContain("commitTransaction");
    expect(commands.filter(name => name === "abortTransaction").length).toBeGreaterThanOrEqual(1);
    expect(commands).not.toContain("dropDatabase");
  }, 90_000);

  it("reports a changed state if a write ever persisted (simulated by a session whose abort commits)", async () => {
    const { runLedgerPrivilegeCheck } = await load();
    const client = await new MongoClient(uriFor("app")).connect();
    try {
      // Only the check's explicit sessions (no options) are altered; the driver's implicit sessions stay untouched.
      const original = client.startSession.bind(client);
      Object.assign(client, { startSession: (options?: object) => { const session = original(options);
        return options === undefined ? Object.assign(session, { abortTransaction: () => session.commitTransaction() }) : session; } });
      const outcome = await runLedgerPrivilegeCheck({ client, database, runId: "persisted01" });
      expect(outcome.exitCode).toBe(1);
      expect(outcome.lines[outcome.lines.length - 1]).toMatch(/^state: CHANGED .* probe documents 2\) — FAIL$/);
    } finally { await client.close(); }
    // Remove the synthetic leftovers with the setup principal (the scoped principal cannot delete).
    for (const name of ["deletionReceipts", "deletionLedgerHead"]) await admin.db(database).collection(name).deleteMany({ _id: { $regex: "^privilege-check-persisted01" } } as never);
  }, 90_000);

  it("refuses usage errors and system databases, and prints no credential on connection failure", async () => {
    expect((await run("scripts/ledger-privilege-check.mjs", {})).code).toBe(2);
    expect((await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: uriFor("app"), LEDGER_CHECK_DATABASE: "admin" })).code).toBe(2);
    const refused = await run("scripts/ledger-privilege-check.mjs", { LEDGER_CHECK_URI: (() => { const url = new URL(uriFor("app")); url.password = "wrong"; return url.toString(); })(), LEDGER_CHECK_DATABASE: database });
    expect(refused.code).toBe(1); expect(refused.stdout).toMatch(/^failed: connection \(/); expect(refused.stdout).not.toContain("wrong");
  }, 90_000);
});
