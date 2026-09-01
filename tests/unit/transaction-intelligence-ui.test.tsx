import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TransactionIntelligenceReview } from "@/components/transaction-intelligence/transaction-intelligence-review";
import { messages } from "@/lib/i18n";
import type { TransactionIntelligenceRunView } from "@/lib/transaction-intelligence/transaction-intelligence";

const run: TransactionIntelligenceRunView = {
  analyzedThroughDate: "2026-08-01",
  createdAt: "2026-09-01T12:00:00.000Z",
  engineVersion: "transaction-intelligence-v1",
  id: "a".repeat(24),
  inputCount: 3,
  merchantGroups: [
    {
      latestRawMerchant: "NETFLIX.COM 123",
      normalizedMerchant: "Netflix",
      occurrenceCount: 3,
    },
  ],
  omittedLowConfidenceCount: 1,
  policyVersion: "review-only-v1",
  reviewThresholdBps: 6_000,
  rulesetVersion: "merchant-rules-v1",
  signals: [
    {
      amount: { amountMinor: "1000", currency: "ILS" },
      baselineAmount: null,
      confidenceBps: 8_500,
      currentDecision: null,
      evidence: [
        {
          amount: { amountMinor: "1000", currency: "ILS" },
          confirmedCategoryId: "system:other",
          date: "2026-08-01",
          normalizedMerchant: "Netflix",
          rawMerchant: "NETFLIX.COM 123",
        },
      ],
      explanationCode: "CATEGORY_CURATED_MERCHANT",
      id: "b".repeat(32),
      kind: "category_suggestion",
      normalizedMerchant: "Netflix",
      periodDays: null,
      suggestedCategoryId: "system:subscriptions",
    },
  ],
  truncatedSignalCount: 0,
};

describe("Phase 10 Hebrew/RTL review queue", () => {
  it("renders natural Hebrew, LTR evidence, and no internal transaction IDs", () => {
    const html = renderToStaticMarkup(
      <TransactionIntelligenceReview
        categories={[]}
        initialRun={run}
      />,
    );
    expect(html).toContain(messages.transactionIntelligence.signals.title);
    expect(html).toContain(messages.transactionIntelligence.actions.confirm);
    expect(html).toContain("מינויים");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("10.00 ILS");
    expect(html).not.toContain("transactionId");
    expect(html).not.toContain("userId");
    expect(html).not.toContain("sourceId");
  });

  it("renders the explicit side-effect-free empty state", () => {
    const html = renderToStaticMarkup(
      <TransactionIntelligenceReview
        categories={[]}
        initialRun={null}
      />,
    );
    expect(html).toContain(messages.transactionIntelligence.empty);
    expect(html).toContain(messages.transactionIntelligence.privacy);
    expect(html).toContain(messages.transactionIntelligence.separation);
  });
});
