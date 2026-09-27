import "server-only";
import type { Document, ObjectId } from "mongodb";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const fail = (): never => { throw new Error("Budget recovery links require review"); };

export function inspectBudgetRecoveryLinks(input: Readonly<{
  categories: readonly Document[]; corrections: readonly Document[];
  transactions: readonly Document[]; periods: readonly Document[];
}>): { policy: "budget-recovery-links-v1"; releaseAllowed: false; matched: number; virtualCategories: number;
  unresolved: { missing: number; inactive: number; historicalCorrections: number } } {
  try {
    const index = (collection: string, inputs: readonly Document[]) => {
      const rows = new Map<string, Document>();
      const retryKeys = new Set<string>();
      for (const input of inputs) {
        const row = initialRecoverySchemas[collection]!.project(input); const id = row._id.toHexString();
        if (rows.has(id)) return fail(); rows.set(id, row);
        if (typeof row.idempotencyKeyHash === "string") {
          const retryKey = `${row.userId.toHexString()}:${row.idempotencyKeyHash}`;
          if (retryKeys.has(retryKey)) return fail(); retryKeys.add(retryKey);
        }
      }
      return rows;
    };
    const categories = index("budgetCategories", input.categories);
    const corrections = index("budgetCategoryCorrections", input.corrections);
    const transactions = index("transactions", input.transactions);
    const periods = index("budgetPeriods", input.periods);
    const categoryKeys = new Map<string, Document>(); const custom = new Map<string, Document>();
    for (const row of categories.values()) {
      const key = `${row.userId.toHexString()}:${row.categoryId}`;
      if (categoryKeys.has(key)) return fail(); categoryKeys.set(key, row);
      if (row.kind === "custom") custom.set(row.categoryId.toLowerCase(), row);
    }
    let matched = 0; let virtualCategories = 0;
    const unresolved = { missing: 0, inactive: 0, historicalCorrections: corrections.size };
    const categoryLink = (id: string | null, owner: ObjectId) => {
      if (id === null) return;
      if (id.startsWith("system:")) {
        if (categoryKeys.has(`${owner.toHexString()}:${id}`)) matched++;
        else virtualCategories++;
        return;
      }
      const target = custom.get(id.toLowerCase());
      if (!target) { unresolved.missing++; return; }
      if (!target.userId.equals(owner)) return fail(); matched++;
    };
    for (const row of corrections.values()) {
      const target = transactions.get(row.transactionId.toHexString());
      if (!target) unresolved.missing++;
      else {
        if (!target.userId.equals(row.userId)) return fail();
        if (target.deletedAt !== null) unresolved.inactive++; else matched++;
      }
      categoryLink(row.fromCategoryId, row.userId); categoryLink(row.toCategoryId, row.userId);
    }
    const periodKeys = new Set<string>();
    for (const row of periods.values()) {
      const key = `${row.userId.toHexString()}:${row.calendarMonth}`;
      if (periodKeys.has(key)) return fail(); periodKeys.add(key);
      const references = [...row.allocations, ...row.carryIn,
        ...row.auditTrail.flatMap((event: Document) => [...(event.allocationsBefore ?? []), ...event.allocationsAfter]),
        ...(row.closingSnapshot?.lines ?? [])];
      for (const reference of references) categoryLink(reference.categoryId, row.userId);
    }
    // Corrections contain no source revision. Identity matches cannot reconstruct historical categorization.
    return { policy: "budget-recovery-links-v1", releaseAllowed: false, matched, virtualCategories, unresolved };
  } catch { return fail(); }
}
