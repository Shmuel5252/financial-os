import { createHash, randomUUID } from "node:crypto";
import { BSON, Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { planDevelopmentBaseline, retireDevelopmentBaseline, verifyProtectedBaseline } from "@/lib/open-banking/development-baseline";

const withMongo = process.env.MONGODB_TEST_URI ? describe : describe.skip;
const alias = (value: string) => createHash("sha256").update(value).digest("hex");
const authorization = "owner-approved-development-reset-2026-09-06";
withMongo("Phase 9 development-only exact archival (real isolated MongoDB)", () => {
  const client = new MongoClient(process.env.MONGODB_TEST_URI ?? "mongodb://not-configured", { promoteLongs: false });
  let database: Db;
  const owner = new ObjectId();
  const other = new ObjectId();
  const input = { owner, subjectAlias: alias("subject"), activeConnectionAlias: alias("new") };
  const accountId = new ObjectId();
  beforeAll(async () => { await client.connect(); });
  beforeEach(async () => {
    database = client.db(`financial_os_migration_test_${randomUUID().replaceAll("-", "")}`);
    await database.collection("bankProviderBindings").insertOne({ userId: owner, provider: "financy", subjectAlias: input.subjectAlias });
    await database.collection("bankConnections").insertOne({ userId: owner, provider: "financy", status: "TERMINATED_BY_USER", connectionAlias: alias("old") });
    const source = { kind: "open_banking", provider: "financy", connectionAlias: alias("old"), recordAlias: alias("old-account") };
    await database.collection("accounts").insertMany([
      { _id: accountId, userId: owner, source, auditTrail: [{ source: "open_banking" }], fields: { type: "bank", balance: { amountMinor: Long.fromString("9007199254740993"), currency: "ILS" } } },
      { _id: new ObjectId(), userId: owner, source: { kind: "manual" }, fields: { amount: Long.fromNumber(1) } },
      { _id: new ObjectId(), userId: other, source, fields: { amount: Long.fromNumber(2) } },
    ]);
    await database.collection("transactions").insertOne({ userId: owner, source: { ...source, recordAlias: alias("old-transaction") }, auditTrail: [{ source: "open_banking" }], fields: { accountId: accountId.toHexString(), amount: Long.fromNumber(10) } });
    await database.collection("bankRecordRevisions").insertOne({ userId: owner, provider: "financy", connectionAlias: alias("old"), recordAlias: source.recordAlias, canonicalRecordId: accountId });
    // Other owner has no actual identity continuity with this owner's old product.
    await database.collection("accounts").updateOne({ userId: other }, { $set: { "source.connectionAlias": alias("other-connection"), "source.recordAlias": alias("other-account") } });
    for (const collection of ["budgetPeriods", "goals", "forecastSnapshots", "budgetCategoryCorrections", "households", "aiConversations", "bankSyncRuns", "bankLifecycleCommands"]) {
      await database.collection(collection).insertOne({ userId: owner, note: "protected", createdAt: new Date("2026-09-01Z") });
    }
  });
  afterEach(async () => { await database.dropDatabase(); });
  afterAll(async () => { await client.close(); });

  it("archives exact BSON/int64 then retires only four target records; retries cannot touch protected data", async () => {
    const plan = await planDevelopmentBaseline(database, input);
    expect(plan.targets.length).toBe(4);
    await retireDevelopmentBaseline(database, plan, authorization);
    await retireDevelopmentBaseline(database, plan, authorization);
    await verifyProtectedBaseline(database, plan);
    expect(await database.collection("accounts").countDocuments()).toBe(2);
    expect(await database.collection("transactions").countDocuments()).toBe(0);
    expect(await database.collection("bankDevelopmentArchive").countDocuments()).toBe(4);
    for (const collection of ["bankDevelopmentArchive", "bankDevelopmentMigrations"]) {
      expect((await database.collection(collection).indexes()).some((index) => Object.keys(index.key)[0] === "userId" && index.unique)).toBe(true);
    }
    const archived = await database.collection("bankDevelopmentArchive").findOne({ sourceId: accountId });
    const recovered = BSON.deserialize(archived!.payload.value(), { promoteLongs: false });
    expect(recovered._id.equals(accountId)).toBe(true);
    expect(recovered.fields.balance.amountMinor.toString()).toBe("9007199254740993");
    const next = await planDevelopmentBaseline(database, input);
    expect(next._id).toBe(plan._id);
    expect(await database.collection("bankDevelopmentMigrations").countDocuments({ state: "retired" })).toBe(1);
  });

  it("blocks references in arbitrary non-Financy documents including composite keys", async () => {
    await database.collection("budgetCategoryCorrections").insertOne({ userId: owner, evidenceKey: `transaction:${accountId.toHexString()}:version:1` });
    await expect(planDevelopmentBaseline(database, input)).rejects.toThrow("protected_record_references_legacy");
    expect(await database.collection("bankDevelopmentArchive").countDocuments()).toBe(0);
    expect(await database.collection("accounts").countDocuments({ _id: accountId })).toBe(1);
  });

  it("blocks mixed manual provenance and wrong actor binding", async () => {
    await expect(planDevelopmentBaseline(database, { ...input, owner: other })).rejects.toThrow("binding_required");
    await database.collection<{ _id: ObjectId; auditTrail: { source: string }[] }>("accounts").updateOne({ _id: accountId }, { $push: { auditTrail: { source: "manual" } } });
    await expect(planDevelopmentBaseline(database, input)).rejects.toThrow("mixed_canonical_provenance");
  });

  it("detects both protected and target changes before deletion", async () => {
    const plan = await planDevelopmentBaseline(database, input);
    await database.collection("goals").updateOne({}, { $set: { note: "changed" } });
    await expect(retireDevelopmentBaseline(database, plan, authorization)).rejects.toThrow("protected_record_changed");
    await database.collection("goals").updateOne({}, { $set: { note: "protected" } });
    await database.collection("accounts").updateOne({ _id: accountId }, { $set: { fields: { changed: true } } });
    await expect(retireDevelopmentBaseline(database, plan, authorization)).rejects.toThrow("target_changed");
    expect(await database.collection("transactions").countDocuments()).toBe(1);
  });

  it("requires exclusive operator access and refuses a running sync", async () => {
    const plan = await planDevelopmentBaseline(database, input);
    await database.collection("bankDevelopmentMigrationLocks").insertOne({ _id: "offline-development-baseline" as never, token: "other-operator" });
    await expect(retireDevelopmentBaseline(database, plan, authorization)).rejects.toThrow("exclusive_operator_lock_required");
    await database.collection("bankSyncRuns").insertOne({ userId: owner, status: "running" });
    await expect(planDevelopmentBaseline(database, input)).rejects.toThrow("sync_running");
  });

  it("recovers a partially retired manifest without widening targets and detects damaged archives", async () => {
    const plan = await planDevelopmentBaseline(database, input);
    await retireDevelopmentBaseline(database, plan, authorization);
    const archive = await database.collection("bankDevelopmentArchive").findOne({ sourceId: accountId });
    await database.collection("accounts").insertOne(BSON.deserialize(archive!.payload.value(), { promoteLongs: false, promoteValues: false }));
    await database.collection("bankDevelopmentMigrations").updateOne({ _id: plan._id as never }, { $set: { state: "archived" } });
    await retireDevelopmentBaseline(database, plan, authorization);
    expect(await database.collection("accounts").countDocuments({ _id: accountId })).toBe(0);
    await database.collection("bankDevelopmentArchive").updateOne({ sourceId: accountId }, { $set: { digest: "damaged" } });
    await expect(retireDevelopmentBaseline(database, plan, authorization)).rejects.toThrow("verified_archive_required");
  });

  it("post-import checks allow only new current-connection bank truth and reject unrelated changes", async () => {
    const plan = await planDevelopmentBaseline(database, input);
    await retireDevelopmentBaseline(database, plan, authorization);
    const inserted = await database.collection("accounts").insertOne({ userId: owner, source: { kind: "open_banking", provider: "financy", connectionAlias: input.activeConnectionAlias } });
    await verifyProtectedBaseline(database, plan, true);
    await database.collection("accounts").updateOne({ _id: inserted.insertedId }, { $set: { "source.kind": "manual" } });
    await expect(verifyProtectedBaseline(database, plan, true)).rejects.toThrow("unexpected_new_source");
  });
});
