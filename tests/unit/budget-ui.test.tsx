import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BudgetPlanner } from "@/components/budgets/budget-planner";
import type { BudgetView } from "@/lib/budgets/budget";
import { messages } from "@/lib/i18n";

const amount = (amountMinor: string) => ({ amountMinor, currency: "ILS" });

const view: BudgetView = {
  activities: [
    {
      amount: amount("120000"),
      categoryId: "system:food",
      correctionCount: 1,
      date: "2026-08-05",
      id: "507f1f77bcf86cd799439011",
      kind: "expense",
      merchant: "מכולת",
      sourceCategoryId: "system:food",
    },
  ],
  calculation: {
    allocated: amount("550000"),
    calendarMonth: "2026-08",
    categorizedForecastSpent: amount("120000"),
    categorizedSpent: amount("120000"),
    confirmedIncome: amount("500000"),
    lines: [
      {
        allocation: amount("550000"),
        carryIn: amount("0"),
        carryOut: amount("0"),
        categoryId: "system:food",
        forecastRemaining: amount("430000"),
        forecastSpent: amount("120000"),
        remaining: amount("430000"),
        rolloverPolicy: "reset",
        spent: amount("120000"),
      },
    ],
    totalForecastSpent: amount("120000"),
    totalSpent: amount("120000"),
    unallocated: amount("-50000"),
    uncategorizedForecastSpent: amount("0"),
    uncategorizedSpent: amount("0"),
    uncertainIncome: amount("100000"),
  },
  categories: [
    {
      categoryId: "system:food",
      hidden: false,
      kind: "system",
      label: null,
      rolloverPolicy: "reset",
      sortOrder: 10,
      systemKey: "food",
      version: 0,
    },
  ],
  coreForecast: {
    calculatedAt: "2026-08-15T09:00:00.000Z",
    confirmedEndingBalance: amount("700000"),
    evaluationEndDate: "2026-09-13",
    safeToSpend: amount("100000"),
    safetyMargin: amount("150000"),
    shortfall: amount("0"),
  },
  currentCalendarMonth: "2026-08",
  period: {
    allocations: [
      { amount: amount("550000"), categoryId: "system:food" },
    ],
    calendarMonth: "2026-08",
    carryIn: [],
    closedAt: null,
    closingSnapshot: null,
    currency: "ILS",
    id: "507f1f77bcf86cd799439012",
    status: "open",
    version: 1,
  },
};

describe("Phase 5 Hebrew/RTL budget presentation", () => {
  it("shows confirmed/uncertain truth, a visible deficit, scenarios, and LTR money", () => {
    const html = renderToStaticMarkup(<BudgetPlanner initialView={view} />);

    expect(html).toContain(messages.budgets.summary.confirmedIncome);
    expect(html).toContain(messages.budgets.summary.uncertainIncome);
    expect(html).toContain(messages.budgets.summary.deficit);
    expect(html).toContain(messages.budgets.scenario.description);
    expect(html).toContain(messages.budgets.corrections.title);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("-500.00 ILS");
    expect(html).not.toContain("Unallocated");
  });
});
