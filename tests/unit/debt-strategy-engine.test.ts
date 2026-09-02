import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  assessDebtTerms,
  calculateDebtStrategies,
  type DebtStrategyDebt,
} from "@/lib/domain/debt-strategies/debt-strategy-engine";
import { money } from "@/lib/domain/money/money";

const provenance = { kind: "contract" as const, note: "loan agreement" };

function debt(overrides: Partial<DebtStrategyDebt> = {}): DebtStrategyDebt {
  return {
    allocationOrder: { order: ["fees", "interest", "principal"], provenance },
    balance: money(100_000n, "ILS"),
    fees: [],
    feesKnown: true,
    feesProvenance: provenance,
    firstPaymentDate: "2026-10-01",
    id: "000000000000000000000001",
    interest: {
      accrualConvention: "monthly_compounded",
      kind: "fixed_rate",
      rateApplication: "payment_date",
      rates: [{ annualRateBps: 1_200, effectiveDate: "2026-09-01", provenance }],
    },
    label: "Debt",
    minimumPayment: { amount: money(10_000n, "ILS"), kind: "fixed", provenance },
    prepayment: { kind: "free", provenance },
    sourceVersion: 1,
    ...overrides,
  };
}

function calculate(debts: readonly DebtStrategyDebt[] = [debt()], extra = 5_000n) {
  return calculateDebtStrategies({
    customPriority: debts.map((item) => item.id),
    debts,
    evaluationDate: "2026-09-01",
    extraPayment: money(extra, "ILS"),
    extraPaymentStartDate: "2026-10-15",
  });
}

describe("Phase 13 deterministic debt strategy engine", () => {
  it("requires explicit material contract terms instead of treating APR as a contract", () => {
    const assessment = assessDebtTerms(debt({
      allocationOrder: null,
      interest: { kind: "unknown" },
      minimumPayment: { kind: "unknown" },
      prepayment: { kind: "unknown" },
    }), "2026-09-01");
    expect(assessment.completeness).toBe("insufficient_information");
    expect(assessment.reasons).toEqual(expect.arrayContaining([
      "unknown_interest_model", "unknown_minimum_payment", "unknown_allocation_order",
    ]));
  });

  it("labels explicit assumptions without upgrading them to verified truth", () => {
    const assumption = { kind: "assumption" as const, note: "what-if" };
    const assessment = assessDebtTerms(debt({
      allocationOrder: { order: ["fees", "interest", "principal"], provenance: assumption },
    }), "2026-09-01");
    expect(assessment.completeness).toBe("assumption_based");
    expect(assessment.reasons).toContain("assumption_terms");
  });

  it("compares baseline, Avalanche, Snowball and custom with exact money", () => {
    const second = debt({
      balance: money(40_000n, "ILS"),
      id: "000000000000000000000002",
      interest: { accrualConvention: "monthly_compounded", kind: "fixed_rate", rateApplication: "payment_date", rates: [{ annualRateBps: 2_400, effectiveDate: "2026-09-01", provenance }] },
      minimumPayment: { amount: money(5_000n, "ILS"), kind: "fixed", provenance },
    });
    const result = calculate([debt(), second]);
    expect(result.results.map((item) => item.strategy)).toEqual(["baseline", "avalanche", "snowball", "custom"]);
    expect(result.calculationCompleteness).toBe("verified");
    expect(result.results.every((item) => item.totalRepayment.currency === "ILS")).toBe(true);
    expect(result.results[1]!.payoffOrder[0]!.debtId).toBe(second.id);
  });

  it("keeps a zero extra-payment budget separate from required minimums", () => {
    const result = calculate([debt()], 0n);
    expect(result.results[0]!.totalRepayment.amountMinor).toBe(result.results[1]!.totalRepayment.amountMinor);
  });

  it("applies dated variable rates and known fees with provenance", () => {
    const result = calculate([debt({
      fees: [{ amount: money(101n, "ILS"), dueDate: "2026-11-01", label: "Known fee", provenance }],
      interest: {
        accrualConvention: "monthly_compounded",
        kind: "variable_rate",
        rateApplication: "payment_date",
        rates: [
          { annualRateBps: 1_200, effectiveDate: "2026-09-01", provenance },
          { annualRateBps: 2_400, effectiveDate: "2026-11-01", provenance },
        ],
      },
    })]);
    expect(result.results[0]!.totalKnownFees.amountMinor).toBe(101n);
    expect(result.results[0]!.timeline.some((point) => point.feesAssessed.amountMinor === 101n)).toBe(true);
  });

  it("supports Actual/365, Actual/360, monthly and negative-rate credits deterministically", () => {
    const conventions = ["actual_365", "actual_360", "monthly_compounded"] as const;
    for (const accrualConvention of conventions) {
      const rateApplication = accrualConvention === "monthly_compounded" ? "payment_date" as const : "effective_date" as const;
      const first = calculate([debt({ interest: { accrualConvention, kind: "fixed_rate", rateApplication, rates: [{ annualRateBps: -100, effectiveDate: "2026-09-01", provenance }] } })]);
      const second = calculate([debt({ interest: { accrualConvention, kind: "fixed_rate", rateApplication, rates: [{ annualRateBps: -100, effectiveDate: "2026-09-01", provenance }] } })]);
      expect(first).toEqual(second);
      expect(first.results[0]!.totalInterest.amountMinor).toBeLessThanOrEqual(0n);
    }
  });

  it("uses a contractual payment-allocation order and explicit prepayment fee", () => {
    const result = calculate([debt({
      allocationOrder: { order: ["interest", "fees", "principal"], provenance },
      prepayment: { amount: money(250n, "ILS"), kind: "fixed_fee", provenance },
    })], 100_000n);
    expect(result.results[1]!.totalKnownFees.amountMinor).toBe(250n);
  });

  it("never combines currencies through implicit FX", () => {
    expect(() => calculate([debt(), debt({ balance: money(100n, "USD"), id: "000000000000000000000002" })])).toThrow("currencies");
  });

  it("rejects duplicate debts and incomplete custom priority", () => {
    const duplicate = debt();
    expect(() => calculateDebtStrategies({
      customPriority: [duplicate.id], debts: [duplicate, duplicate], evaluationDate: "2026-09-01",
      extraPayment: money(0n, "ILS"), extraPaymentStartDate: "2026-09-01",
    })).toThrow("selected twice");
    expect(() => calculateDebtStrategies({
      customPriority: [], debts: [duplicate], evaluationDate: "2026-09-01",
      extraPayment: money(0n, "ILS"), extraPaymentStartDate: "2026-09-01",
    })).toThrow("every selected debt");
  });

  it("preserves global chronology when payment and extra-payment anchors differ", () => {
    const result = calculateDebtStrategies({
      customPriority: [debt().id], debts: [debt()], evaluationDate: "2026-09-01",
      extraPayment: money(1_000n, "ILS"), extraPaymentStartDate: "2026-12-15",
    });
    const dates = result.results[1]!.timeline.map((point) => point.calendarDate);
    expect(dates).toEqual([...dates].sort());
  });

  it("orders same-day scheduled debts stably before the extra-payment event", () => {
    const second = debt({ id: "000000000000000000000002" });
    const debts = [second, debt()];
    const result = calculateDebtStrategies({
      customPriority: debts.map((item) => item.id),
      debts,
      evaluationDate: "2026-09-01",
      extraPayment: money(5_000n, "ILS"),
      extraPaymentStartDate: "2026-10-01",
    });
    const firstDate = result.results[1]!.timeline.filter((point) => point.calendarDate === "2026-10-01");
    expect(firstDate.slice(0, 2).map((point) => point.debtId)).toEqual([
      "000000000000000000000001",
      "000000000000000000000002",
    ]);
    expect(firstDate.slice(0, 2).every((point) => point.kind === "scheduled")).toBe(true);
    expect(firstDate[2]!.kind).toBe("extra");
  });

  it("rejects an accrual/rate-application mismatch", () => {
    expect(() => calculate([debt({
      interest: { accrualConvention: "actual_365", kind: "fixed_rate", rateApplication: "payment_date", rates: [{ annualRateBps: 100, effectiveDate: "2026-09-01", provenance }] },
    })])).toThrow("rate-application");
  });

  it("returns honest partial output and no claimed savings when a debt is excluded", () => {
    const incomplete = debt({ id: "000000000000000000000002", interest: { kind: "unknown" } });
    const result = calculate([debt(), incomplete]);
    expect(result.calculationCompleteness).toBe("insufficient_information");
    expect(result.results[1]!.excludedDebtIds).toContain(incomplete.id);
    expect(result.results[1]!.costSavedVersusBaseline).toBeNull();
  });

  it("uses half-even exact minor-unit rounding reproducibly", () => {
    const result = calculate([debt({
      balance: money(1n, "ILS"),
      interest: { accrualConvention: "monthly_compounded", kind: "fixed_rate", rateApplication: "payment_date", rates: [{ annualRateBps: 60_000, effectiveDate: "2026-09-01", provenance }] },
      minimumPayment: { amount: money(10n, "ILS"), kind: "fixed", provenance },
    })], 0n);
    expect(result.results[0]!.timeline[0]!.interestAccrued.amountMinor).toBe(0n);
  });

  it("reconciles every payment point and conserves exact repayment totals", () => {
    const comparison = calculate([debt()], 5_000n);
    expect(comparison.requiredMonthlyPayment.amountMinor).toBe(10_000n);
    for (const result of comparison.results) {
      let principal = 100_000n;
      let interest = 0n;
      let fees = 0n;
      let payments = 0n;
      for (const point of result.timeline) {
        interest += point.interestAccrued.amountMinor;
        fees += point.feesAssessed.amountMinor;
        const dueBeforePayment = principal + interest + fees;
        const dueAfterPayment = point.principalAfter.amountMinor + point.interestAfter.amountMinor + point.feesAfter.amountMinor;
        expect(dueBeforePayment - point.payment.amountMinor).toBe(dueAfterPayment);
        principal = point.principalAfter.amountMinor;
        interest = point.interestAfter.amountMinor;
        fees = point.feesAfter.amountMinor;
        payments += point.payment.amountMinor;
      }
      expect(payments).toBe(result.totalRepayment.amountMinor);
      if (result.payoffReached) expect(principal + interest + fees).toBe(0n);
    }
  });

  it("keeps deterministic debt truth independent from AI/provider adapters", async () => {
    const [engineSource, serviceSource] = await Promise.all([
      readFile(new URL("../../src/lib/domain/debt-strategies/debt-strategy-engine.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/lib/debt-strategies/debt-strategy-service.ts", import.meta.url), "utf8"),
    ]);
    expect(`${engineSource}\n${serviceSource}`).not.toMatch(/anthropic|@\/lib\/ai|AiProvider/);
  });
});
