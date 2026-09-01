import { describe, expect, it } from "vitest";

import { money } from "@/lib/domain/money/money";
import {
  calculateTransactionIntelligence,
  normalizeMerchant,
} from "@/lib/domain/transaction-intelligence/transaction-intelligence-engine";
import type { TransactionIntelligenceInput } from "@/lib/transaction-intelligence/transaction-intelligence";
import {
  analyzeTransactionsCommandSchema,
  reviewTransactionIntelligenceCommandSchema,
} from "@/lib/transaction-intelligence/transaction-intelligence";

let idSequence = 1;

function transaction(
  overrides: Partial<TransactionIntelligenceInput> = {},
): TransactionIntelligenceInput {
  const id = idSequence.toString(16).padStart(24, "0");
  idSequence += 1;
  return {
    accountId: "a".repeat(24),
    amount: money(10_00n, "ILS"),
    confirmedCategoryId: "system:other",
    date: "2026-08-01",
    id,
    merchant: "Unknown merchant",
    sourceKind: "manual",
    type: "expense",
    updatedAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("Phase 10 deterministic transaction intelligence", () => {
  it("normalizes known merchants and suggests a category without rewriting input", () => {
    const input = transaction({ merchant: "  RAMI-LEVI #1234  " });
    const original = structuredClone(input);
    const calculation = calculateTransactionIntelligence([input]);
    const suggestion = calculation.signals.find(
      (item) => item.kind === "category_suggestion",
    );

    expect(normalizeMerchant(input.merchant).normalizedMerchant).toBe("רמי לוי");
    expect(suggestion).toMatchObject({
      confidenceBps: 8_500,
      normalizedMerchant: "רמי לוי",
      suggestedCategoryId: "system:food",
    });
    expect(input).toEqual(original);
  });

  it("prefers consistent confirmed merchant history and omits conflicting history", () => {
    const confirmedFood = transaction({
      confirmedCategoryId: "system:food",
      date: "2026-06-01",
      merchant: "Local Market",
    });
    const secondFood = transaction({
      confirmedCategoryId: "system:food",
      date: "2026-07-01",
      merchant: "local-market",
    });
    const candidate = transaction({
      date: "2026-08-01",
      merchant: "LOCAL MARKET",
    });
    const consistent = calculateTransactionIntelligence([
      confirmedFood,
      secondFood,
      candidate,
    ]);
    expect(
      consistent.signals.find((item) => item.kind === "category_suggestion"),
    ).toMatchObject({
      confidenceBps: 9_500,
      explanationCode: "CATEGORY_CONFIRMED_HISTORY",
      suggestedCategoryId: "system:food",
    });

    const conflicting = calculateTransactionIntelligence([
      confirmedFood,
      transaction({
        confirmedCategoryId: "system:restaurants",
        date: "2026-07-02",
        merchant: "Local Market",
      }),
      candidate,
    ]);
    expect(
      conflicting.signals.some((item) => item.kind === "category_suggestion"),
    ).toBe(false);
    expect(conflicting.omittedLowConfidenceCount).toBe(1);
  });

  it("detects exact duplicate candidates but never removes either transaction", () => {
    const first = transaction({
      amount: money(12_345n, "ILS"),
      confirmedCategoryId: "system:food",
      merchant: "שופרסל",
    });
    const second = transaction({
      amount: money(12_345n, "ILS"),
      confirmedCategoryId: "system:food",
      merchant: "SHUFERSAL",
    });
    const calculation = calculateTransactionIntelligence([first, second]);
    const duplicate = calculation.signals.find(
      (item) => item.kind === "possible_duplicate",
    );
    expect(duplicate?.confidenceBps).toBe(9_200);
    expect(duplicate?.evidence).toHaveLength(2);
    expect(calculation.inputCount).toBe(2);
  });

  it("detects recurring subscriptions, price increases, and merchant amount anomalies", () => {
    const netflix = [
      transaction({ date: "2026-05-01", merchant: "Netflix" }),
      transaction({ date: "2026-06-01", merchant: "Netflix" }),
      transaction({ date: "2026-07-01", merchant: "Netflix" }),
    ];
    const spotify = [
      transaction({ amount: money(10_00n, "ILS"), date: "2026-05-02", merchant: "Spotify" }),
      transaction({ amount: money(10_00n, "ILS"), date: "2026-06-02", merchant: "Spotify" }),
      transaction({ amount: money(12_00n, "ILS"), date: "2026-07-02", merchant: "Spotify" }),
    ];
    const market = [
      transaction({ amount: money(100n, "ILS"), date: "2026-04-03", merchant: "Corner shop" }),
      transaction({ amount: money(100n, "ILS"), date: "2026-05-03", merchant: "Corner shop" }),
      transaction({ amount: money(100n, "ILS"), date: "2026-06-03", merchant: "Corner shop" }),
      transaction({ amount: money(100n, "ILS"), date: "2026-07-03", merchant: "Corner shop" }),
      transaction({ amount: money(300n, "ILS"), date: "2026-08-03", merchant: "Corner shop" }),
    ];
    const calculation = calculateTransactionIntelligence([
      ...netflix,
      ...spotify,
      ...market,
    ]);
    expect(
      calculation.signals.some(
        (item) => item.kind === "subscription_candidate",
      ),
    ).toBe(true);
    expect(
      calculation.signals.find(
        (item) => item.kind === "subscription_increase",
      )?.baselineAmount?.amountMinor,
    ).toBe(1_000n);
    expect(
      calculation.signals.find((item) => item.kind === "amount_anomaly")
        ?.baselineAmount?.amountMinor,
    ).toBe(100n);
  });

  it("detects a high-value first merchant only from sufficient same-currency history", () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      transaction({
        amount: money(1_000n, "ILS"),
        confirmedCategoryId: "system:food",
        date: `2026-08-${(index + 1).toString().padStart(2, "0")}`,
        merchant: `Merchant ${index}`,
      }),
    );
    const unusual = transaction({
      amount: money(5_000n, "ILS"),
      confirmedCategoryId: "system:shopping",
      date: "2026-08-20",
      merchant: "New expensive merchant",
    });
    const calculation = calculateTransactionIntelligence([
      ...history,
      unusual,
    ]);
    expect(
      calculation.signals.find((item) => item.kind === "unusual_merchant"),
    ).toMatchObject({
      baselineAmount: money(1_000n, "ILS"),
      confidenceBps: 7_800,
    });
  });

  it("is deterministic and never compares merchant amounts across currencies", () => {
    const ils = transaction({
      amount: money(100n, "ILS"),
      date: "2026-06-01",
      merchant: "Service",
    });
    const usd = transaction({
      amount: money(100n, "USD"),
      date: "2026-07-01",
      merchant: "Service",
    });
    const first = calculateTransactionIntelligence([ils, usd]);
    const second = calculateTransactionIntelligence([ils, usd]);
    expect(second).toEqual(first);
    expect(
      first.signals.some(
        (item) =>
          item.kind === "recurring_candidate" ||
          item.kind === "amount_anomaly",
      ),
    ).toBe(false);
  });

  it("meets the labelled deterministic merchant-rule quality gate", () => {
    const fixtures = [
      ["רמי לוי בשכונה", "system:food"],
      ["SHUFERSAL DEAL", "system:food"],
      ["NETFLIX.COM", "system:subscriptions"],
      ["Spotify AB", "system:subscriptions"],
      ["PANGO PARKING", "system:transport"],
      ["GETT TAXI", "system:transport"],
      ["WOLT ISRAEL", "system:restaurants"],
    ] as const;
    const inputs = fixtures.map(([merchant], index) =>
      transaction({
        date: `2026-08-${(index + 1).toString().padStart(2, "0")}`,
        merchant,
      }),
    );
    const calculation = calculateTransactionIntelligence([
      ...inputs,
      transaction({ merchant: "Unmapped local business" }),
    ]);
    const suggestions = calculation.signals.filter(
      (item) => item.kind === "category_suggestion",
    );
    const correct = fixtures.filter(([merchant, categoryId]) => {
      const normalized = normalizeMerchant(merchant).normalizedMerchant;
      return suggestions.some(
        (item) =>
          item.normalizedMerchant === normalized &&
          item.suggestedCategoryId === categoryId,
      );
    }).length;
    const precisionBps = (BigInt(correct) * 10_000n) / BigInt(suggestions.length);
    const recallBps = (BigInt(correct) * 10_000n) / BigInt(fixtures.length);
    expect(precisionBps).toBe(10_000n);
    expect(recallBps).toBe(10_000n);
    expect(
      suggestions.some(
        (item) => item.normalizedMerchant === "unmapped local business",
      ),
    ).toBe(false);
  });

  it("rejects client-supplied ownership and malformed review contracts", () => {
    expect(
      analyzeTransactionsCommandSchema.safeParse({
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        userId: "a".repeat(24),
      }).success,
    ).toBe(false);
    expect(
      reviewTransactionIntelligenceCommandSchema.safeParse({
        decision: "confirmed",
        expectedDecision: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        runId: "a".repeat(24),
        signalId: "b".repeat(32),
        userId: "a".repeat(24),
      }).success,
    ).toBe(false);
  });
});
