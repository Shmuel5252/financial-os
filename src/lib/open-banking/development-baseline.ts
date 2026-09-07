import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Binary, BSON, ObjectId, type Db, type Document } from "mongodb";

// Offline operator-only recovery utility. Deliberately not reachable from an API,
// page, sync service, or provider adapter. Local writers MUST be stopped.
export const DEVELOPMENT_BASELINE_POLICY = "financy-development-baseline-2026-09-06-v1";
const manifests = "bankDevelopmentMigrations";
const archives = "bankDevelopmentArchive";
const locks = "bankDevelopmentMigrationLocks";
const internal = new Set([manifests, archives, locks]);
const targetCollections = ["accounts", "transactions", "bankConnections", "bankRecordRevisions"] as const;
const ended = ["DISCONNECTED", "TERMINATED_BY_USER", "REVOKED", "REPLACED", "EXPIRED", "TERMINATED_BY_ASPSP", "TERMINATED_BY_TPP"];
const raw = { promoteLongs: false, promoteValues: false } as const;

type RecordDigest = { collection: string; id: ObjectId; digest: string };
export type DevelopmentBaselinePlan = {
  _id: string;
  userId: ObjectId;
  subjectAlias: string;
  activeConnectionAlias: string;
  oldConnectionAliases: string[];
  policyVersion: typeof DEVELOPMENT_BASELINE_POLICY;
  targets: RecordDigest[];
  protectedRecords: RecordDigest[];
  collectionNames: string[];
};
type Manifest = DevelopmentBaselinePlan & { state: "prepared" | "archived" | "retired"; createdAt: Date; retiredAt?: Date };
type Archive = { _id: string; migrationId: string; userId: ObjectId; collection: string; sourceId: ObjectId; digest: string; payload: Binary; archivedAt: Date };

export class DevelopmentMigrationSafetyError extends Error {
  constructor(readonly category: string) { super(`Development migration stopped: ${category}.`); }
}
function assert(condition: unknown, category: string): asserts condition {
  if (!condition) throw new DevelopmentMigrationSafetyError(category);
}
const digest = (document: Document) => createHash("sha256").update(BSON.serialize(document)).digest("hex");
const key = (collection: string, id: ObjectId) => `${collection}:${id.toHexString()}`;

function references(value: unknown, identities: Set<string>): boolean {
  if (value instanceof ObjectId) return identities.has(value.toHexString());
  // Substring detection also catches composite evidence keys containing IDs.
  if (typeof value === "string") return [...identities].some((identity) => value.includes(identity));
  if (Array.isArray(value)) return value.some((item) => references(item, identities));
  if (typeof value === "object" && value !== null && !("_bsontype" in value) && !(value instanceof Date)) {
    return Object.values(value).some((item) => references(item, identities));
  }
  return false;
}

export async function planDevelopmentBaseline(
  database: Db,
  input: Readonly<{ owner: ObjectId; subjectAlias: string; activeConnectionAlias: string }>,
): Promise<DevelopmentBaselinePlan> {
  const { owner, subjectAlias, activeConnectionAlias } = input;
  assert(/^[a-f0-9]{64}$/.test(subjectAlias) && /^[a-f0-9]{64}$/.test(activeConnectionAlias), "invalid_alias");
  assert(await database.collection("bankProviderBindings").countDocuments({ userId: owner, provider: "financy", subjectAlias }) === 1, "binding_required");
  assert(await database.collection("bankSyncRuns").countDocuments({ status: "running" }) === 0, "sync_running");
  const migrationId = createHash("sha256").update(`${DEVELOPMENT_BASELINE_POLICY}:${owner.toHexString()}:${activeConnectionAlias}`).digest("hex");
  const existing = await database.collection<Manifest>(manifests).findOne({ _id: migrationId });
  if (existing !== null) return existing;
  const previous = await database.collection("bankConnections").find({ userId: owner, provider: "financy", connectionAlias: { $ne: activeConnectionAlias } }).toArray();
  assert(previous.length > 0 && previous.every((item) => ended.includes(item.status)), "ended_legacy_connections_required");
  const oldConnectionAliases = previous.map((item) => String(item.connectionAlias));
  assert(oldConnectionAliases.every((item) => /^[a-f0-9]{64}$/.test(item)), "invalid_legacy_alias");
  const source = { userId: owner, "source.kind": "open_banking", "source.provider": "financy", "source.connectionAlias": { $in: oldConnectionAliases } };
  const targets: RecordDigest[] = [];
  const identities = new Set(oldConnectionAliases);
  for (const collection of targetCollections) {
    const filter = collection === "accounts" || collection === "transactions" ? source : { userId: owner, provider: "financy", connectionAlias: { $in: oldConnectionAliases } };
    for await (const document of database.collection(collection).find(filter, raw)) {
      assert(document._id instanceof ObjectId, "unsupported_record_key");
      if (collection === "accounts" || collection === "transactions") {
        assert(Array.isArray(document.auditTrail) && document.auditTrail.length > 0 && document.auditTrail.every((event: Document) => event.source === "open_banking"), "mixed_canonical_provenance");
        assert(document.source.kind === "open_banking" && document.source.provider === "financy", "mixed_source");
        identities.add(document.source.recordAlias);
      }
      if (typeof document.recordAlias === "string") identities.add(document.recordAlias);
      if (typeof document.accountAlias === "string") identities.add(document.accountAlias);
      identities.add(document._id.toHexString());
      targets.push({ collection, id: document._id, digest: digest(document) });
    }
  }
  assert(targets.some((item) => item.collection === "accounts"), "legacy_accounts_required");
  const selected = new Set(targets.map((item) => key(item.collection, item.id)));
  const collectionNames = (await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).filter((name) => !internal.has(name)).sort();
  const protectedRecords: RecordDigest[] = [];
  for (const collection of collectionNames) {
    for await (const document of database.collection(collection).find({}, raw)) {
      assert(document._id instanceof ObjectId, "unsupported_protected_key");
      if (selected.has(key(collection, document._id))) continue;
      assert(!references(document, identities), "protected_record_references_legacy");
      protectedRecords.push({ collection, id: document._id, digest: digest(document) });
    }
  }
  return { _id: migrationId, userId: owner, subjectAlias, activeConnectionAlias, oldConnectionAliases, policyVersion: DEVELOPMENT_BASELINE_POLICY, targets, protectedRecords, collectionNames };
}

export async function verifyProtectedBaseline(database: Db, plan: DevelopmentBaselinePlan, allowNewRecords = false): Promise<void> {
  const selected = new Set(plan.targets.map((item) => key(item.collection, item.id)));
  const protectedByKey = new Map(plan.protectedRecords.map((item) => [key(item.collection, item.id), item.digest]));
  const names = (await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).filter((name) => !internal.has(name));
  let protectedCount = 0;
  for (const collection of names) {
    assert(allowNewRecords || plan.collectionNames.includes(collection), "new_collection_during_migration");
    for await (const document of database.collection(collection).find({}, raw)) {
      assert(document._id instanceof ObjectId, "unsupported_protected_key");
      const recordKey = key(collection, document._id);
      if (selected.has(recordKey)) continue;
      const expected = protectedByKey.get(recordKey);
      if (expected !== undefined) {
        assert(digest(document) === expected, "protected_record_changed");
        protectedCount += 1;
      } else {
        // After cutover only NEW owner-scoped baseline sync records may appear.
        assert(allowNewRecords && [...targetCollections, "bankSyncRuns"].includes(collection) && document.userId?.equals(plan.userId), "unexpected_new_record");
        if (collection === "accounts" || collection === "transactions") {
          assert(document.source?.kind === "open_banking" && document.source.provider === "financy" && document.source.connectionAlias === plan.activeConnectionAlias, "unexpected_new_source");
        } else {
          assert(document.provider === "financy" && (collection === "bankSyncRuns" || document.connectionAlias === plan.activeConnectionAlias), "unexpected_new_source");
        }
      }
    }
  }
  assert(protectedCount === plan.protectedRecords.length, "protected_record_missing");
}

export async function retireDevelopmentBaseline(
  database: Db,
  plan: DevelopmentBaselinePlan,
  authorization: "owner-approved-development-reset-2026-09-06",
): Promise<void> {
  assert(authorization === "owner-approved-development-reset-2026-09-06" && plan.policyVersion === DEVELOPMENT_BASELINE_POLICY, "explicit_development_authority_required");
  assert(await database.collection("bankProviderBindings").countDocuments({ userId: plan.userId, provider: "financy", subjectAlias: plan.subjectAlias }) === 1, "binding_required");
  await ensureDevelopmentBaselineIndexes(database);
  const lockToken = randomUUID();
  // No automatic lease stealing: an interrupted process requires an operator to
  // verify it has stopped before releasing its exact lock. Never race a writer.
  const lockCollection = database.collection<{ _id: string; token: string; acquiredAt: Date }>(locks);
  try { await lockCollection.insertOne({ _id: "offline-development-baseline", token: lockToken, acquiredAt: new Date() }); }
  catch { throw new DevelopmentMigrationSafetyError("exclusive_operator_lock_required"); }
  try {
    const manifestCollection = database.collection<Manifest>(manifests);
    await manifestCollection.updateOne({ _id: plan._id }, { $setOnInsert: { ...plan, state: "prepared", createdAt: new Date() } }, { upsert: true });
    const manifest = await manifestCollection.findOne({ _id: plan._id });
    assert(manifest !== null && manifest.userId.equals(plan.userId), "manifest_owner_mismatch");
    // Always use durable, previously reviewed targets, never recompute a broader scope.
    plan = manifest;
    await verifyProtectedBaseline(database, plan, manifest.state === "retired");
    const archiveCollection = database.collection<Archive>(archives);
    for (const target of plan.targets) {
      const archiveId = `${plan._id}:${key(target.collection, target.id)}`;
      const current = await database.collection(target.collection).findOne({ _id: target.id }, raw);
      if (current !== null) {
        assert(digest(current) === target.digest, "target_changed");
        await archiveCollection.updateOne({ _id: archiveId }, { $setOnInsert: {
          _id: archiveId, migrationId: plan._id, userId: plan.userId, collection: target.collection,
          sourceId: target.id, digest: target.digest, payload: new Binary(BSON.serialize(current)), archivedAt: new Date(),
        } }, { upsert: true });
      } else assert(manifest.state !== "prepared", "target_missing_before_archive");
      const copy = await archiveCollection.findOne({ _id: archiveId });
      assert(copy !== null && copy.userId.equals(plan.userId) && copy.digest === target.digest, "verified_archive_required");
      assert(createHash("sha256").update(copy.payload.value()).digest("hex") === target.digest, "archive_integrity_failure");
    }
    if (manifest.state === "retired") {
      for (const target of plan.targets) assert(await database.collection(target.collection).countDocuments({ _id: target.id }) === 0, "retired_record_reappeared");
      return;
    }
    await verifyProtectedBaseline(database, plan);
    await manifestCollection.updateOne({ _id: plan._id }, { $set: { state: "archived" } });
    // All recovery copies verified before any deletion. Individual deletes are
    // exact-document CAS; partial retirement is recoverable from the manifest.
    for (const target of plan.targets) {
      const current = await database.collection(target.collection).findOne({ _id: target.id }, raw);
      if (current === null) continue;
      assert(digest(current) === target.digest, "target_changed");
      const result = await database.collection(target.collection).deleteOne({ _id: target.id, userId: plan.userId, $expr: { $eq: ["$$ROOT", { $literal: current }] } });
      assert(result.deletedCount === 1, "target_changed_during_retirement");
    }
    await verifyProtectedBaseline(database, plan);
    await manifestCollection.updateOne({ _id: plan._id }, { $set: { state: "retired", retiredAt: new Date() } });
  } finally {
    await lockCollection.deleteOne({ _id: "offline-development-baseline", token: lockToken });
  }
}

export async function ensureDevelopmentBaselineIndexes(database: Db): Promise<void> {
  await database.collection(manifests).createIndex({ userId: 1, activeConnectionAlias: 1, policyVersion: 1 }, { unique: true, name: "bank_development_migration_owner_active_policy" });
  await database.collection(archives).createIndex({ userId: 1, migrationId: 1, collection: 1, sourceId: 1 }, { unique: true, name: "bank_development_archive_owner_source" });
}
