/** Ledger-first erasure ordering (ADR-074/076). Not an endpoint: full-account erasure stays disabled until the erase executor,
 * fencing and policy gates are accepted. Steps are injected; the protocol guarantees only the ordering and retry semantics:
 * durable suppression before any local change, completion only after verification, retries resume the same operation.
 */
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import type { DeletionReceipt } from "@/lib/operations/deletion-ledger";
import type { DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";

export type ErasureSteps = Readonly<{
  /** The owner's own server-derived provider subject aliases, read before local erasure removes the bindings. */
  providerSubjectAliases: (actor: Actor) => Promise<readonly string[]>;
  /** Revoke sessions and refuse further writes for the subject. */
  fence: (actor: Actor) => Promise<void>;
  erase: (actor: Actor) => Promise<void>;
  verify: (actor: Actor) => Promise<boolean>;
}>;
type Ledger = Pick<DeletionReceiptStore, "read" | "accept" | "recordLocalCompletion" | "isProviderSubjectErased">;

export async function runLedgerFirstErasure(ledger: Ledger, actor: Actor, operationId: string, now: () => number, steps: ErasureSteps): Promise<DeletionReceipt> {
  // A retry (even one that lost its operation ID after a timeout) resumes the subject's stored operation;
  // bindings may already be erased, so aliases are not re-read into a new receipt.
  const prior = await ledger.read(actor);
  const accepted = prior ?? await ledger.accept(actor, operationId, now(), await steps.providerSubjectAliases(actor));
  if (accepted.status === "locally-erased") return accepted;
  await steps.fence(actor);
  // A binding claimed between the alias read and the fence would escape its marker: nothing is erased until every
  // current alias is marked by a retained receipt.
  for (const alias of await steps.providerSubjectAliases(actor)) {
    if (!await ledger.isProviderSubjectErased(alias)) throw new Error("Erasure requires review: provider subject not marked");
  }
  await steps.erase(actor);
  if (!await steps.verify(actor)) throw new Error("Erasure verification failed");
  return ledger.recordLocalCompletion(actor, accepted.operationId, now());
}
