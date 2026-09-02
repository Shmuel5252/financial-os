import { describe, expect, it } from "vitest";

import {
  calculateNetWorth,
  NET_WORTH_ENGINE_VERSION,
  NET_WORTH_FRESHNESS_VERSION,
  NET_WORTH_POLICY_VERSION,
  type NetWorthComponentInput,
} from "@/lib/domain/net-worth/net-worth-engine";
import { money } from "@/lib/domain/money/money";

function component(
  id: string,
  amountMinor: bigint,
  overrides: Partial<NetWorthComponentInput> = {},
): NetWorthComponentInput {
  return {
    aggregation: { kind: "independent" },
    amount: money(amountMinor, "ILS"),
    category: "cash",
    effectiveAt: "2026-09-01T09:00:00.000Z",
    id,
    label: id,
    liquidity: "cash",
    provenance: { kind: "user_entered", note: null },
    side: "asset",
    sourceId: id,
    sourceKind: "account",
    sourceVersion: 1,
    valuationType: "cash_balance",
    ...overrides,
  };
}

function statement(components: readonly NetWorthComponentInput[], asOf = "2026-09-02T09:00:00.000Z") {
  return calculateNetWorth({ asOf, components, timeZone: "Asia/Jerusalem" });
}

describe("Phase 14 deterministic net-worth engine", () => {
  it("calculates exact assets minus liabilities while separating cash and unrealized value", () => {
    const result = statement([
      component("cash", 10_000n),
      component("market", 25_000n, {
        category: "investment", liquidity: "non_cash", provenance: { kind: "market_data_provider", note: "quoted" },
        sourceKind: "net_worth_item", side: "asset", valuationType: "market_value",
      }),
      component("loan", 7_000n, {
        aggregation: { kind: "liability_candidate", subjectId: "loan:one" }, category: "loan", liquidity: "non_cash",
        side: "liability", sourceKind: "loan", valuationType: "principal_balance",
      }),
    ]);
    expect(result.totals[0]).toEqual({
      assets: money(35_000n, "ILS"), cashAssets: money(10_000n, "ILS"), liabilities: money(7_000n, "ILS"),
      netWorth: money(28_000n, "ILS"), nonCashAssets: money(25_000n, "ILS"),
    });
    expect(result.included.find((entry) => entry.id === "market")?.valuationType).toBe("market_value");
  });

  it("uses source/type-specific freshness and preserves stale arithmetic", () => {
    const result = statement([
      component("market", 100n, { effectiveAt: "2026-08-31T09:00:00.000Z", provenance: { kind: "market_data_provider", note: null }, valuationType: "market_value" }),
      component("appraisal", 200n, { category: "real_estate", effectiveAt: "2026-07-01T09:00:00.000Z", liquidity: "non_cash", provenance: { kind: "user_entered", note: null }, sourceKind: "net_worth_item", valuationType: "appraisal" }),
    ]);
    expect(result.freshness).toBe("STALE");
    expect(result.included.find((entry) => entry.id === "market")?.freshness).toBe("STALE");
    expect(result.included.find((entry) => entry.id === "appraisal")?.freshnessThresholdDays).toBe(30);
    expect(result.totals[0]?.assets.amountMinor).toBe(300n);
  });

  it("excludes future valuations rather than inventing current value", () => {
    const result = statement([component("future", 100n, { effectiveAt: "2026-09-03T09:00:00.000Z" })]);
    expect(result.included).toHaveLength(0);
    expect(result.excluded[0]?.reason).toBe("future_effective_date");
    expect(result.totals).toHaveLength(0);
  });

  it("replaces the savings-account fallback when detailed savings evidence exists", () => {
    const result = statement([
      component("account", 1_000n, { aggregation: { groupId: "savings", kind: "fallback" }, category: "savings", liquidity: "savings" }),
      component("vehicle", 750n, { aggregation: { groupId: "savings", kind: "authority" }, category: "savings", liquidity: "savings", sourceKind: "savings" }),
    ]);
    expect(result.totals[0]?.assets.amountMinor).toBe(750n);
    expect(result.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "fallback_replaced" })]));
  });

  it("keeps a holding out when the parent account is authoritative", () => {
    const result = statement([
      component("account:one", 5_000n, { category: "investment", liquidity: "non_cash" }),
      component("holding", 2_000n, { aggregation: { kind: "account_detail", mode: "parent_authoritative", parentComponentId: "account:one" }, category: "investment", liquidity: "non_cash", sourceKind: "net_worth_item", valuationType: "market_value" }),
    ]);
    expect(result.totals[0]?.assets.amountMinor).toBe(5_000n);
    expect(result.excluded[0]?.reason).toBe("parent_account_authoritative");
  });

  it("replaces a parent account with authoritative holding detail without double counting", () => {
    const result = statement([
      component("account:one", 5_000n, { category: "investment", liquidity: "non_cash" }),
      component("holding-a", 2_000n, { aggregation: { kind: "account_detail", mode: "detail_authoritative", parentComponentId: "account:one" }, category: "investment", liquidity: "non_cash", sourceKind: "net_worth_item", valuationType: "market_value" }),
      component("holding-b", 3_100n, { aggregation: { kind: "account_detail", mode: "detail_authoritative", parentComponentId: "account:one" }, category: "investment", liquidity: "non_cash", sourceKind: "net_worth_item", valuationType: "market_value" }),
    ]);
    expect(result.totals[0]?.assets.amountMinor).toBe(5_100n);
    expect(result.excluded.find((entry) => entry.component.id === "account:one")?.reason).toBe("detail_authoritative");
  });

  it("uses fresh verified settlement before outstanding, derived, and principal evidence", () => {
    const base = { aggregation: { kind: "liability_candidate" as const, subjectId: "loan:one" }, category: "loan" as const, liquidity: "non_cash" as const, side: "liability" as const };
    const result = statement([
      component("principal", 10_000n, { ...base, sourceKind: "loan", valuationType: "principal_balance" }),
      component("derived", 10_200n, { ...base, provenance: { kind: "deterministic_derived", note: null }, sourceKind: "net_worth_item", valuationType: "derived_balance" }),
      component("outstanding", 10_300n, { ...base, provenance: { kind: "verified_provider", note: null }, sourceKind: "net_worth_item", valuationType: "outstanding_balance" }),
      component("settlement", 10_450n, { ...base, provenance: { kind: "verified_provider", note: null }, sourceKind: "net_worth_item", valuationType: "settlement_balance" }),
    ]);
    expect(result.totals[0]?.liabilities.amountMinor).toBe(10_450n);
    expect(result.included.map((entry) => entry.id)).toContain("settlement");
    expect(result.excluded.filter((entry) => entry.reason === "lower_priority_liability")).toHaveLength(3);
  });

  it("falls back to a fresh lower-tier value when a higher-tier payoff value is stale", () => {
    const base = { aggregation: { kind: "liability_candidate" as const, subjectId: "loan:one" }, category: "loan" as const, liquidity: "non_cash" as const, side: "liability" as const };
    const result = statement([
      component("settlement", 12_000n, { ...base, effectiveAt: "2026-08-01T09:00:00.000Z", provenance: { kind: "verified_provider", note: null }, sourceKind: "net_worth_item", valuationType: "settlement_balance" }),
      component("reported", 10_000n, { ...base, sourceKind: "loan", valuationType: "principal_balance" }),
    ]);
    expect(result.included.map((entry) => entry.id)).toEqual(["reported"]);
    expect(result.totals[0]?.liabilities.amountMinor).toBe(10_000n);
  });

  it("uses the best explicitly stale accounting value when no fresh candidate exists", () => {
    const base = { aggregation: { kind: "liability_candidate" as const, subjectId: "card:one" }, category: "credit_card" as const, effectiveAt: "2026-01-01T09:00:00.000Z", liquidity: "non_cash" as const, side: "liability" as const };
    const result = statement([
      component("reported", 1_000n, { ...base, sourceKind: "credit_card", valuationType: "outstanding_balance" }),
      component("verified", 1_200n, { ...base, provenance: { kind: "verified_provider", note: null }, sourceKind: "net_worth_item", valuationType: "settlement_balance" }),
    ]);
    expect(result.included.map((entry) => entry.id)).toEqual(["verified"]);
    expect(result.freshness).toBe("STALE");
  });

  it("groups currencies and performs no implicit FX", () => {
    const result = statement([
      component("ils", 100n),
      component("usd", 200n, { amount: money(200n, "USD") }),
    ]);
    expect(result.totals.map((total) => total.netWorth)).toEqual([money(100n, "ILS"), money(200n, "USD")]);
  });

  it("is versioned and exactly reproducible", () => {
    const first = statement([component("one", 100n)]);
    const second = statement([component("one", 100n)]);
    expect(second).toEqual(first);
    expect(first.engineVersion).toBe(NET_WORTH_ENGINE_VERSION);
    expect(first.policyVersion).toBe(NET_WORTH_POLICY_VERSION);
    expect(first.freshnessVersion).toBe(NET_WORTH_FRESHNESS_VERSION);
    expect(first.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects negative magnitudes, duplicate IDs, and int64 total overflow", () => {
    expect(() => statement([component("negative", -1n)])).toThrow(/non-negative/);
    expect(() => statement([component("same", 1n), component("same", 2n)])).toThrow(/unique/);
    expect(() => statement([component("a", 2n ** 63n - 1n), component("b", 1n)])).toThrow(/int64/);
  });
});
