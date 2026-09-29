/** Ledger-first erasure ordering (ADR-074/076). Not an endpoint: full-account erasure stays disabled until the erase executor,
 * fencing and policy gates are accepted. Steps are injected; the protocol guarantees only the ordering and retry semantics:
 * durable suppression before any local change, completion only after verification, retries resume the same operation.
 * Mirror-on-accept: the accepted row is journaled to write-once object storage before anything local happens, and the
 * completion is journaled after it is recorded, so a lost ledger can be rebuilt without losing any erasure that started.
 * Without a journal there is no erasure.
 */
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import type { DeletionReceipt } from "@/lib/operations/deletion-ledger";
import type { DeletionLedgerRow, DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";

export type ErasureSteps = Readonly<{
  /** The owner's own server-derived provider subject aliases, read before local erasure removes the bindings. */
  providerSubjectAliases: (actor: Actor) => Promise<readonly string[]>;
  /** Revoke sessions and refuse further writes for the subject. */
  fence: (actor: Actor) => Promise<void>;
  erase: (actor: Actor) => Promise<void>;
  verify: (actor: Actor) => Promise<boolean>;
}>;
type Ledger = Pick<DeletionReceiptStore, "read" | "accept" | "recordLocalCompletion" | "isProviderSubjectErased" | "journalRow">;
/** Writes one ledger row to the write-once journal (`journalLedgerRow` over the backup object store). */
export type LedgerJournal = (row: DeletionLedgerRow) => Promise<void>;

async function journalCurrent(ledger: Ledger, journal: LedgerJournal, actor: Actor) {
  const row = await ledger.journalRow(actor);
  if (row === null) throw new Error("Erasure requires review: ledger row missing");
  try { await journal(row); } catch { throw new Error("Erasure requires review: ledger journal unavailable"); }
}

export async function runLedgerFirstErasure(ledger: Ledger, actor: Actor, operationId: string, now: () => number, steps: ErasureSteps,
  journal: LedgerJournal): Promise<DeletionReceipt> {
  // A retry (even one that lost its operation ID after a timeout) resumes the subject's stored operation;
  // bindings may already be erased, so aliases are not re-read into a new receipt.
  const prior = await ledger.read(actor);
  const accepted = prior ?? await ledger.accept(actor, operationId, now(), await steps.providerSubjectAliases(actor));
  // Journal the current row on every run (idempotent): a retry closes a gap left by a crash after the ledger commit.
  await journalCurrent(ledger, journal, actor);
  if (accepted.status === "locally-erased") return accepted;
  await steps.fence(actor);
  // A binding claimed between the alias read and the fence would escape its marker: nothing is erased until every
  // current alias is marked by a retained receipt.
  for (const alias of await steps.providerSubjectAliases(actor)) {
    if (!await ledger.isProviderSubjectErased(alias)) throw new Error("Erasure requires review: provider subject not marked");
  }
  await steps.erase(actor);
  if (!await steps.verify(actor)) throw new Error("Erasure verification failed");
  const completed = await ledger.recordLocalCompletion(actor, accepted.operationId, now());
  await journalCurrent(ledger, journal, actor);
  return completed;
}
