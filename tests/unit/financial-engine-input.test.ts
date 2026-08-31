import { describe, expect, it } from "vitest";

import { buildFinancialEngineInput } from "@/lib/financial-engine/financial-engine-input";
import { money } from "@/lib/domain/money/money";
import type {
  ManualFields,
  ManualRecord,
  ManualSection,
} from "@/lib/onboarding/manual-record";
import type { UserProfile } from "@/lib/profiles/profile";

const bankId = "a".repeat(24);
const cashId = "b".repeat(24);

function record(
  section: ManualSection,
  fields: unknown,
  id: string,
): ManualRecord {
  return {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    fields: fields as ManualFields,
    id,
    section,
    source: { kind: "manual" },
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    version: 1,
  };
}

function profile(): UserProfile {
  return {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    fields: {
      countryCode: "IL",
      displayName: "בדיקה",
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
    },
    id: "f".repeat(24),
    onboarding: {
      completedAt: new Date("2026-08-01T00:00:00.000Z"),
      completedSteps: [],
      currentStep: "review",
      status: "complete",
    },
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    version: 1,
  };
}

describe("financial engine Phase 2 source mapping", () => {
  it("builds conservative, exact and explicitly classified engine inputs", () => {
    const sourceRecords = {
      accounts: [
        record(
          "accounts",
          { balance: money(100_000n, "ILS"), name: "Bank", type: "bank" },
          bankId,
        ),
        record(
          "accounts",
          { balance: money(20_000n, "ILS"), name: "Cash", type: "cash" },
          cashId,
        ),
        record(
          "accounts",
          { balance: money(30_000n, "ILS"), name: "Legacy", type: "savings" },
          "c".repeat(24),
        ),
      ],
      cards: [
        record(
          "cards",
          {
            billingDay: 5,
            issuer: "Issuer",
            limit: money(50_000n, "ILS"),
            name: "Card",
            used: money(10_000n, "ILS"),
          },
          "d".repeat(24),
        ),
      ],
      expenses: [
        record(
          "expenses",
          {
            amount: money(20_000n, "ILS"),
            category: "housing",
            frequency: "monthly",
            name: "Rent",
            nextDueDate: "2026-09-01",
          },
          "e".repeat(24),
        ),
      ],
      income: [
        record(
          "income",
          {
            amount: money(50_000n, "ILS"),
            certaintyBps: 10_000,
            destination: "bank_account",
            expectedDate: "2026-09-01",
            frequency: "monthly",
            name: "Salary",
          },
          "1".repeat(24),
        ),
        record(
          "income",
          {
            amount: money(90_000n, "ILS"),
            certaintyBps: 9_999,
            destination: "cash",
            expectedDate: "2026-09-04",
            frequency: "one_time",
            name: "Possible bonus",
          },
          "2".repeat(24),
        ),
        record(
          "income",
          {
            amount: money(999_000n, "ILS"),
            certaintyBps: 10_000,
            destination: "savings",
            expectedDate: "2026-09-04",
            frequency: "one_time",
            name: "Restricted destination",
          },
          "3".repeat(24),
        ),
      ],
      loans: [
        record(
          "loans",
          {
            annualInterestRateBps: 500,
            endDate: null,
            monthlyPayment: money(10_000n, "ILS"),
            name: "Loan",
            nextPaymentDate: "2026-09-02",
            originalAmount: money(100_000n, "ILS"),
            remainingBalance: money(15_000n, "ILS"),
          },
          "4".repeat(24),
        ),
      ],
      recurring_transactions: [
        record(
          "recurring_transactions",
          {
            accountId: bankId,
            active: true,
            amount: money(7_000n, "ILS"),
            category: "salary",
            endDate: null,
            frequency: "monthly",
            interval: 1,
            merchant: null,
            name: "Recurring income without certainty",
            nextOccurrenceDate: "2026-09-03",
            startDate: "2026-09-03",
            type: "income",
          },
          "5".repeat(24),
        ),
      ],
      safety_margin: [
        record(
          "safety_margin",
          { basisPoints: 1_000, kind: "income_percentage" },
          "6".repeat(24),
        ),
      ],
      savings: [
        record(
          "savings",
          {
            accountIdentifierLast4: null,
            availability: "liquid",
            balance: money(40_000n, "ILS"),
            institution: null,
            maturityDate: null,
            name: "Detailed saving",
          },
          "7".repeat(24),
        ),
      ],
      transactions: [
        record(
          "transactions",
          {
            accountId: bankId,
            amount: money(10_000n, "ILS"),
            category: "salary",
            confidenceBps: 10_000,
            date: "2026-08-30",
            destinationAccountId: null,
            merchant: "Employer",
            notes: null,
            recurring: false,
            type: "income",
          },
          "8".repeat(24),
        ),
        record(
          "transactions",
          {
            accountId: bankId,
            amount: money(5_000n, "ILS"),
            category: "other",
            confidenceBps: 9_999,
            date: "2026-08-30",
            destinationAccountId: null,
            merchant: null,
            notes: null,
            recurring: false,
            type: "income",
          },
          "9".repeat(24),
        ),
        record(
          "transactions",
          {
            accountId: cashId,
            amount: money(2_000n, "ILS"),
            category: "food",
            confidenceBps: 10_000,
            date: "2026-08-31",
            destinationAccountId: null,
            merchant: null,
            notes: null,
            recurring: false,
            type: "expense",
          },
          "0".repeat(24),
        ),
      ],
    } as const;
    const input = buildFinancialEngineInput(
      profile(),
      sourceRecords,
      "2026-08-31T09:00:00.000Z",
      30,
    );

    expect(input.accountBalance.amountMinor).toBe(100_000n);
    expect(input.availableCash.amountMinor).toBe(120_000n);
    expect(input.savingsBalance.amountMinor).toBe(40_000n);
    expect(input.actualMonthlyIncome.amountMinor).toBe(15_000n);
    expect(input.actualMonthlyExpenses.amountMinor).toBe(2_000n);
    expect(input.creditUsed.amountMinor).toBe(10_000n);
    expect(input.debtBalance.amountMinor).toBe(15_000n);
    expect(
      input.monthlyConfirmedIncomeBasis.find(
        (entry) => entry.calendarMonth === "2026-08",
      )?.amount.amountMinor,
    ).toBe(10_000n);
    expect(
      input.monthlyConfirmedIncomeBasis.find(
        (entry) => entry.calendarMonth === "2026-09",
      )?.amount.amountMinor,
    ).toBe(50_000n);
    expect(
      input.events.filter((event) => event.kind === "confirmed_income"),
    ).toHaveLength(1);
    expect(
      input.events
        .filter((event) => event.kind === "uncertain_income")
        .map((event) => event.amount.amountMinor)
        .sort(),
    ).toEqual([7_000n, 90_000n]);
    expect(
      input.events
        .filter((event) => event.kind === "obligation")
        .map((event) => event.source)
        .sort(),
    ).toEqual(["credit_card", "loan", "recurring_expense"]);
    expect(
      input.events.some((event) => event.amount.amountMinor === 999_000n),
    ).toBe(false);
  });

  it("derives the evaluation calendar date using the configured timezone", () => {
    const emptyRecords = {
      accounts: [],
      cards: [],
      expenses: [],
      income: [],
      loans: [],
      recurring_transactions: [],
      safety_margin: [],
      savings: [],
      transactions: [],
    } as const;
    const input = buildFinancialEngineInput(
      profile(),
      emptyRecords,
      "2026-10-24T21:30:00.000Z",
      1,
    );

    expect(input.asOf).toBe("2026-10-24T21:30:00.000Z");
    expect(input.timeZone).toBe("Asia/Jerusalem");
    expect(input.monthlyConfirmedIncomeBasis.map((entry) => entry.calendarMonth)).toEqual([
      "2026-10",
    ]);
    expect(input.availableCash.amountMinor).toBe(0n);
    expect(input.events).toEqual([]);
  });

  it("caps the final loan installment and conservatively preserves duplicate obligations", () => {
    const duplicateExpense = {
      amount: money(1_000n, "ILS"),
      category: "other",
      frequency: "irregular",
      name: "Same obligation",
      nextDueDate: "2026-09-03",
    } as const;
    const sourceRecords = {
      accounts: [],
      cards: [],
      expenses: [
        record("expenses", duplicateExpense, "a".repeat(24)),
        record("expenses", duplicateExpense, "b".repeat(24)),
      ],
      income: [],
      loans: [
        record(
          "loans",
          {
            annualInterestRateBps: 0,
            endDate: null,
            monthlyPayment: money(10_000n, "ILS"),
            name: "Short loan",
            nextPaymentDate: "2026-09-01",
            originalAmount: money(15_000n, "ILS"),
            remainingBalance: money(15_000n, "ILS"),
          },
          "c".repeat(24),
        ),
      ],
      recurring_transactions: [],
      safety_margin: [],
      savings: [],
      transactions: [],
    } as const;
    const input = buildFinancialEngineInput(
      profile(),
      sourceRecords,
      "2026-08-31T09:00:00.000Z",
      60,
    );

    expect(
      input.events
        .filter((event) => event.source === "loan")
        .map((event) => event.amount.amountMinor),
    ).toEqual([10_000n, 5_000n]);
    expect(
      input.events.filter(
        (event) =>
          event.source === "recurring_expense" &&
          event.calendarDate === "2026-09-03",
      ),
    ).toHaveLength(2);
  });
});
