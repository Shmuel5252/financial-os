/** Quarantined identity/ownership and review ordering, never inference/correction replay. */
import "server-only";
import type { Document } from "mongodb";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const fail = (): never => { throw new Error("Transaction intelligence recovery links require review"); };
export function inspectIntelligenceRecoveryLinks(input: Readonly<{ runs: readonly Document[]; reviews: readonly Document[];
  transactions: readonly Document[]; corrections: readonly Document[] }>) {
  try {
    const index = (collection: string, inputs: readonly Document[]) => {
      const rows = new Map<string, Document>(); const retries = new Set<string>();
      for (const value of inputs) {
        const row = initialRecoverySchemas[collection]!.project(value); const id = row._id.toHexString();
        if (rows.has(id)) return fail(); rows.set(id, row);
        if (typeof row.idempotencyKeyHash === "string") {
          const key = `${row.userId.toHexString()}:${row.idempotencyKeyHash}`;
          if (retries.has(key)) return fail(); retries.add(key);
        }
      }
      return rows;
    };
    const runs = index("transactionIntelligenceRuns", input.runs); const reviews = index("transactionIntelligenceReviews", input.reviews);
    const transactions = index("transactions", input.transactions); const corrections = index("budgetCategoryCorrections", input.corrections);
    let matched = 0;
    const unresolved = { missing: 0, inactive: 0, unversioned: 0, sequenceGaps: 0, historicalRuns: runs.size };
    for (const run of runs.values()) {
      const ids = new Set<string>();
      for (const signal of run.signals) {
        ids.add(signal.transactionId.toHexString());
        for (const evidence of signal.evidence) ids.add(evidence.transactionId.toHexString());
      }
      for (const group of run.merchantGroups) for (const id of group.transactionIds) ids.add(id.toHexString());
      for (const id of ids) {
        const transaction = transactions.get(id);
        if (!transaction) { unresolved.missing++; continue; }
        if (!transaction.userId.equals(run.userId)) return fail();
        if (transaction.deletedAt !== null) unresolved.inactive++; else unresolved.unversioned++;
      }
    }
    const sequences = new Map<string, Document[]>();
    for (const review of reviews.values()) {
      const key = `${review.userId.toHexString()}:${review.runId.toHexString()}:${review.signalId}`;
      sequences.set(key, [...(sequences.get(key) ?? []), review]);
      const correction = review.categoryCorrectionId === null ? undefined : corrections.get(review.categoryCorrectionId.toHexString());
      if (review.categoryCorrectionId !== null) {
        if (!correction) unresolved.missing++;
        else if (!correction.userId.equals(review.userId)) return fail();
      }
      const run = runs.get(review.runId.toHexString());
      if (!run) { unresolved.missing++; continue; }
      if (!run.userId.equals(review.userId)) return fail();
      const signal = run.signals.find((value: Document) => value.id === review.signalId);
      if (!signal) return fail(); matched++;
      const requiresCorrection = review.decision === "confirmed" && signal.kind === "category_suggestion";
      if (requiresCorrection !== (review.categoryCorrectionId !== null)) return fail();
      if (correction) {
        if (!correction.transactionId.equals(signal.transactionId)
          || correction.toCategoryId !== signal.suggestedCategoryId) return fail();
        matched++;
      }
    }
    for (const group of sequences.values()) {
      group.sort((left, right) => left.sequence - right.sequence);
      let previous: Document | undefined;
      for (const review of group) {
        const last = previous?.sequence ?? 0;
        if (review.sequence <= last) return fail();
        if (review.sequence !== last + 1) unresolved.sequenceGaps += review.sequence - last - 1;
        else {
          const current = previous?.decision ?? null;
          if (review.decision === "reopened" ? current !== "dismissed" : current !== null && current !== "reopened") return fail();
        }
        previous = review;
      }
    }
    return { policy: "intelligence-recovery-links-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
