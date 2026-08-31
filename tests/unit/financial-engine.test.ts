import { describe, expect, it } from "vitest";

import {
  calculateFinancialEngine,
  DEFAULT_HORIZON_DAYS,
  FINANCIAL_ENGINE_VERSION,
  FINANCIAL_POLICY_VERSION,
  type FinancialEngineEvent,
  type FinancialEngineInput,
} from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";

function event(
  id: string,
  kind: FinancialEngineEvent["kind"],
  amountMinor: bigint,
  calendarDate: string,
  occurredAt: string | null = null,
): FinancialEngineEvent {
  return {
    amount: money(amountMinor, "ILS"),
    calendarDate,
    id,
    kind,
    occurredAt,
    source: kind === "obligation" ? "recurring_expense" : "income_source",
  };
}

function input(
  overrides: Partial<FinancialEngineInput> = {},
): FinancialEngineInput {
  return {
    accountBalance: money(1_000_000n, "ILS"),
    actualMonthlyExpenses: money(0n, "ILS"),
    actualMonthlyIncome: money(0n, "ILS"),
    asOf: "2026-08-31T09:00:00.000Z",
    availableCash: money(1_000_000n, "ILS"),
    creditLimit: money(0n, "ILS"),
    creditUsed: money(0n, "ILS"),
    currency: "ILS",
    debtBalance: money(0n, "ILS"),
    events: [],
    horizonDays: DEFAULT_HORIZON_DAYS,
    monthlyConfirmedIncomeBasis: [],
    safetyMargin: { amount: money(0n, "ILS"), kind: "fixed" },
    savingsBalance: money(0n, "ILS"),
    timeZone: "Asia/Jerusalem",
    ...overrides,
  };
}

describe("financial engine", () => {
  it("calculates the conservative minimum future capacity across a 30-day horizon", () => {
    const result = calculateFinancialEngine(
      input({
        availableCash: money(1_200_000n, "ILS"),
        events: [
          event("card", "obligation", 450_000n, "2026-09-01"),
          event("rent", "obligation", 300_000n, "2026-09-02"),
          event("loan", "obligation", 80_000n, "2026-09-03"),
          event("salary", "confirmed_income", 900_000n, "2026-09-10"),
        ],
        safetyMargin: { amount: money(150_000n, "ILS"), kind: "fixed" },
      }),
    );

    expect(result.engineVersion).toBe(FINANCIAL_ENGINE_VERSION);
    expect(result.policyVersion).toBe(FINANCIAL_POLICY_VERSION);
    expect(result.horizonDays).toBe(30);
    expect(result.horizonEndDate).toBe("2026-09-29");
    expect(result.minimumConfirmedBalance.amountMinor).toBe(370_000n);
    expect(result.safeToSpend.amountMinor).toBe(220_000n);
    expect(result.shortfall.amountMinor).toBe(0n);
  });

  it("preserves uncertain income separately without increasing core safety", () => {
    const result = calculateFinancialEngine(
      input({
        availableCash: money(100_000n, "ILS"),
        events: [
          event("expected", "uncertain_income", 50_000n, "2026-08-31"),
          event("bill", "obligation", 30_000n, "2026-09-02"),
        ],
      }),
    );

    expect(result.futureConfirmedBalance.amountMinor).toBe(70_000n);
    expect(result.futureExpectedBalance.amountMinor).toBe(120_000n);
    expect(result.safeToSpend.amountMinor).toBe(70_000n);
    expect(result.totals.uncertainIncome.amountMinor).toBe(50_000n);
    expect(result.monthly.uncertainForecastIncome.amountMinor).toBe(50_000n);
  });

  it("orders an obligation before income on the same date without precise timestamps", () => {
    const result = calculateFinancialEngine(
      input({
        availableCash: money(50_000n, "ILS"),
        events: [
          event("income", "confirmed_income", 100_000n, "2026-09-01"),
          event("obligation", "obligation", 70_000n, "2026-09-01"),
        ],
      }),
    );

    expect(result.timeline.slice(1, 3).map((point) => point.eventId)).toEqual([
      "obligation",
      "income",
    ]);
    expect(result.minimumConfirmedBalance.amountMinor).toBe(-20_000n);
    expect(result.safeToSpend.amountMinor).toBe(0n);
    expect(result.shortfall.amountMinor).toBe(20_000n);
  });

  it("uses reliable timestamps instead of the same-day fallback", () => {
    const result = calculateFinancialEngine(
      input({
        availableCash: money(50_000n, "ILS"),
        events: [
          event(
            "income",
            "confirmed_income",
            100_000n,
            "2026-09-01",
            "2026-08-31T22:00:00Z",
          ),
          event(
            "obligation",
            "obligation",
            70_000n,
            "2026-09-01",
            "2026-08-31T22:00:00.100Z",
          ),
        ],
      }),
    );

    expect(result.timeline.slice(1, 3).map((point) => point.eventId)).toEqual([
      "income",
      "obligation",
    ]);
    expect(result.minimumConfirmedBalance.amountMinor).toBe(50_000n);
  });

  it("calculates percentage margins from confirmed income by applicable month with half-even rounding", () => {
    const result = calculateFinancialEngine(
      input({
        asOf: "2026-08-31T09:00:00.000Z",
        availableCash: money(50_000n, "ILS"),
        horizonDays: 2,
        monthlyConfirmedIncomeBasis: [
          { amount: money(5n, "ILS"), calendarMonth: "2026-08" },
          { amount: money(300_000n, "ILS"), calendarMonth: "2026-09" },
        ],
        safetyMargin: { basisPoints: 1_000, kind: "income_percentage" },
      }),
    );

    expect(result.safetyMarginAtEvaluation.amountMinor).toBe(0n);
    expect(
      result.timeline.find((point) => point.calendarDate === "2026-09-01")
        ?.safetyMargin.amountMinor,
    ).toBe(30_000n);
    expect(result.safeToSpend.amountMinor).toBe(20_000n);
    expect(result.monthly.confirmedIncomeBasis.amountMinor).toBe(5n);
  });

  it("respects explicit horizons and reports applicable monthly forecast events", () => {
    const sevenDays = calculateFinancialEngine(
      input({
        events: [
          event("inside", "obligation", 10_000n, "2026-09-06"),
          event("outside", "obligation", 20_000n, "2026-09-07"),
        ],
        horizonDays: 7,
      }),
    );

    expect(sevenDays.horizonEndDate).toBe("2026-09-06");
    expect(sevenDays.totals.obligations.amountMinor).toBe(10_000n);
    expect(sevenDays.timeline.some((point) => point.eventId === "outside")).toBe(
      false,
    );
  });

  it("calculates exact monthly metrics and credit utilization", () => {
    const result = calculateFinancialEngine(
      input({
        actualMonthlyExpenses: money(120_001n, "ILS"),
        actualMonthlyIncome: money(500_003n, "ILS"),
        creditLimit: money(300_000n, "ILS"),
        creditUsed: money(100_000n, "ILS"),
        events: [
          event("salary", "confirmed_income", 50_000n, "2026-08-31"),
          event("possible", "uncertain_income", 25_000n, "2026-08-31"),
          event("bill", "obligation", 10_000n, "2026-08-31"),
        ],
      }),
    );

    expect(result.monthly.actualNetCashFlow.amountMinor).toBe(380_002n);
    expect(result.monthly.confirmedForecastIncome.amountMinor).toBe(50_000n);
    expect(result.monthly.forecastNetCashFlow.amountMinor).toBe(40_000n);
    expect(result.credit.utilizationBasisPoints).toBe("3333");
  });

  it("rejects duplicate events, currency mismatches, and arithmetic overflow", () => {
    expect(() =>
      calculateFinancialEngine(
        input({
          events: [
            event("duplicate", "obligation", 1n, "2026-08-31"),
            event("duplicate", "obligation", 1n, "2026-09-01"),
          ],
        }),
      ),
    ).toThrow(/unique/);
    expect(() =>
      calculateFinancialEngine(
        input({ availableCash: money(1n, "USD") }),
      ),
    ).toThrow(/engine currency/);
    expect(() =>
      calculateFinancialEngine(
        input({
          availableCash: money(2n ** 63n - 1n, "ILS"),
          events: [event("overflow", "confirmed_income", 1n, "2026-09-01")],
        }),
      ),
    ).toThrow(/int64/);
  });

  it("maintains the safety invariant over a deterministic range of balances", () => {
    for (let starting = -5_000n; starting <= 5_000n; starting += 137n) {
      const result = calculateFinancialEngine(
        input({
          availableCash: money(starting, "ILS"),
          events: [event("bill", "obligation", 777n, "2026-09-01")],
          safetyMargin: { amount: money(333n, "ILS"), kind: "fixed" },
        }),
      );
      expect(result.safeToSpend.amountMinor).toBeGreaterThanOrEqual(0n);
      expect(result.safeToSpend.amountMinor).toBe(
        result.minimumConfirmedBalance.amountMinor > 333n
          ? result.minimumConfirmedBalance.amountMinor - 333n
          : 0n,
      );
    }
  });
});
