import {
  addMoney,
  money,
  subtractMoney,
  type Money,
} from "@/lib/domain/money/money";
import type {
  BudgetActivity,
  BudgetAllocation,
  BudgetCalculation,
  BudgetCategory,
  BudgetPlannedOutflow,
  BudgetScenarioResult,
} from "@/lib/budgets/budget";

export const BUDGET_ENGINE_VERSION = "budget-engine-v1";
export const BUDGET_POLICY_VERSION = "budget-policy-2026-08-31";

function zero(currency: string): Money {
  return money(0n, currency);
}

function sum(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => addMoney(total, value), zero(currency));
}

function requireCurrency(value: Money, currency: string, field: string): void {
  if (value.currency !== currency) {
    throw new RangeError(`${field} must use ${currency}.`);
  }
}

function uniqueByCategory(
  values: readonly BudgetAllocation[],
  field: string,
): ReadonlyMap<string, Money> {
  const result = new Map<string, Money>();
  for (const value of values) {
    if (result.has(value.categoryId)) {
      throw new RangeError(`${field} contains a duplicate category.`);
    }
    result.set(value.categoryId, value.amount);
  }
  return result;
}

export function calculateBudget(input: Readonly<{
  activities: readonly BudgetActivity[];
  allocations: readonly BudgetAllocation[];
  calendarMonth: string;
  carryIn: readonly BudgetAllocation[];
  categories: readonly BudgetCategory[];
  confirmedIncome: Money;
  currency: string;
  plannedOutflows: readonly BudgetPlannedOutflow[];
  uncertainIncome: Money;
}>): BudgetCalculation {
  requireCurrency(input.confirmedIncome, input.currency, "confirmedIncome");
  requireCurrency(input.uncertainIncome, input.currency, "uncertainIncome");
  const categoryIds = new Set<string>();
  for (const category of input.categories) {
    if (categoryIds.has(category.categoryId)) {
      throw new RangeError("Budget categories must be unique.");
    }
    categoryIds.add(category.categoryId);
  }
  const allocations = uniqueByCategory(input.allocations, "allocations");
  const carryIn = uniqueByCategory(input.carryIn, "carryIn");
  for (const [categoryId, amount] of [...allocations, ...carryIn]) {
    if (!categoryIds.has(categoryId)) {
      throw new RangeError("Budget money references an unknown category.");
    }
    requireCurrency(amount, input.currency, "budget amount");
    if (allocations.get(categoryId)?.amountMinor !== undefined && allocations.get(categoryId)!.amountMinor < 0n) {
      throw new RangeError("Budget allocations cannot be negative.");
    }
  }

  const spentByCategory = new Map<string, Money>();
  const plannedByCategory = new Map<string, Money>();
  const uncategorizedActivities: Money[] = [];
  const uncategorizedPlanned: Money[] = [];

  for (const activity of input.activities) {
    requireCurrency(activity.amount, input.currency, "activity");
    const signed =
      activity.kind === "refund"
        ? money(-activity.amount.amountMinor, input.currency)
        : activity.amount;
    if (activity.categoryId === null || !categoryIds.has(activity.categoryId)) {
      uncategorizedActivities.push(signed);
      continue;
    }
    spentByCategory.set(
      activity.categoryId,
      addMoney(spentByCategory.get(activity.categoryId) ?? zero(input.currency), signed),
    );
  }

  for (const planned of input.plannedOutflows) {
    requireCurrency(planned.amount, input.currency, "plannedOutflow");
    if (planned.categoryId === null || !categoryIds.has(planned.categoryId)) {
      uncategorizedPlanned.push(planned.amount);
      continue;
    }
    plannedByCategory.set(
      planned.categoryId,
      addMoney(plannedByCategory.get(planned.categoryId) ?? zero(input.currency), planned.amount),
    );
  }

  const lines = input.categories.map((category) => {
    const allocation = allocations.get(category.categoryId) ?? zero(input.currency);
    const carried = carryIn.get(category.categoryId) ?? zero(input.currency);
    const spent = spentByCategory.get(category.categoryId) ?? zero(input.currency);
    const planned = plannedByCategory.get(category.categoryId) ?? zero(input.currency);
    const available = addMoney(allocation, carried);
    const forecastSpent = addMoney(spent, planned);
    const remaining = subtractMoney(available, spent);
    const forecastRemaining = subtractMoney(available, forecastSpent);

    return {
      allocation,
      carryIn: carried,
      carryOut:
        category.rolloverPolicy === "carry" ? remaining : zero(input.currency),
      categoryId: category.categoryId,
      forecastRemaining,
      forecastSpent,
      remaining,
      rolloverPolicy: category.rolloverPolicy,
      spent,
    } as const;
  });
  const categorizedSpent = sum(lines.map((line) => line.spent), input.currency);
  const categorizedForecastSpent = sum(
    lines.map((line) => line.forecastSpent),
    input.currency,
  );
  const uncategorizedSpent = sum(uncategorizedActivities, input.currency);
  const uncategorizedForecastSpent = addMoney(
    uncategorizedSpent,
    sum(uncategorizedPlanned, input.currency),
  );
  const allocated = sum(input.allocations.map((item) => item.amount), input.currency);

  return {
    allocated,
    calendarMonth: input.calendarMonth,
    categorizedForecastSpent,
    categorizedSpent,
    confirmedIncome: input.confirmedIncome,
    lines,
    totalForecastSpent: addMoney(
      categorizedForecastSpent,
      uncategorizedForecastSpent,
    ),
    totalSpent: addMoney(categorizedSpent, uncategorizedSpent),
    unallocated: subtractMoney(input.confirmedIncome, allocated),
    uncategorizedForecastSpent,
    uncategorizedSpent,
    uncertainIncome: input.uncertainIncome,
  };
}

function nonNegativeDifference(target: Money, current: Money): Money {
  const difference = subtractMoney(target, current);
  return difference.amountMinor > 0n ? difference : zero(target.currency);
}

export function calculateBudgetScenario(input: Readonly<{
  additionalExpense: Money;
  additionalIncome: Money;
  baseConfirmedPosition: Money;
  expenseReduction: Money;
  investmentProceeds: Money;
  targetBalance: Money | null;
  uncertainIncome: Money;
}>): BudgetScenarioResult {
  const currency = input.baseConfirmedPosition.currency;
  for (const [field, value] of Object.entries(input)) {
    if (value !== null && typeof value === "object" && "amountMinor" in value) {
      requireCurrency(value as Money, currency, field);
      if (field !== "baseConfirmedPosition" && (value as Money).amountMinor < 0n) {
        throw new RangeError("Scenario changes cannot be negative.");
      }
    }
  }
  const positiveDelta = sum(
    [
      input.additionalIncome,
      input.uncertainIncome,
      input.expenseReduction,
      input.investmentProceeds,
    ],
    currency,
  );
  const delta = subtractMoney(positiveDelta, input.additionalExpense);
  const scenarioPosition = addMoney(input.baseConfirmedPosition, delta);
  const targetBalance = input.targetBalance ?? zero(currency);
  const gapToTarget = nonNegativeDifference(targetBalance, scenarioPosition);

  return {
    additionalIncomeNeededToTarget: gapToTarget,
    baseConfirmedPosition: input.baseConfirmedPosition,
    delta,
    gapToTarget,
    hypothetical: true,
    scenarioPosition,
    spendingReductionNeededToTarget: gapToTarget,
    targetBalance,
  };
}
