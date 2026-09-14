/** Injected independent ledger collection. No application DB/env fallback, no TTL, no deletion execution. */
import "server-only";
import { type Collection, MongoServerError } from "mongodb";
import type { Actor } from "@/lib/auth/actor";
import { beginDeletion, completeLocalDeletion, deletionSubject, validateDeletionReceipt,
  type DeletionReceipt, type LedgerEnvironment, type LedgerKey } from "@/lib/operations/deletion-ledger";

export type DeletionLedgerRow = { _id: string; current: DeletionReceipt; accepted: DeletionReceipt };
/** Application-wide write fencing, independent durability and release watermarks are NOT implemented here. */
export class DeletionReceiptStore {
  constructor(private readonly collection: Collection<DeletionLedgerRow>, private readonly env: LedgerEnvironment, private readonly key: LedgerKey) {}
  private id(actor: Actor) {
    if (actor.kind !== "user") throw new Error("Deletion ledger conflict");
    return `${this.env}:${this.key.version}:${deletionSubject(actor.userId, this.env, this.key)}`;
  }
  private validate(row: DeletionLedgerRow, actor: Actor): DeletionReceipt {
    const current = validateDeletionReceipt(row.current, this.env, [this.key]);
    const accepted = validateDeletionReceipt(row.accepted, this.env, [this.key]);
    if (Object.keys(row).sort().join(",") !== "_id,accepted,current" || row._id !== this.id(actor)
      || accepted.status !== "suppressed" || current.subject !== accepted.subject
      || current.subject !== deletionSubject(actor.userId, this.env, this.key)
      || current.operationId !== accepted.operationId || current.acceptedAt !== accepted.acceptedAt) throw new Error("Deletion ledger conflict");
    return current;
  }
  async accept(actor: Actor, operationId: string, at: number): Promise<DeletionReceipt> {
    const proposed = beginDeletion(actor, this.env, operationId, at, this.key);
    try {
      await this.collection.insertOne({ _id: this.id(actor), current: proposed, accepted: proposed }, { writeConcern: { w: "majority" } });
      return proposed;
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000)) throw new Error("Deletion ledger unavailable");
      const row = await this.read(actor);
      if (!row || row.operationId !== operationId) throw new Error("Deletion ledger conflict");
      return row;
    }
  }
  async read(actor: Actor): Promise<DeletionReceipt | null> {
    let row: DeletionLedgerRow | null;
    try { row = await this.collection.findOne({ _id: this.id(actor) }); }
    catch { throw new Error("Deletion ledger unavailable"); }
    return row ? this.validate(row, actor) : null;
  }
  /** Caller may use this only AFTER full local erasure verification; no provider completion is implied. */
  async recordLocalCompletion(actor: Actor, operationId: string, at: number): Promise<DeletionReceipt> {
    const prior = await this.read(actor);
    if (!prior || prior.operationId !== operationId) throw new Error("Deletion ledger conflict");
    if (prior.status === "locally-erased") return prior;
    const next = completeLocalDeletion(prior, actor, this.env, at, this.key);
    try {
      const result = await this.collection.updateOne({ _id: this.id(actor), "current.signature": prior.signature },
        { $set: { current: next } }, { writeConcern: { w: "majority" } });
      if (result.modifiedCount === 1) return next;
    } catch { throw new Error("Deletion ledger unavailable"); }
    const raced = await this.read(actor);
    if (!raced || raced.operationId !== operationId || raced.status !== "locally-erased") throw new Error("Deletion ledger conflict");
    return raced;
  }
}
