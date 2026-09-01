import {
  systemBudgetCategoryKeys,
  systemCategoryId,
  type BudgetCorrection,
  type SystemBudgetCategoryKey,
} from "@/lib/budgets/budget";
import type { ManualRecord } from "@/lib/onboarding/manual-record";

type CategorizedTransactionFields = Readonly<{
  category: string;
  refundOfTransactionId: string | null;
  type: "expense" | "income" | "refund" | "transfer";
}>;

export function sourceBudgetCategoryId(value: string): string | null {
  return systemBudgetCategoryKeys.includes(value as SystemBudgetCategoryKey)
    ? systemCategoryId(value as SystemBudgetCategoryKey)
    : null;
}

export function budgetCorrectionState(
  corrections: readonly BudgetCorrection[],
): ReadonlyMap<string, readonly BudgetCorrection[]> {
  const result = new Map<string, BudgetCorrection[]>();
  for (const correction of corrections) {
    const current = result.get(correction.transactionId) ?? [];
    current.push(correction);
    result.set(correction.transactionId, current);
  }
  return result;
}

export function effectiveTransactionCategory(
  record: ManualRecord,
  recordsById: ReadonlyMap<string, ManualRecord>,
  corrections: ReadonlyMap<string, readonly BudgetCorrection[]>,
  visited = new Set<string>(),
): string | null {
  if (visited.has(record.id)) {
    return null;
  }
  visited.add(record.id);
  const transaction = record.fields as CategorizedTransactionFields;
  const ownCorrection = corrections.get(record.id)?.at(-1);
  if (ownCorrection !== undefined) {
    return ownCorrection.toCategoryId;
  }
  if (
    transaction.type === "refund" &&
    transaction.refundOfTransactionId !== null
  ) {
    const original = recordsById.get(transaction.refundOfTransactionId);
    if (original !== undefined) {
      return effectiveTransactionCategory(
        original,
        recordsById,
        corrections,
        visited,
      );
    }
  }
  return sourceBudgetCategoryId(transaction.category);
}
