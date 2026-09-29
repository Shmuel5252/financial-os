/** Offline development-baseline manifests and archives: anti-reimport evidence, never a migration to rerun.
 * Archive payloads are inspected with the reviewed adapters for their collections; nothing is copied opaquely:
 * the artifact carries the nested document (so the envelope inspects it too) and restore re-materializes the exact bytes.
 */
import "server-only";
import { createHash } from "node:crypto";
import { Binary, BSON, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { DEVELOPMENT_BASELINE_POLICY } from "@/lib/open-banking/development-baseline";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { projectRecoveryBankConnection } from "@/lib/operations/bank-control-recovery";
import { projectRecoveryBankRecordRevision, projectRecoveryOpenBankingRecord } from "@/lib/operations/bank-record-recovery";

const id = z.instanceof(ObjectId); const alias = z.string().regex(/^[a-f0-9]{64}$/);
const targets = ["accounts", "transactions", "bankConnections", "bankRecordRevisions"] as const;
const internal = ["bankDevelopmentMigrations", "bankDevelopmentArchive", "bankDevelopmentMigrationLocks"];
const digest = <T extends z.ZodTypeAny>(collection: T) => z.object({ collection, id, digest: alias }).strict();
const manifest = z.object({ _id: alias, userId: id, subjectAlias: alias, activeConnectionAlias: alias, oldConnectionAliases: z.array(alias).min(1),
  policyVersion: z.literal(DEVELOPMENT_BASELINE_POLICY), targets: z.array(digest(z.enum(targets))).min(1),
  protectedRecords: z.array(digest(z.string().min(1).max(255))), collectionNames: z.array(z.string().min(1).max(255)),
  state: z.enum(["prepared", "archived", "retired"]), createdAt: z.date(), retiredAt: z.date().optional() }).strict();
const archive = z.object({ _id: z.string(), migrationId: alias, userId: id, collection: z.enum(targets), sourceId: id, digest: alias,
  payload: z.union([z.instanceof(Binary), z.record(z.string(), z.unknown())]), archivedAt: z.date() }).strict();
const fail = (): never => { throw new Error("Bank development recovery requires review"); };
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export function projectRecoveryBankDevelopmentMigration(document: Document): Document {
  try {
    assertRecoveryContent(document); const parsed = manifest.safeParse(document); if (!parsed.success) return fail(); const row = parsed.data;
    const keys = (items: readonly { collection: string; id: ObjectId }[]) => items.map(item => `${item.collection}:${item.id.toHexString()}`);
    const targetKeys = new Set(keys(row.targets)); const sorted = [...row.collectionNames].sort();
    if (row._id !== sha256(`${DEVELOPMENT_BASELINE_POLICY}:${row.userId.toHexString()}:${row.activeConnectionAlias}`)
      || (row.state === "retired") !== (row.retiredAt !== undefined) || !unique(row.oldConnectionAliases) || row.oldConnectionAliases.includes(row.activeConnectionAlias)
      || !unique(keys(row.targets)) || !unique(keys(row.protectedRecords)) || keys(row.protectedRecords).some(key => targetKeys.has(key))
      || !row.targets.some(item => item.collection === "accounts") || !unique(row.collectionNames) || JSON.stringify(sorted) !== JSON.stringify(row.collectionNames)
      || row.collectionNames.some(name => internal.includes(name))
      || [...row.targets, ...row.protectedRecords].some(item => !row.collectionNames.includes(item.collection))) return fail();
    // protectedRecords are IDs/digests of every other document at planning time, including other owners': a mixed-subject release barrier.
    return document;
  } catch { return fail(); }
}

function nested(collection: typeof targets[number], row: Document): Document {
  if (collection === "bankConnections") return projectRecoveryBankConnection(row);
  if (collection === "bankRecordRevisions") return projectRecoveryBankRecordRevision(row);
  if (row.source?.kind !== "open_banking") return fail();
  return projectRecoveryOpenBankingRecord(collection, row);
}

/** Stored (Binary) or artifact (inspected document) form in; artifact form out, so re-projection is idempotent. */
export function projectRecoveryBankDevelopmentArchive(document: Document): Document {
  try {
    const parsed = archive.safeParse(document); if (!parsed.success) return fail(); const row = parsed.data;
    assertRecoveryContent({ ...document, payload: null });
    if (row.payload instanceof Binary && row.payload.sub_type !== Binary.SUBTYPE_DEFAULT) return fail();
    const bytes = row.payload instanceof Binary ? row.payload.value() : BSON.serialize(row.payload);
    if (row._id !== `${row.migrationId}:${row.collection}:${row.sourceId.toHexString()}` || sha256(bytes) !== row.digest) return fail();
    // Exact archived BSON (Long money preserved) must itself be a reviewed record of the same owner, not opaque content.
    const payload = BSON.deserialize(bytes, { promoteLongs: false });
    // The artifact form must reproduce the archived bytes exactly. Values the JS driver would not have written (integral doubles,
    // reordered integer keys) fail here, at capture, instead of producing a package that can never be opened.
    if (sha256(BSON.serialize(payload)) !== row.digest) return fail();
    if (!(payload._id instanceof ObjectId) || !payload._id.equals(row.sourceId) || !(payload.userId instanceof ObjectId) || !payload.userId.equals(row.userId)) return fail();
    nested(row.collection, payload);
    return { ...document, payload };
  } catch { return fail(); }
}

/** Restore step for quarantine output: exact original archive row with its Binary payload, re-verified against the digest. */
export function materializeBankDevelopmentArchive(document: Document): Document {
  const row = projectRecoveryBankDevelopmentArchive(document); const bytes = BSON.serialize(row.payload);
  if (sha256(bytes) !== row.digest) return fail();
  return { ...row, payload: new Binary(bytes) };
}

/** Quarantine-only inspection. Restored manifests are what keep retired development data from being reimported;
 * this reports resurrected retired records and mixed-subject digests instead of resolving them.
 */
export function inspectBankDevelopmentRecovery(input: Readonly<{ migrations: readonly Document[]; archives: readonly Document[];
  connections: readonly Document[]; revisions: readonly Document[]; accounts: readonly Document[]; transactions: readonly Document[] }>) {
  try {
    const manifests = new Map<string, Document>(); const archived = new Map<string, Document>();
    for (const value of input.migrations) {
      // _id is derived from owner + active alias + policy, so it also enforces the (owner, active alias, policy) unique index.
      const row = projectRecoveryBankDevelopmentMigration(value); if (manifests.has(row._id)) return fail(); manifests.set(row._id, row);
    }
    let matched = 0; const unresolved = { missingManifest: 0, missingArchive: 0, retiredReappeared: 0, mixedSubjectDigests: 0 };
    for (const value of input.archives) {
      const row = projectRecoveryBankDevelopmentArchive(value); if (archived.has(row._id)) return fail(); archived.set(row._id, row);
      const owner = manifests.get(row.migrationId);
      if (!owner) { unresolved.missingManifest++; continue; }
      if (!owner.userId.equals(row.userId) || !owner.targets.some((item: Document) => item.collection === row.collection
        && item.id.equals(row.sourceId) && item.digest === row.digest)) return fail();
      matched++;
    }
    // Matches the runtime reader: only retired manifests suppress reimport; interrupted (archived) retirements do not.
    const retired = [...manifests.values()].filter(row => row.state === "retired");
    for (const row of manifests.values()) {
      unresolved.mixedSubjectDigests += row.protectedRecords.length;
      if (row.state === "prepared") continue;
      for (const item of row.targets) if (!archived.has(`${row._id}:${item.collection}:${item.id.toHexString()}`)) unresolved.missingArchive++;
    }
    // Presence checks only: rows are schema-reviewed by their own adapters elsewhere in the package.
    const rows: Record<typeof targets[number], readonly Document[]> = { accounts: input.accounts, transactions: input.transactions,
      bankConnections: input.connections, bankRecordRevisions: input.revisions };
    for (const collection of targets) for (const row of rows[collection]) {
      if (!(row._id instanceof ObjectId) || !(row.userId instanceof ObjectId)) return fail();
      const connection = collection === "accounts" || collection === "transactions" ? row.source?.connectionAlias : row.connectionAlias;
      if (retired.some(item => item.userId.equals(row.userId) && (item.oldConnectionAliases.includes(connection)
        || item.targets.some((target: Document) => target.collection === collection && target.id.equals(row._id))))) unresolved.retiredReappeared++;
    }
    return { policy: "bank-development-recovery-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
