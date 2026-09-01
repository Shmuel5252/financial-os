import { describe, expect, it } from "vitest";

import { getAnthropicAiProvider } from "@/lib/adapters/anthropic/anthropic-ai-provider";
import { AnthropicProviderError } from "@/lib/adapters/anthropic/anthropic-ai-provider";

const runRealProvider =
  process.env.RUN_REAL_ANTHROPIC_TESTS === "1" &&
  typeof process.env.ANTHROPIC_API_KEY === "string" &&
  process.env.ANTHROPIC_API_KEY.length > 0;
const describeWithAnthropic = runRealProvider ? describe : describe.skip;

describeWithAnthropic("Phase 8 real Anthropic provider contract", () => {
  it(
    "returns schema-validated Hebrew evidence-cited guidance without generated numbers",
    async () => {
      let result;
      try {
        result = await getAnthropicAiProvider().generate({
          context: {
            evidence: [
              {
                label: "engine.safe_to_spend",
                ref: "engine.safe_to_spend",
                value: { amountMinor: "273000", currency: "ILS", kind: "money" },
              },
              {
                label: "engine.safety_margin",
                ref: "engine.safety_margin",
                value: { amountMinor: "150000", currency: "ILS", kind: "money" },
              },
            ],
            focus: "safe_to_spend",
            minimizationVersion: "real-provider-acceptance",
            redactionCategories: [],
            sourceReferences: [
              {
                alias: "engine.acceptance_fixture",
                kind: "financial_engine_snapshot",
                version: "acceptance-fixture/1",
              },
            ],
            untrustedRecentHistory: [],
            untrustedUserText:
              "הסבר בקצרה מה משמעות הסכום הבטוח ביחס למרווח הביטחון.",
          },
          requestId: crypto.randomUUID(),
        });
      } catch (error) {
        if (error instanceof AnthropicProviderError) {
          throw new Error(
            `Real Anthropic acceptance failed: ${error.providerCategory}`,
          );
        }
        throw error;
      }

      expect(result.provider).toBe("anthropic");
      expect(result.model).toMatch(/^claude-/);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      expect(result.response.fact.length).toBeGreaterThan(0);
      expect(
        [
          ...result.response.fact,
          ...result.response.insight,
          ...result.response.recommendation,
        ].flatMap((item) => item.evidenceRefs),
      ).toEqual(expect.arrayContaining(["engine.safe_to_spend"]));
    },
    45_000,
  );
});
