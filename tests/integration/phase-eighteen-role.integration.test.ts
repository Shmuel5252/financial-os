import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { BSON, type Db, Long, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialOsMongoAdapterOptions } from "@/lib/auth/persistence";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { userOwnershipFilter } from "@/lib/data-access/ownership-filter";
import { manualSectionSchema } from "@/lib/onboarding/manual-record";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { AccountReconciliationRepository } from "@/lib/open-banking/account-reconciliation-repository";
import { ensureDevelopmentBaselineIndexes } from "@/lib/open-banking/development-baseline";
import { rateLimiterForDatabase } from "@/lib/security/rate-limiter";
import { inspectStagingBinding } from "@/lib/operations/environment-binding";

// Never accepts MONGODB_URI or an external target. Missing binary is an explicit skip.
const executable = "C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe";
const rehearsal = existsSync(executable) ? describe : describe.skip;

rehearsal("real disposable authenticated MongoDB readWrite rehearsal", () => {
  let child: ChildProcess | undefined;
  let directory: string | undefined;
  let admin: MongoClient | undefined;
  let app: MongoClient;
  const databaseName = "financial_os_staging";
  const otherName = "unrelated_fixture";
  const rootPassword = randomBytes(32).toString("hex");
  const appPassword = randomBytes(32).toString("hex");

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "financial-os-role-rehearsal-"));
    const port = await new Promise<number>((accept, reject) => {
      const socket = createServer(); socket.on("error", reject);
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address();
        if (!address || typeof address === "string") { socket.close(); reject(new Error("Disposable port unavailable")); return; }
        socket.close(() => accept(address.port));
      });
    });
    child = spawn(executable, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--auth"], {
      windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      env: { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP },
    });
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("Disposable Mongo startup timeout")), 30000);
      child!.once("error", () => { clearTimeout(timer); reject(new Error("Disposable Mongo launch failed")); });
      child!.once("exit", () => { clearTimeout(timer); reject(new Error("Disposable Mongo exited before readiness")); });
      child!.stdout!.on("data", (chunk: Buffer) => {
        // Never forward Mongo logs. Only recognize this child instance's readiness.
        if (chunk.toString().includes("Waiting for connections")) { clearTimeout(timer); accept(); }
      });
    });
    const endpoint = `mongodb://127.0.0.1:${port}`;
    const bootstrap = new MongoClient(endpoint, { serverSelectionTimeoutMS: 3000 });
    try {
      await bootstrap.connect();
      await bootstrap.db("admin").command({ createUser: "fixture_root", pwd: rootPassword, roles: [{ role: "root", db: "admin" }] });
    } finally { await bootstrap.close(); }
    admin = new MongoClient(endpoint, { auth: { username: "fixture_root", password: rootPassword }, authSource: "admin" });
    await admin.connect();
    await admin.db("admin").command({ createUser: "fixture_app", pwd: appPassword, roles: [{ role: "readWrite", db: databaseName }] });
    await admin.db(otherName).collection("sentinel").insertOne({ preserved: true });
    app = new MongoClient(endpoint, { auth: { username: "fixture_app", password: appPassword }, authSource: "admin", promoteLongs: false });
    await app.connect();
  }, 60000);

  afterAll(async () => {
    await app?.close(); await admin?.close();
    if (child && child.exitCode === null) {
      await new Promise<void>((accept) => { child!.once("exit", () => accept()); child!.kill(); });
    }
    if (directory) {
      const target = resolve(directory);
      if (resolve(join(target, "..")) !== resolve(tmpdir()) || !basename(target).startsWith("financial-os-role-rehearsal-")) throw new Error("Unsafe fixture cleanup target");
      rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("supports exact money CRUD, count, upsert and unique/partial/TTL index creation", async () => {
    const db = app.db(databaseName); const collection = db.collection("role_fixture");
    await collection.createIndex({ identity: 1 }, { unique: true, partialFilterExpression: { identity: { $type: "string" } }, name: "fixture_unique_partial" });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "fixture_ttl" });
    await collection.insertOne({ identity: "one", amount: Long.fromString("9007199254740993") });
    await collection.insertMany([{ marker: 1 }, { marker: 2 }]);
    expect(await collection.countDocuments()).toBe(3);
    expect(await collection.find({ marker: { $exists: true } }).toArray()).toHaveLength(2);
    expect((await collection.findOne({ identity: "one" }))?.amount.toString()).toBe("9007199254740993");
    await expect(collection.insertOne({ identity: "one" })).rejects.toMatchObject({ code: 11000 });
    await collection.updateOne({ identity: "two" }, { $set: { amount: Long.fromString("-9007199254740993") } }, { upsert: true });
    await collection.findOneAndUpdate({ identity: "one" }, { $set: { marker: 3 } });
    expect((await collection.listIndexes().toArray()).find(x => x.name === "fixture_ttl")?.expireAfterSeconds).toBe(0);
    await collection.deleteOne({ identity: "one" }); await collection.deleteMany({ marker: { $exists: true } });
    expect(await collection.countDocuments()).toBe(1);
    expect(await db.command({ ping: 1 })).toMatchObject({ ok: 1 });
  });

  it("runs the installed Auth.js adapter lifecycle with database-scoped credentials", async () => {
    const adapter = MongoDBAdapter(app, financialOsMongoAdapterOptions(databaseName));
    const user = await adapter.createUser!({ id: new ObjectId().toHexString(), name: "Synthetic", email: "role-fixture@example.invalid", emailVerified: null });
    await adapter.linkAccount!({ userId: user.id, type: "oauth", provider: "google", providerAccountId: "synthetic-provider-subject" });
    expect((await adapter.getUserByAccount!({ provider: "google", providerAccountId: "synthetic-provider-subject" }))?.id).toBe(user.id);
    await adapter.updateUser!({ id: user.id, name: "Changed fixture" });
    expect((await adapter.getUserByEmail!("role-fixture@example.invalid"))?.name).toBe("Changed fixture");
    const sessionToken = randomBytes(32).toString("hex");
    await adapter.createSession!({ sessionToken, userId: user.id, expires: new Date(Date.now() + 60000) });
    expect((await adapter.getSessionAndUser!(sessionToken))?.user.id).toBe(user.id);
    await adapter.updateSession!({ sessionToken, expires: new Date(Date.now() + 120000) });
    await adapter.deleteSession!(sessionToken); expect(await adapter.getSessionAndUser!(sessionToken)).toBeNull();
    const token = randomBytes(32).toString("hex");
    await adapter.createVerificationToken!({ identifier: "role-fixture@example.invalid", token, expires: new Date(Date.now() + 60000) });
    expect((await adapter.useVerificationToken!({ identifier: "role-fixture@example.invalid", token })) !== null).toBe(true);
    expect(await adapter.useVerificationToken!({ identifier: "role-fixture@example.invalid", token })).toBeNull();
    await adapter.unlinkAccount!({ provider: "google", providerAccountId: "synthetic-provider-subject" });
    await adapter.deleteUser!(user.id); expect(await adapter.getUser!(user.id)).toBeNull();
    const binding = await inspectStagingBinding({ FINANCIAL_OS_ENVIRONMENT: "staging", MONGODB_DB_NAME: databaseName }, async () => app.db(databaseName));
    expect(binding.connectedNamespace).toBe("match");
    expect(binding.credentialIdentity).toBe("unknown");
  });

  it("creates every repository's actual runtime indexes twice without elevated grants", async () => {
    const modules = import.meta.glob("../../src/lib/**/*repository.ts");
    const db = app.db(databaseName);
    let factories = 0;
    for (const load of Object.values(modules)) {
      const exports = await load() as Record<string, unknown>;
      for (const [name, exported] of Object.entries(exports)) {
        if (!name.endsWith("RepositoryForDatabase") || name === "manualRecordRepositoryForDatabase" || typeof exported !== "function") continue;
        const repository = (exported as (database: Db) => { ensureIndexes?: () => Promise<void> })(db);
        if (repository.ensureIndexes) { await repository.ensureIndexes(); await repository.ensureIndexes(); factories++; }
      }
    }
    expect(factories).toBeGreaterThanOrEqual(18);
    for (const section of manualSectionSchema.options) {
      const repository = manualRecordRepositoryForDatabase(db, section);
      await repository.ensureIndexes(); await repository.ensureIndexes();
    }
    await new AccountReconciliationRepository(db).ensureIndexes();
    await rateLimiterForDatabase(db).ensureIndexes();
    // Only index creation of the offline utility, never its retirement operation.
    await ensureDevelopmentBaselineIndexes(db);
    expect((await db.listCollections({}, { nameOnly: true }).toArray()).length).toBeGreaterThan(35);
  });

  it("preserves real application profile ownership and version checks", async () => {
    const repository = profileRepositoryForDatabase(app.db(databaseName)); await repository.ensureIndexes();
    const first = { kind: "user" as const, userId: new ObjectId().toHexString() };
    const second = { kind: "user" as const, userId: new ObjectId().toHexString() };
    const fields = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single" as const, primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" };
    const a = await saveProfile(first, fields, { repository });
    await saveProfile(second, fields, { repository });
    expect((await repository.findForActor(second))?.id).not.toBe(a.id);
    expect(await app.db(databaseName).collection<{ _id: ObjectId; userId: ObjectId }>("profiles").countDocuments(userOwnershipFilter(first))).toBe(1);
    await expect(saveProfile(first, fields, { repository })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("denies foreign reads/writes/drop, user/role administration and self escalation", async () => {
    const other = app.db(otherName);
    const denied = async (operation: () => Promise<unknown>) => {
      let code: unknown;
      try { await operation(); } catch (error) { code = (error as { code?: unknown }).code; }
      expect(code).toBe(13); // Unauthorized, not merely a syntax/unsupported-command failure.
    };
    await denied(() => other.collection("sentinel").findOne({}));
    await denied(() => other.collection("sentinel").insertOne({ changed: true }));
    await denied(() => other.dropDatabase());
    await denied(() => app.db("admin").command({ usersInfo: 1 }));
    await denied(() => app.db(databaseName).command({ createUser: "forbidden", pwd: randomBytes(32).toString("hex"), roles: [] }));
    await denied(() => app.db("admin").command({ grantRolesToUser: "fixture_app", roles: [{ role: "root", db: "admin" }] }));
    await denied(() => app.db(databaseName).command({ createRole: "forbidden", privileges: [], roles: [] }));
    const sentinel = await admin!.db(otherName).collection("sentinel").find().toArray();
    expect(sentinel).toHaveLength(1); expect(sentinel[0]?.preserved).toBe(true);
    const status = await app.db(databaseName).command({ connectionStatus: 1 });
    expect(BSON.EJSON.stringify(status.authInfo.authenticatedUserRoles)).toBe(BSON.EJSON.stringify([{ role: "readWrite", db: databaseName }]));
  });
});
