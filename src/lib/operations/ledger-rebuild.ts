/** Deterministic, fail-closed rebuild of the independent deletion ledger from its object-storage evidence (Configuration B).
 *
 * Inputs: every verified mirror (mirror-key signed, full rows under one head) and every verified journal entry (one row per
 * ledger revision, written before the erasure protocol continues). The rebuild is accepted only when it can prove:
 * - ordering: mirrors never lose a row or move a row backwards (each row's revision never decreases across mirrors, and an
 *   acceptance never changes);
 * - completeness: every journaled row at or below the newest mirror's head is in that mirror (at that revision or later);
 * - continuity: journal revisions from the newest mirror's head + 1 up to the highest revision are contiguous, each entry
 *   extends its row (same acceptance, strictly later revision).
 * Anything else — no mirror, a forged/tampered/foreign object, a gap, a conflict, a non-empty target — fails closed. The result
 * can only be at or ahead of every piece of evidence, so a restore that checks mirrors, journal and backup heads still holds.
 * Revisions after the highest journaled one cannot exist for an erasure that started (the protocol journals before fencing) —
 * provided the evidence is complete: operators rebuild from a local copy only through `listedDirectoryObjectStore` (the copy must
 * equal the authoritative bucket listing) and pass the latest known head as `minimumHead`. The journal is never expired.
 * Unjournaled revisions of a lost ledger (never-started acceptances) are not reproduced; later revision numbers may reuse them.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { BackupObjectStore } from "@/lib/operations/backup-capture";
import type { LedgerEnvironment, LedgerKey } from "@/lib/operations/deletion-ledger";
import { DeletionReceiptStore, LEDGER_COLLECTIONS, type DeletionLedgerRow } from "@/lib/operations/deletion-receipt-store";
import { verifiedJournal, verifiedMirrors } from "@/lib/operations/ledger-mirror";

const fail = (reason: string): never => { throw new Error(`Ledger rebuild refused: ${reason}`); };
const digestOf = (head: number, rows: readonly DeletionLedgerRow[]) => createHash("sha256")
  .update(JSON.stringify([head, rows.map(row => [row._id, row.revision, row.current.signature, row.accepted.signature])])).digest("hex");

export type LedgerRebuildPlan = Readonly<{ head: number; rows: readonly DeletionLedgerRow[]; digest: string; baseMirror: string; baseHead: number;
  mirrors: number; journalApplied: readonly [number, number] | null }>;

/** Pure planning step: verifies all evidence and derives the one ledger state it proves. */
export async function planLedgerRebuild(input: Readonly<{ store: BackupObjectStore; environment: LedgerEnvironment;
  ledgerKeys: readonly LedgerKey[]; mirrorKeys: readonly LedgerKey[]; minimumHead?: number }>): Promise<LedgerRebuildPlan> {
  let mirrors: Awaited<ReturnType<typeof verifiedMirrors>>; let journal: Awaited<ReturnType<typeof verifiedJournal>>;
  try { mirrors = await verifiedMirrors(input.store, input.environment, input.ledgerKeys, input.mirrorKeys); } catch { return fail("mirror unverifiable"); }
  try { journal = await verifiedJournal(input.store, input.environment, input.ledgerKeys); } catch { return fail("journal unverifiable"); }
  const base = mirrors[mirrors.length - 1] ?? fail("no mirror");
  // Ordering across mirrors: nothing disappears, nothing moves backwards, acceptances are immutable.
  for (let index = 1; index < mirrors.length; index++) {
    const later = new Map(mirrors[index]!.rows.map(row => [row._id, row]));
    for (const row of mirrors[index - 1]!.rows) {
      const next = later.get(row._id);
      if (!next || next.revision < row.revision || next.accepted.signature !== row.accepted.signature) return fail("mirrors inconsistent");
    }
  }
  const state = new Map(base.rows.map(row => [row._id, row]));
  // Completeness of the base: every journaled write it covers is in it.
  for (const entry of journal.filter(item => item.revision <= base.head)) {
    const row = state.get(entry.row._id);
    if (!row || row.revision < entry.revision || row.accepted.signature !== entry.row.accepted.signature) return fail("mirror incomplete");
  }
  // Continuity after the base: contiguous revisions, each extending its row.
  const tail = journal.filter(item => item.revision > base.head);
  let expected = base.head + 1;
  for (const entry of tail) {
    if (entry.revision !== expected) return fail("journal gap");
    const prior = state.get(entry.row._id);
    if (prior && (prior.revision >= entry.revision || prior.accepted.signature !== entry.row.accepted.signature
      || (prior.current.status === "locally-erased" && entry.row.current.status !== "locally-erased"))) return fail("journal conflict");
    // A completion without its acceptance: the acceptance is older than the base, so the base should have held the row.
    if (!prior && entry.row.current.status !== "suppressed") return fail("mirror incomplete");
    state.set(entry.row._id, entry.row); expected++;
  }
  const head = tail.length > 0 ? tail[tail.length - 1]!.revision : base.head;
  // An independent lower bound (e.g. the worker's LedgerHead metric) the evidence must reach; the listing check covers the rest.
  if (head < (input.minimumHead ?? 0)) return fail("evidence older than expected head");
  const rows = [...state.values()].sort((left, right) => (left._id < right._id ? -1 : left._id > right._id ? 1 : 0));
  return { head, rows, digest: digestOf(head, rows), baseMirror: base.name, baseHead: base.head, mirrors: mirrors.length,
    journalApplied: tail.length > 0 ? [tail[0]!.revision, head] : null };
}

/** Writes the proven state into a fresh, empty ledger database in one majority transaction and reads it back. */
export async function rebuildLedger(input: Readonly<{ store: BackupObjectStore; environment: LedgerEnvironment; ledgerKeys: readonly LedgerKey[];
  mirrorKeys: readonly LedgerKey[]; minimumHead?: number; target: Db }>): Promise<LedgerRebuildPlan> {
  const plan = await planLedgerRebuild(input);
  if ((await input.target.listCollections({}, { nameOnly: true }).toArray()).some(item => !item.name.startsWith("system."))) return fail("target not empty");
  const durable = { writeConcern: { w: "majority" as const } };
  for (const name of Object.values(LEDGER_COLLECTIONS)) await input.target.createCollection(name, durable);
  const session = input.target.client.startSession();
  try {
    // ponytail: one transaction (16 MB limit ≈ tens of thousands of minimal receipts); batch with a staged head if the ledger outgrows it.
    await session.withTransaction(async () => {
      if (plan.rows.length > 0) await input.target.collection<DeletionLedgerRow>(LEDGER_COLLECTIONS.rows).insertMany([...plan.rows], { session });
      await input.target.collection<{ _id: "head"; revision: number }>(LEDGER_COLLECTIONS.head).insertOne({ _id: "head", revision: plan.head }, { session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally { await session.endSession(); }
  // Read back through the normal store: signatures, identity and head must reproduce the plan exactly.
  const written = await new DeletionReceiptStore(input.target, input.environment,
    { active: input.ledgerKeys[input.ledgerKeys.length - 1]!, keys: input.ledgerKeys }).export();
  if (written.head !== plan.head || digestOf(written.head, written.rows) !== plan.digest) return fail("read-back mismatch");
  return plan;
}
