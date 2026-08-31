import { describe, expect, it } from "vitest";

import { InputValidationError } from "@/lib/errors/application-error";
import {
  collectMoneyValues,
  parseManualFields,
  toManualRecordView,
  type ManualRecord,
} from "@/lib/onboarding/manual-record";

describe("manual onboarding financial records", () => {
  it("allows a negative account balance and keeps exact minor units", () => {
    const fields = parseManualFields("accounts", {
      balance: { amount: "-12.34", currency: "ILS" },
      name: "Current account",
      type: "bank",
    });

    expect(collectMoneyValues(fields)[0]?.amountMinor).toBe(-1_234n);
  });

  it("requires positive income and represents certainty in basis points", () => {
    expect(() =>
      parseManualFields("income", {
        amount: { amount: "0", currency: "ILS" },
        certaintyBps: 8_000,
        destination: "bank_account",
        expectedDate: "2026-09-01",
        frequency: "monthly",
        name: "Salary",
      }),
    ).toThrow();

    const income = parseManualFields("income", {
      amount: { amount: "10000.00", currency: "ILS" },
      certaintyBps: 8_000,
      destination: "bank_account",
      expectedDate: "2026-09-01",
      frequency: "monthly",
      name: "Salary",
    });

    expect(collectMoneyValues(income)[0]?.amountMinor).toBe(1_000_000n);
  });

  it("rejects inconsistent loan currency and impossible remaining balances", () => {
    const baseLoan = {
      annualInterestRateBps: 550,
      endDate: "2028-01-01",
      monthlyPayment: { amount: "500", currency: "ILS" },
      name: "Loan",
      nextPaymentDate: "2026-09-10",
      originalAmount: { amount: "10000", currency: "ILS" },
      remainingBalance: { amount: "11000", currency: "ILS" },
    };

    expect(() => parseManualFields("loans", baseLoan)).toThrow(
      InputValidationError,
    );
    expect(() =>
      parseManualFields("loans", {
        ...baseLoan,
        monthlyPayment: { amount: "500", currency: "USD" },
        remainingBalance: { amount: "9000", currency: "ILS" },
      }),
    ).toThrow(InputValidationError);
  });

  it("supports fixed and percentage safety margins without floating point", () => {
    const fixed = parseManualFields("safety_margin", {
      amount: { amount: "1500", currency: "ILS" },
      kind: "fixed",
    });
    const percentage = parseManualFields("safety_margin", {
      basisPoints: 1_000,
      kind: "income_percentage",
    });

    expect(collectMoneyValues(fixed)[0]?.amountMinor).toBe(150_000n);
    expect(percentage).toEqual({
      basisPoints: 1_000,
      kind: "income_percentage",
    });
  });

  it("validates card, recurring-expense, and goal onboarding records", () => {
    expect(
      parseManualFields("cards", {
        billingDay: 15,
        issuer: "Example issuer",
        limit: { amount: "12000", currency: "ILS" },
        name: "Primary card",
        used: { amount: "2400.50", currency: "ILS" },
      }),
    ).toBeDefined();
    expect(
      parseManualFields("expenses", {
        amount: { amount: "450", currency: "ILS" },
        category: "utilities",
        frequency: "monthly",
        name: "Electricity",
        nextDueDate: "2026-09-15",
      }),
    ).toBeDefined();
    expect(
      parseManualFields("goals", {
        currentValue: { amount: "2500", currency: "ILS" },
        priority: 1,
        startingValue: { amount: "1000", currency: "ILS" },
        targetAmount: { amount: "10000", currency: "ILS" },
        targetDate: "2027-12-31",
        title: "Emergency fund",
        type: "emergency_fund",
      }),
    ).toBeDefined();
  });

  it("serializes money to JSON-safe minor-unit strings", () => {
    const fields = parseManualFields("accounts", {
      balance: { amount: "123.45", currency: "ILS" },
      name: "Current account",
      type: "bank",
    });
    const record: ManualRecord = {
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      fields,
      id: "507f1f77bcf86cd799439011",
      section: "accounts",
      source: { kind: "manual" },
      updatedAt: new Date("2026-08-30T10:00:00.000Z"),
      version: 1,
    };
    const view = toManualRecordView(record);

    expect(JSON.stringify(view)).toContain('"amountMinor":"12345"');
    expect(() => JSON.stringify(view)).not.toThrow();
  });

  it("models transactions with positive amounts and explicit direction", () => {
    const accountId = "507f1f77bcf86cd799439011";
    const destinationAccountId = "507f191e810c19729de860ea";
    const transfer = parseManualFields("transactions", {
      accountId,
      amount: { amount: "123.45", currency: "ILS" },
      category: "transfer",
      confidenceBps: 10_000,
      date: "2026-08-31",
      destinationAccountId,
      merchant: null,
      notes: "Transfer between owned accounts",
      recurring: false,
      type: "transfer",
    });

    expect(collectMoneyValues(transfer)[0]?.amountMinor).toBe(12_345n);
    expect(() =>
      parseManualFields("transactions", {
        accountId,
        amount: { amount: "100", currency: "ILS" },
        category: "transfer",
        confidenceBps: 10_000,
        date: "2026-08-31",
        destinationAccountId: accountId,
        merchant: null,
        notes: null,
        recurring: false,
        type: "transfer",
      }),
    ).toThrow(InputValidationError);
  });

  it("requires refunds to reference an original transaction", () => {
    const base = {
      accountId: "507f1f77bcf86cd799439011",
      amount: { amount: "50", currency: "ILS" },
      category: "food",
      confidenceBps: 10_000,
      date: "2026-08-31",
      destinationAccountId: null,
      merchant: "Refund",
      notes: null,
      recurring: false,
      type: "refund",
    };

    expect(() => parseManualFields("transactions", base)).toThrow(
      InputValidationError,
    );
    expect(
      parseManualFields("transactions", {
        ...base,
        refundOfTransactionId: "507f191e810c19729de860ea",
      }),
    ).toMatchObject({
      refundOfTransactionId: "507f191e810c19729de860ea",
      type: "refund",
    });
    expect(() =>
      parseManualFields("transactions", {
        ...base,
        refundOfTransactionId: "507f191e810c19729de860ea",
        type: "expense",
      }),
    ).toThrow(InputValidationError);
  });

  it("rejects ambiguous recurrence dates", () => {
    expect(() =>
      parseManualFields("recurring_transactions", {
        accountId: "507f1f77bcf86cd799439011",
        active: true,
        amount: { amount: "95", currency: "ILS" },
        category: "subscriptions",
        endDate: "2026-09-30",
        frequency: "monthly",
        interval: 1,
        merchant: "Service",
        name: "Subscription",
        nextOccurrenceDate: "2026-10-01",
        startDate: "2026-08-01",
        type: "expense",
      }),
    ).toThrow(InputValidationError);
  });

  it("requires maturity only for fixed-term savings", () => {
    expect(
      parseManualFields("savings", {
        accountIdentifierLast4: "1234",
        availability: "fixed_term",
        balance: { amount: "10000", currency: "ILS" },
        institution: "Example bank",
        maturityDate: "2027-08-31",
        name: "Deposit",
      }),
    ).toBeDefined();

    expect(() =>
      parseManualFields("savings", {
        accountIdentifierLast4: null,
        availability: "fixed_term",
        balance: { amount: "10000", currency: "ILS" },
        institution: null,
        maturityDate: null,
        name: "Invalid deposit",
      }),
    ).toThrow(InputValidationError);
  });
});
