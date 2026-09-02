import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DebtStrategyCenter } from "@/components/debt-strategies/debt-strategy-center";
import {
  evaluateDebtStrategyCommandSchema,
  saveDebtStrategyCommandSchema,
  type DebtStrategyCenterView,
} from "@/lib/debt-strategies/debt-strategy";
import { messages } from "@/lib/i18n";

const view: DebtStrategyCenterView = {
  currency: "ILS",
  evaluationDate: "2026-09-01",
  loans: [{
    id: "a".repeat(24),
    label: "הלוואה לדוגמה",
    monthlyPayment: { amountMinor: "10000", currency: "ILS" },
    nextPaymentDate: "2026-10-01",
    remainingBalance: { amountMinor: "100000", currency: "ILS" },
    reportedAnnualInterestRateBps: 1_200,
    version: 1,
  }],
  saved: [],
  timeZone: "Asia/Jerusalem",
};

describe("Phase 13 Hebrew/RTL debt-strategy presentation", () => {
  it("renders Hebrew disclosures and LTR-isolated exact financial values", () => {
    const html = renderToStaticMarkup(<DebtStrategyCenter initialView={view} />);
    expect(html).toContain(messages.debtStrategies.form.contractWarning);
    expect(html).toContain(messages.debtStrategies.separation);
    expect(html).toContain(messages.debtStrategies.actions.evaluate);
    expect(html).toContain("1000.00 ILS");
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain("userId");
    expect(html).not.toContain("sourceVersion");
  });

  it("rejects client ownership fields while accepting an explicit shaped command", () => {
    const provenance = { kind: "contract", note: null };
    const valid = {
      customPriority: ["a".repeat(24)],
      debtTerms: [{
        allocationOrder: { order: ["fees", "interest", "principal"], provenance },
        fees: [], feesKnown: true, feesProvenance: provenance, firstPaymentDate: "2026-10-01",
        interest: { accrualConvention: "monthly_compounded", kind: "fixed_rate", rateApplication: "payment_date", rates: [{ annualRateBps: 1200, effectiveDate: "2026-09-01", provenance }] },
        loanId: "a".repeat(24),
        minimumPayment: { amount: { amount: "100", currency: "ILS" }, kind: "fixed", provenance },
        prepayment: { kind: "free", provenance },
      }],
      extraPayment: { amount: "50", currency: "ILS" },
      extraPaymentStartDate: "2026-10-15",
    };
    expect(evaluateDebtStrategyCommandSchema.safeParse(valid).success).toBe(true);
    expect(evaluateDebtStrategyCommandSchema.safeParse({ ...valid, userId: "b".repeat(24) }).success).toBe(false);
    expect(evaluateDebtStrategyCommandSchema.safeParse({ ...valid, customPriority: [] }).success).toBe(true);
    expect(saveDebtStrategyCommandSchema.safeParse({ ...valid, idempotencyKey: crypto.randomUUID(), name: null, note: null, ownerId: "b".repeat(24) }).success).toBe(false);
  });

  it("renders each currency with its own ISO minor-unit precision", () => {
    const jpyLoan = {
      ...view.loans[0]!,
      monthlyPayment: { amountMinor: "100", currency: "JPY" },
      remainingBalance: { amountMinor: "1000", currency: "JPY" },
    };
    const html = renderToStaticMarkup(<DebtStrategyCenter initialView={{ ...view, currency: "JPY", loans: [jpyLoan] }} />);
    expect(html).toContain("1000 JPY");
    expect(html).not.toContain("10.00 JPY");
  });
});
