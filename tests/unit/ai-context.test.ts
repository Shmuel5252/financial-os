import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { buildAiPreparedContext, toAiProviderContext } from "@/lib/ai/ai-context-service";
import {
  calculateFinancialEngine,
  type FinancialEngineInput,
} from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";

const actor: Actor = { kind: "user", userId: "507f1f77bcf86cd799439011" };

function snapshot(): FinancialEngineSnapshot {
  const input: FinancialEngineInput = {
    accountBalance: money(1_000_000n, "ILS"),
    actualMonthlyExpenses: money(100_000n, "ILS"),
    actualMonthlyIncome: money(500_000n, "ILS"),
    asOf: "2026-09-01T09:00:00.000Z",
    availableCash: money(1_000_000n, "ILS"),
    creditLimit: money(0n, "ILS"),
    creditUsed: money(0n, "ILS"),
    currency: "ILS",
    debtBalance: money(0n, "ILS"),
    events: [],
    horizonDays: 30,
    monthlyConfirmedIncomeBasis: [],
    safetyMargin: { amount: money(100_000n, "ILS"), kind: "fixed" },
    savingsBalance: money(0n, "ILS"),
    timeZone: "Asia/Jerusalem",
  };
  return {
    calculatedAt: new Date("2026-09-01T09:00:01.000Z"),
    engineVersion: "financial-engine/1.0.0",
    id: "507f1f77bcf86cd799439012",
    inputHash: "a".repeat(64),
    kind: "engine_result",
    policyVersion: "financial-policy/2026-08-31",
    result: calculateFinancialEngine(input),
    schemaVersion: 1,
    sourceManifestId: "507f1f77bcf86cd799439013",
  };
}

describe("AI purpose-specific context assembly", () => {
  it("loads only the requested deterministic source and strips internal IDs before provider use", async () => {
    const loadGoals = vi.fn();
    const loadLatestPurchase = vi.fn();
    const prepared = await buildAiPreparedContext(
      actor,
      "safe_to_spend",
      `למה הסכום נמוך? api_key=${["sk-ant-", "not-real-secret-value"].join("")}`,
      [],
      {
        loadGoals,
        loadLatestEngine: async () => snapshot(),
        loadLatestPurchase,
      },
    );
    const provider = toAiProviderContext(prepared);

    expect(prepared.evidence).toHaveLength(7);
    expect(prepared.redactionCategories).toContain("provider_secret");
    expect(prepared.untrustedUserText).toContain("[REDACTED_");
    expect(loadGoals).not.toHaveBeenCalled();
    expect(loadLatestPurchase).not.toHaveBeenCalled();
    expect(JSON.stringify(provider)).not.toContain(snapshot().id);
    expect(JSON.stringify(provider)).not.toContain(actor.userId);
    expect(provider.sourceReferences[0]?.alias).toBe("engine.current");
  });
});
