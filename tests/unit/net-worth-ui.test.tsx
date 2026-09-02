import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NetWorthCenter } from "@/components/net-worth/net-worth-center";
import { calculateNetWorth } from "@/lib/domain/net-worth/net-worth-engine";
import { money } from "@/lib/domain/money/money";
import { messages } from "@/lib/i18n";
import { toNetWorthStatementView, type NetWorthCenterView } from "@/lib/net-worth/net-worth";

function view(): NetWorthCenterView {
  const statement = calculateNetWorth({
    asOf: "2026-09-02T09:00:00.000Z",
    components: [{
      aggregation: { kind: "independent" }, amount: money(12_345n, "ILS"), category: "investment",
      effectiveAt: "2026-08-01T09:00:00.000Z", id: "holding", label: "קרן בדיקה",
      liquidity: "non_cash", provenance: { kind: "user_entered", note: null }, side: "asset",
      sourceId: "source", sourceKind: "net_worth_item", sourceVersion: 1, valuationType: "market_value",
    }],
    timeZone: "Asia/Jerusalem",
  });
  return {
    current: toNetWorthStatementView(statement),
    goalLinks: [{ goalId: "goal", goalVersion: 1, sourceId: "source", sourceKind: "savings" }],
    items: [],
    snapshots: [{ createdAt: "2026-09-02T09:01:00.000Z", id: "snapshot", schemaVersion: 1, stateFingerprint: "a".repeat(64), statement: toNetWorthStatementView(statement), trigger: "explicit" }],
    sourceOptions: { accounts: [], cards: [], loans: [] },
  };
}

describe("Phase 14 Hebrew/RTL net-worth UI", () => {
  it("renders natural Hebrew, stale disclosure, history, chart, and LTR financial evidence", () => {
    const html = renderToStaticMarkup(<NetWorthCenter initialView={view()} />);
    expect(html).toContain(messages.netWorth.summary.netWorth);
    expect(html).toContain(messages.netWorth.freshness.warning);
    expect(html).toContain(messages.netWorth.separation);
    expect(html).toContain(messages.netWorth.history.title);
    expect(html).toContain("מגמת שווי נקי ILS");
    expect(html).toContain("123.45");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("קישורי יעדי חיסכון קיימים");
  });

  it("keeps all new user-facing labels behind the Hebrew catalog", () => {
    expect(messages.navigation.netWorth).toMatch(/[\u0590-\u05FF]/);
    expect(messages.netWorth.title).toMatch(/[\u0590-\u05FF]/);
    expect(messages.netWorth.excluded.fallback_replaced).toMatch(/[\u0590-\u05FF]/);
    expect(messages.netWorth.valuationTypes.principal_balance).toMatch(/[\u0590-\u05FF]/);
  });
});
