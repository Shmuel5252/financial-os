/** Scheduled capture coordinator (A): one snapshot session per capture, reviewed adapters only, write-once upload.
 * Crash-consistent at a single cluster time. Anything that cannot guarantee that — no snapshot support, an unknown
 * collection, an adapter rejection, an over-long capture — fails closed and uploads nothing.
 */
import "server-only";
import { createHash } from "node:crypto";
import { Binary, BSON, type Document, type MongoClient, type Timestamp } from "mongodb";
import { createBackupPackage, type BackupPackage, type RecoverySchemas } from "@/lib/operations/backup-package";
import { recoveryCollections, recoveryPlan } from "@/lib/operations/recovery-plan";

/** Write-once object storage (A target: object-locked bucket). putOnce must never overwrite; delete is not part of the contract. */
export type BackupObjectStore = Readonly<{
  putOnce: (name: string, bytes: Uint8Array) => Promise<void>;
  get: (name: string) => Promise<Uint8Array | null>;
  list: (prefix: string) => Promise<readonly string[]>;
}>;
type Key = Readonly<{ version: number; material: Uint8Array }>;

const fail = (): never => { throw new Error("Backup capture failed closed"); };
const excluded = new Set<string>(recoveryPlan(recoveryCollections).collections.filter(item => item.action === "exclude" || item.action === "rebuild").map(item => item.name));
// Restore bookkeeping created by the restore process itself; it belongs to one target and is never captured.
const operational = new Set(["recoveryQuarantine"]);

export function encodeBackupPackage(pack: BackupPackage): Uint8Array {
  return BSON.serialize({ manifest: pack.manifest, signature: pack.signature,
    parts: pack.parts.map(part => ({ header: part.header, iv: new Binary(part.iv), tag: new Binary(part.tag), ciphertext: new Binary(part.ciphertext) })) });
}
export function decodeBackupPackage(bytes: Uint8Array): BackupPackage {
  try {
    const decoded = BSON.deserialize(bytes, { promoteLongs: false, promoteBuffers: true });
    return { manifest: decoded.manifest, signature: decoded.signature,
      parts: (decoded.parts as Document[]).map(part => ({ header: part.header, iv: part.iv, tag: part.tag, ciphertext: part.ciphertext })) };
  } catch { return fail(); }
}

export async function captureBackup(input: Readonly<{
  client: MongoClient; databaseName: string; schemas: RecoverySchemas; indexManifestDigest: string; key: Key;
  ledgerHead: () => Promise<number>; store: BackupObjectStore; now: () => number; maxDurationMs: number;
}>): Promise<Readonly<{ name: string; atClusterTime: string; ledgerHead: number }>> {
  const startedAt = input.now();
  // Read before the snapshot: a restore needs a ledger at least this new, or the ledger was rolled back behind the backup.
  const ledgerHead = await input.ledgerHead();
  if (!Number.isSafeInteger(ledgerHead) || ledgerHead < 0 || !Number.isSafeInteger(input.maxDurationMs) || input.maxDurationMs < 1) return fail();
  const database = input.client.db(input.databaseName);
  try {
    const present = (await database.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name)
      .filter(name => !name.startsWith("system.") && !operational.has(name));
    if (present.some(name => !recoveryCollections.includes(name))) return fail();
  } catch { return fail(); }
  const session = input.client.startSession({ snapshot: true });
  let pack: BackupPackage; let atClusterTime: string;
  try {
    // Pin the cluster time before any collection read: a read of a missing collection returns no cluster time,
    // which would otherwise let later reads choose a later snapshot.
    await database.aggregate([{ $documents: [{}] }], { session }).toArray();
    if ((session as unknown as { snapshotTime?: Timestamp }).snapshotTime === undefined) return fail();
    const records: Record<string, Document[]> = {};
    for (const name of recoveryCollections) {
      // Excluded/rebuilt collections (sessions, tokens, archive) are never read at all; every other one is read in the snapshot.
      records[name] = excluded.has(name) ? []
        : await database.collection(name).find({}, { session, promoteLongs: false }).sort({ _id: 1 }).toArray();
    }
    const snapshotTime = (session as unknown as { snapshotTime?: Timestamp }).snapshotTime;
    if (snapshotTime === undefined || input.now() - startedAt > input.maxDurationMs) return fail();
    atClusterTime = snapshotTime.toString();
    pack = createBackupPackage(records, input.schemas, input.indexManifestDigest, input.key, { atClusterTime, capturedAt: startedAt, ledgerHead });
  } catch { return fail(); } finally { await session.endSession().catch(() => undefined); }
  const bytes = encodeBackupPackage(pack);
  const name = `packages/${atClusterTime.padStart(20, "0")}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.bson`;
  try { await input.store.putOnce(name, bytes); } catch { return fail(); }
  return { name, atClusterTime, ledgerHead };
}
