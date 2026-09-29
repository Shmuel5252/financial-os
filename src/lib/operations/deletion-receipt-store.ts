/** Independent deletion ledger (B1 target: a separate replica set/cluster with its own principal). No application DB/env
 * fallback, no TTL, no deletion execution. Every accepted or completed receipt advances a monotonic head in the same
 * majority transaction, so readers get a consistent (receipts, head) snapshot and restores can detect ledger rollback.
 */
import "server-only";
import { type ClientSession, type Db } from "mongodb";
import type { Actor } from "@/lib/auth/actor";
import { beginDeletion, completeLocalDeletion, deletionSubject, providerSubjectMarker, validateDeletionReceipt,
  type DeletionReceipt, type LedgerEnvironment, type LedgerKey } from "@/lib/operations/deletion-ledger";

export type DeletionLedgerRow = { _id: string; current: DeletionReceipt; accepted: DeletionReceipt; revision: number };
type LedgerHeadRow = { _id: "head"; revision: number };
export type LedgerSnapshot = Readonly<{ receipts: readonly DeletionReceipt[]; head: number; readAt: number }>;
/** The full rows (acceptance, current state, last revision) under one head: what the signed mirror and the journal carry. */
export type LedgerExport = LedgerSnapshot & Readonly<{ rows: readonly DeletionLedgerRow[] }>;
export const LEDGER_COLLECTIONS = { rows: "deletionReceipts", head: "deletionLedgerHead" } as const;
/** Writes use the active key; every readable version still validates receipts and answers marker/actor lookups after rotation. */
export type LedgerKeyring = Readonly<{ active: LedgerKey; keys: readonly LedgerKey[] }>;

class LedgerConflict extends Error { constructor() { super("Deletion ledger conflict"); } }
const unavailable = () => new Error("Deletion ledger unavailable");

/** Structural validation that does not need the actor: signatures, row identity, immutable acceptance. */
export function validateLedgerRow(row: DeletionLedgerRow, env: LedgerEnvironment, keys: readonly LedgerKey[]): DeletionReceipt {
  if (row === null || typeof row !== "object") throw new LedgerConflict();
  const current = validateDeletionReceipt(row.current, env, keys);
  const accepted = validateDeletionReceipt(row.accepted, env, keys);
  if (Object.keys(row).sort().join(",") !== "_id,accepted,current,revision" || !Number.isSafeInteger(row.revision) || row.revision < 1
    || row._id !== `${env}:${current.keyVersion}:${current.subject}` || accepted.status !== "suppressed" || current.subject !== accepted.subject
    || current.operationId !== accepted.operationId || current.acceptedAt !== accepted.acceptedAt
    || JSON.stringify(current.providerSubjects) !== JSON.stringify(accepted.providerSubjects)) throw new LedgerConflict();
  return current;
}

export class DeletionReceiptStore {
  private readonly rows; private readonly head;
  private readonly key: LedgerKey; private readonly readable: readonly LedgerKey[];
  constructor(private readonly database: Db, private readonly env: LedgerEnvironment, keyring: LedgerKeyring,
    private readonly now: () => number = () => Date.now()) {
    if (!keyring.keys.some(key => key.version === keyring.active.version) || new Set(keyring.keys.map(key => key.version)).size !== keyring.keys.length) throw new LedgerConflict();
    this.key = keyring.active; this.readable = keyring.keys;
    const durable = { readConcern: { level: "majority" as const }, writeConcern: { w: "majority" as const } };
    this.rows = database.collection<DeletionLedgerRow>(LEDGER_COLLECTIONS.rows, durable);
    this.head = database.collection<LedgerHeadRow>(LEDGER_COLLECTIONS.head, durable);
  }
  private id(actor: Actor, key: LedgerKey = this.key) {
    if (actor.kind !== "user") throw new LedgerConflict();
    return `${this.env}:${key.version}:${deletionSubject(actor.userId, this.env, key)}`;
  }
  private ids(actor: Actor) { return this.readable.map(key => this.id(actor, key)); }
  private validateRow(row: DeletionLedgerRow): DeletionReceipt { return validateLedgerRow(row, this.env, this.readable); }
  private validate(row: DeletionLedgerRow, actor: Actor): DeletionReceipt {
    const current = this.validateRow(row);
    if (!this.ids(actor).includes(row._id)) throw new LedgerConflict();
    return current;
  }
  /** Runs work in a majority transaction; conflicts and validation failures keep their meaning, everything else is "unavailable". */
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    let session: ClientSession;
    try { session = this.database.client.startSession(); } catch { throw unavailable(); }
    try {
      let result: T | undefined;
      await session.withTransaction(async () => { result = await work(session); },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      return result as T;
    } catch (error) {
      if (error instanceof LedgerConflict || (error instanceof Error && error.message === "Deletion safety validation failed")) throw error;
      throw unavailable();
    } finally { await session.endSession().catch(() => undefined); }
  }
  private async advance(session: ClientSession): Promise<number> {
    const head = await this.head.findOneAndUpdate({ _id: "head" }, { $inc: { revision: 1 } }, { upsert: true, returnDocument: "after", session });
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 1) throw unavailable();
    return head.revision;
  }
  /** Idempotent by operation: a retry (e.g. after a timeout) returns the stored receipt and never advances the head again. */
  async accept(actor: Actor, operationId: string, at: number, providerSubjectAliases: readonly string[] = []): Promise<DeletionReceipt> {
    const proposed = beginDeletion(actor, this.env, operationId, at, this.key, providerSubjectAliases);
    const id = this.id(actor);
    return this.transaction(async session => {
      const row = await this.rows.findOne({ _id: { $in: this.ids(actor) } }, { session });
      if (row) {
        const current = this.validate(row, actor);
        // Markers of a receipt sealed under an older key cannot be compared byte-for-byte; the operation must match.
        if (current.operationId !== operationId || (current.keyVersion === this.key.version
          && JSON.stringify(current.providerSubjects) !== JSON.stringify(proposed.providerSubjects))) throw new LedgerConflict();
        return current;
      }
      const revision = await this.advance(session);
      await this.rows.insertOne({ _id: id, current: proposed, accepted: proposed, revision }, { session });
      return proposed;
    });
  }
  async read(actor: Actor): Promise<DeletionReceipt | null> {
    let row: DeletionLedgerRow | null;
    try { row = await this.rows.findOne({ _id: { $in: this.ids(actor) } }); }
    catch (error) { if (error instanceof LedgerConflict) throw error; throw unavailable(); }
    return row ? this.validate(row, actor) : null;
  }
  /** Caller may use this only AFTER full local erasure verification; no provider completion is implied. */
  async recordLocalCompletion(actor: Actor, operationId: string, at: number): Promise<DeletionReceipt> {
    return this.transaction(async session => {
      const row = await this.rows.findOne({ _id: { $in: this.ids(actor) } }, { session });
      if (!row) throw new LedgerConflict();
      const prior = this.validate(row, actor);
      if (prior.operationId !== operationId) throw new LedgerConflict();
      if (prior.status === "locally-erased") return prior;
      // Completion is sealed with the key that sealed the acceptance, so the receipt stays one consistent version.
      const sealing = this.readable.find(key => key.version === prior.keyVersion) ?? (() => { throw new LedgerConflict(); })();
      const next = completeLocalDeletion(prior, actor, this.env, at, sealing);
      const revision = await this.advance(session);
      const result = await this.rows.updateOne({ _id: row._id, "current.signature": prior.signature }, { $set: { current: next, revision } }, { session });
      if (result.modifiedCount !== 1) throw new LedgerConflict();
      return next;
    });
  }
  /** One snapshot of every receipt and the head that covers them; the only input restore and release may use. */
  async snapshot(): Promise<LedgerSnapshot> { const { receipts, head, readAt } = await this.export(); return { receipts, head, readAt }; }
  /** The same snapshot with full rows, for the signed mirror. */
  async export(): Promise<LedgerExport> {
    let session: ClientSession;
    try { session = this.database.client.startSession({ snapshot: true }); } catch { throw unavailable(); }
    try {
      // Pin the snapshot before any collection read (a read of a not-yet-existing collection does not establish one).
      await this.database.aggregate([{ $documents: [{}] }], { session }).toArray();
      if ((session as unknown as { snapshotTime?: unknown }).snapshotTime === undefined) throw unavailable();
      // Plain handles: the session's snapshot read concern (with its pinned atClusterTime) must not mix with "majority".
      const head = await this.database.collection<LedgerHeadRow>(LEDGER_COLLECTIONS.head).findOne({ _id: "head" }, { session });
      const rows = await this.database.collection<DeletionLedgerRow>(LEDGER_COLLECTIONS.rows).find({}, { session }).sort({ _id: 1 }).toArray();
      const revision = head?.revision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) throw unavailable();
      const receipts = rows.map(row => { if (row.revision > revision) throw new LedgerConflict(); return this.validateRow(row); });
      return { receipts, rows, head: revision, readAt: this.now() };
    } catch (error) {
      if (error instanceof LedgerConflict || (error instanceof Error && error.message === "Deletion safety validation failed")) throw error;
      throw unavailable();
    } finally { await session.endSession().catch(() => undefined); }
  }
  /** The subject's validated row with its revision (mirror-on-accept journaling); null when no receipt exists. */
  async journalRow(actor: Actor): Promise<DeletionLedgerRow | null> {
    let row: DeletionLedgerRow | null;
    try { row = await this.rows.findOne({ _id: { $in: this.ids(actor) } }); }
    catch { throw unavailable(); }
    if (row === null) return null;
    this.validate(row, actor);
    return row;
  }
  /** ADR-076 C3 runtime check: is this provider subject alias marked by a retained deletion receipt? */
  async isProviderSubjectErased(subjectAlias: string): Promise<boolean> {
    const markers = this.readable.map(key => providerSubjectMarker(subjectAlias, this.env, key));
    try { return (await this.rows.countDocuments({ "current.providerSubjects": { $in: markers } }, { limit: 1 })) > 0; }
    catch { throw unavailable(); }
  }
}
