import { describe, expect, it } from "vitest";

import {
  calculateFinancialEngine,
  type FinancialEngineEvent,
} from "@/lib/domain/financial-engine/financial-engine";
import {
  calculatePurchaseSimulation,
  generateInstallmentSchedule,
  PURCHASE_EVALUATION_HORIZON_DAYS,
  SAFER_DATE_SEARCH_DAYS,
} from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { money } from "@/lib/domain/money/money";

function event(
  id: string,
  kind: FinancialEngineEvent["kind"],
  amountMinor: bigint,
  calendarDate: string,
): FinancialEngineEvent {
  return {
    amount: money(amountMinor, "ILS"),
    calendarDate,
    id,
    kind,
    occurredAt: null,
    source: kind === "obligation" ? "recurring_expense" : "income_source",
  };
}

function baseline(
  availableCashMinor: bigint,
  marginMinor: bigint,
  events: readonly FinancialEngineEvent[] = [],
) {
  return calculateFinancialEngine({
    accountBalance: money(availableCashMinor, "ILS"),
    actualMonthlyExpenses: money(0n, "ILS"),
    actualMonthlyIncome: money(0n, "ILS"),
    asOf: "2026-09-01T09:00:00.000Z",
    availableCash: money(availableCashMinor, "ILS"),
    creditLimit: money(0n, "ILS"),
    creditUsed: money(0n, "ILS"),
    currency: "ILS",
    debtBalance: money(0n, "ILS"),
    events,
    horizonDays: 210,
    monthlyConfirmedIncomeBasis: [],
    safetyMargin: { amount: money(marginMinor, "ILS"), kind: "fixed" },
    savingsBalance: money(0n, "ILS"),
    timeZone: "Asia/Jerusalem",
  });
}

function simulate(
  availableCashMinor: bigint,
  marginMinor: bigint,
  purchaseMinor: bigint,
  events: readonly FinancialEngineEvent[] = [],
) {
  return calculatePurchaseSimulation({
    baseline: baseline(availableCashMinor, marginMinor, events),
    charges: [],
    evaluationHorizonDays: PURCHASE_EVALUATION_HORIZON_DAYS,
    installmentCount: 1,
    installmentFrequency: "monthly",
    inputMode: "one_time",
    proposedDate: "2026-09-01",
    saferDateSearchDays: SAFER_DATE_SEARCH_DAYS,
    totalPurchasePrice: money(purchaseMinor, "ILS"),
  });
}

describe("Phase 7 purchase simulation engine", () => {
  it("distributes minor-unit remainders to the earliest installments exactly", () => {
    const schedule = generateInstallmentSchedule(
      money(100n, "ILS"),
      "2026-01-31",
      3,
    );

    expect(schedule.map((item) => item.amount.amountMinor)).toEqual([
      34n,
      33n,
      33n,
    ]);
    expect(schedule.map((item) => item.calendarDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(
      schedule.reduce((sum, item) => sum + item.amount.amountMinor, 0n),
    ).toBe(100n);
  });

  it("classifies equality with the Safety Margin as SAFE", () => {
    const result = simulate(100n, 20n, 80n);

    expect(result.riskClassification).toBe("SAFE");
    expect(result.minimumConfirmedBalance.amountMinor).toBe(20n);
    expect(result.minimumSafeCapacity.amountMinor).toBe(0n);
    expect(result.saferDate).toBeNull();
  });

  it("classifies zero as CAUTION when the Safety Margin is positive", () => {
    const result = simulate(100n, 20n, 100n);

    expect(result.riskClassification).toBe("CAUTION");
    expect(result.minimumConfirmedBalance.amountMinor).toBe(0n);
    expect(result.obligationsCoverable).toBe(true);
  });

  it("classifies zero as SAFE when the Safety Margin is zero", () => {
    expect(simulate(100n, 0n, 100n).riskClassification).toBe("SAFE");
  });

  it("classifies a negative projection and uncovered obligation as UNSAFE", () => {
    const result = simulate(100n, 0n, 101n);

    expect(result.riskClassification).toBe("UNSAFE");
    expect(result.explanationCodes).toContain("negative_projected_balance");
    expect(result.explanationCodes).toContain(
      "confirmed_obligation_uncovered",
    );
  });

  it("keeps uncertain income out of purchase safety", () => {
    const result = simulate(50n, 0n, 60n, [
      event("expected", "uncertain_income", 1_000n, "2026-09-01"),
    ]);

    expect(result.riskClassification).toBe("UNSAFE");
    expect(result.timeline.at(-1)?.expectedBalance.amountMinor).toBe(990n);
  });

  it("uses conservative same-day ordering and returns only the first later SAFE date", () => {
    const result = simulate(50n, 20n, 80n, [
      event("salary", "confirmed_income", 100n, "2026-09-05"),
    ]);

    expect(result.riskClassification).toBe("UNSAFE");
    expect(result.saferDate).toBe("2026-09-06");
  });

  it("returns no safe date when none exists in the approved 90-day search", () => {
    const result = simulate(50n, 20n, 80n);

    expect(result.riskClassification).toBe("UNSAFE");
    expect(result.saferDate).toBeNull();
  });

  it("includes explicit interest and fees in the exact financed cost and schedule", () => {
    const result = calculatePurchaseSimulation({
      baseline: baseline(10_000n, 0n),
      charges: [
        {
          amount: money(101n, "ILS"),
          kind: "interest",
          label: "Known interest",
          provenance: { kind: "user_reported", note: "Contract" },
        },
        {
          amount: money(2n, "ILS"),
          kind: "fee",
          label: "Known fee",
          provenance: { kind: "user_reported", note: null },
        },
      ],
      evaluationHorizonDays: 30,
      installmentCount: 3,
      installmentFrequency: "monthly",
      inputMode: "installments",
      proposedDate: "2026-09-01",
      saferDateSearchDays: 90,
      totalPurchasePrice: money(1_000n, "ILS"),
    });

    expect(result.trueFinancedCost.amountMinor).toBe(1_103n);
    expect(result.installmentSchedule.map((item) => item.amount.amountMinor)).toEqual([
      368n,
      368n,
      367n,
    ]);
    expect(result.installmentSchedule.reduce(
      (sum, item) => sum + item.amount.amountMinor,
      0n,
    )).toBe(1_103n);
    expect(result.timeline.filter((point) => point.proposedPurchase)).toHaveLength(1);
  });

  it("fails instead of extrapolating beyond an insufficient source snapshot", () => {
    const shortBaseline = calculateFinancialEngine({
      accountBalance: money(1_000n, "ILS"),
      actualMonthlyExpenses: money(0n, "ILS"),
      actualMonthlyIncome: money(0n, "ILS"),
      asOf: "2026-09-01T09:00:00.000Z",
      availableCash: money(1_000n, "ILS"),
      creditLimit: money(0n, "ILS"),
      creditUsed: money(0n, "ILS"),
      currency: "ILS",
      debtBalance: money(0n, "ILS"),
      events: [],
      horizonDays: 30,
      monthlyConfirmedIncomeBasis: [],
      safetyMargin: { amount: money(0n, "ILS"), kind: "fixed" },
      savingsBalance: money(0n, "ILS"),
      timeZone: "Asia/Jerusalem",
    });

    expect(() =>
      calculatePurchaseSimulation({
        baseline: shortBaseline,
        charges: [],
        evaluationHorizonDays: 30,
        installmentCount: 1,
        installmentFrequency: "monthly",
        inputMode: "one_time",
        proposedDate: "2026-09-01",
        saferDateSearchDays: 90,
        totalPurchasePrice: money(1n, "ILS"),
      }),
    ).toThrow(/does not cover/);
  });
});
