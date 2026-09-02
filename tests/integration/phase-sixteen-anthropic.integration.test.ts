import { describe, expect, it } from "vitest";

import { AnthropicProviderError, getAnthropicAiProvider } from "@/lib/adapters/anthropic/anthropic-ai-provider";

const runRealProvider = process.env.RUN_REAL_ANTHROPIC_TESTS === "1" && typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
const describeWithAnthropic = runRealProvider ? describe : describe.skip;

describeWithAnthropic("Phase 16 real Anthropic report-summary boundary", () => {
  it("explains only minimized deterministic report facts in schema-validated Hebrew", async () => {
    let result;
    try {
      result = await getAnthropicAiProvider().generate({
        context: {
          evidence: [
            { label: "report.net_cash_flow", ref: "report.fact.1", value: { amountMinor: "400000", currency: "ILS", kind: "money" } },
            { label: "report.debt", ref: "report.fact.2", value: { amountMinor: "120000", currency: "ILS", kind: "money" } },
          ], focus: "report", minimizationVersion: "phase-16-real-provider-acceptance", redactionCategories: [], sourceReferences: [{ alias: "report.acceptance", kind: "report_snapshot", version: "financial-report-v1/phase-16-report-policy-v1/1" }], untrustedRecentHistory: [],
          untrustedUserText: "הסבר בקצרה את מצב הדוח ורק לפי הראיות שסופקו.",
        }, requestId: crypto.randomUUID(),
      });
    } catch (error) {
      if (error instanceof AnthropicProviderError) throw new Error(`Real Anthropic report acceptance failed safely: ${error.providerCategory}`);
      throw error;
    }
    expect(result.provider).toBe("anthropic"); expect(result.model).toMatch(/^claude-/); expect(result.usage.inputTokens).toBeGreaterThan(0); expect(result.response.fact.length).toBeGreaterThan(0);
    const refs = [...result.response.fact, ...result.response.insight, ...result.response.recommendation].flatMap((item) => item.evidenceRefs);
    expect(refs.every((ref) => ref === "report.fact.1" || ref === "report.fact.2")).toBe(true);
  }, 45_000);
});
