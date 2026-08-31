import { describe, expect, it } from "vitest";

import type { BudgetCategory } from "@/lib/budgets/budget";
import {
  calculateBudget,
  calculateBudgetScenario,
} from "@/lib/domain/budgets/budget-engine";
import { money } from "@/lib/domain/money/money";

const categories: readonly BudgetCategory[] = [
  {
    categoryId: "system:food",
    hidden: false,
    kind: "system",
    label: null,
    rolloverPolicy: "carry",
    sortOrder: 10,
    systemKey: "food",
    version: 0,
  },
  {
    categoryId: "system:housing",
    hidden: false,
    kind: "system",
    label: null,
    rolloverPolicy: "reset",
    sortOrder: 20,
    systemKey: "housing",
    version: 0,
  },
];

describe("Phase 5 deterministic budget engine", () => {
  it("uses confirmed income only and exposes an exact over-allocation deficit", () => {
    const result = calculateBudget({
      activities: [],
      allocations: [
        { amount: money(6_000n, "ILS"), categoryId: "system:food" },
        { amount: money(5_000n, "ILS"), categoryId: "system:housing" },
      ],
      calendarMonth: "2026-08",
      carryIn: [],
      categories,
      confirmedIncome: money(10_000n, "ILS"),
      currency: "ILS",
      plannedOutflows: [],
      uncertainIncome: money(99_999n, "ILS"),
    });

    expect(result.allocated.amountMinor).toBe(11_000n);
    expect(result.unallocated.amountMinor).toBe(-1_000n);
    expect(result.uncertainIncome.amountMinor).toBe(99_999n);
  });

  it("reduces same-period spending for refunds without losing uncategorized cash activity", () => {
    const result = calculateBudget({
      activities: [
        {
          amount: money(8_000n, "ILS"),
          categoryId: "system:food",
          date: "2026-08-02",
          id: "expense",
          kind: "expense",
        },
        {
          amount: money(2_000n, "ILS"),
          categoryId: "system:food",
          date: "2026-08-10",
          id: "refund",
          kind: "refund",
        },
        {
          amount: money(1_000n, "ILS"),
          categoryId: null,
          date: "2026-08-11",
          id: "uncategorized",
          kind: "expense",
        },
      ],
      allocations: [],
      calendarMonth: "2026-08",
      carryIn: [],
      categories,
      confirmedIncome: money(0n, "ILS"),
      currency: "ILS",
      plannedOutflows: [],
      uncertainIncome: money(0n, "ILS"),
    });

    expect(result.lines[0]?.spent.amountMinor).toBe(6_000n);
    expect(result.uncategorizedSpent.amountMinor).toBe(1_000n);
    expect(result.totalSpent.amountMinor).toBe(7_000n);
  });

  it("keeps reset history local while carrying signed rollover balances", () => {
    const result = calculateBudget({
      activities: [
        {
          amount: money(8_000n, "ILS"),
          categoryId: "system:food",
          date: "2026-08-02",
          id: "food",
          kind: "expense",
        },
        {
          amount: money(7_000n, "ILS"),
          categoryId: "system:housing",
          date: "2026-08-03",
          id: "housing",
          kind: "expense",
        },
      ],
      allocations: [
        { amount: money(5_000n, "ILS"), categoryId: "system:food" },
        { amount: money(5_000n, "ILS"), categoryId: "system:housing" },
      ],
      calendarMonth: "2026-08",
      carryIn: [],
      categories,
      confirmedIncome: money(10_000n, "ILS"),
      currency: "ILS",
      plannedOutflows: [],
      uncertainIncome: money(0n, "ILS"),
    });

    expect(result.lines[0]?.remaining.amountMinor).toBe(-3_000n);
    expect(result.lines[0]?.carryOut.amountMinor).toBe(-3_000n);
    expect(result.lines[1]?.remaining.amountMinor).toBe(-2_000n);
    expect(result.lines[1]?.carryOut.amountMinor).toBe(0n);
  });

  it("forecasts confirmed planned outflows separately from actual spending", () => {
    const result = calculateBudget({
      activities: [
        {
          amount: money(2_000n, "ILS"),
          categoryId: "system:food",
          date: "2026-08-02",
          id: "actual",
          kind: "expense",
        },
      ],
      allocations: [
        { amount: money(10_000n, "ILS"), categoryId: "system:food" },
      ],
      calendarMonth: "2026-08",
      carryIn: [],
      categories,
      confirmedIncome: money(10_000n, "ILS"),
      currency: "ILS",
      plannedOutflows: [
        {
          amount: money(3_000n, "ILS"),
          categoryId: "system:food",
          date: "2026-08-20",
          id: "planned",
        },
      ],
      uncertainIncome: money(0n, "ILS"),
    });

    expect(result.lines[0]?.spent.amountMinor).toBe(2_000n);
    expect(result.lines[0]?.forecastSpent.amountMinor).toBe(5_000n);
    expect(result.lines[0]?.forecastRemaining.amountMinor).toBe(5_000n);
  });

  it("keeps scenario changes hypothetical and solves the exact target gap", () => {
    const result = calculateBudgetScenario({
      additionalExpense: money(500n, "ILS"),
      additionalIncome: money(5_000n, "ILS"),
      baseConfirmedPosition: money(-10_000n, "ILS"),
      expenseReduction: money(3_000n, "ILS"),
      investmentProceeds: money(1_000n, "ILS"),
      targetBalance: money(10_000n, "ILS"),
      uncertainIncome: money(2_000n, "ILS"),
    });

    expect(result.hypothetical).toBe(true);
    expect(result.delta.amountMinor).toBe(10_500n);
    expect(result.scenarioPosition.amountMinor).toBe(500n);
    expect(result.gapToTarget.amountMinor).toBe(9_500n);
    expect(result.additionalIncomeNeededToTarget.amountMinor).toBe(9_500n);
    expect(result.spendingReductionNeededToTarget.amountMinor).toBe(9_500n);
  });

  it("rejects mixed currencies and unknown category references", () => {
    expect(() =>
      calculateBudget({
        activities: [],
        allocations: [
          { amount: money(1n, "USD"), categoryId: "system:food" },
        ],
        calendarMonth: "2026-08",
        carryIn: [],
        categories,
        confirmedIncome: money(0n, "ILS"),
        currency: "ILS",
        plannedOutflows: [],
        uncertainIncome: money(0n, "ILS"),
      }),
    ).toThrow(/ILS/);
    expect(() =>
      calculateBudget({
        activities: [],
        allocations: [
          { amount: money(1n, "ILS"), categoryId: "custom:000000000000000000000001" },
        ],
        calendarMonth: "2026-08",
        carryIn: [],
        categories,
        confirmedIncome: money(0n, "ILS"),
        currency: "ILS",
        plannedOutflows: [],
        uncertainIncome: money(0n, "ILS"),
      }),
    ).toThrow(/unknown category/);
  });
});
