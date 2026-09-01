import { describe, expect, it } from "vitest";

import type { AiProviderContext } from "@/lib/ai/ai";
import {
  assertSafeAiProviderContext,
  sanitizeAiUserText,
  validateAiStructuredResponse,
} from "@/lib/domain/ai/ai-safety";

const evidence = [
  {
    label: "engine.safe_to_spend" as const,
    ref: "engine.safe_to_spend",
    value: { amountMinor: "273000", currency: "ILS", kind: "money" as const },
  },
];

const context: AiProviderContext = {
  evidence,
  focus: "safe_to_spend",
  minimizationVersion: "test",
  redactionCategories: [],
  sourceReferences: [
    { alias: "engine.current", kind: "financial_engine_snapshot", version: "test" },
  ],
  untrustedRecentHistory: [],
  untrustedUserText: "למה הסכום הבטוח נמוך?",
};

describe("AI minimization and deterministic redaction", () => {
  it("redacts provider secrets, credentials, card data, and security codes before use", () => {
    const apiKey = ["sk-ant-", "not-a-real-credential-value"].join("");
    const sanitized = sanitizeAiUserText(
      `api_key=${apiKey} password=hunter123 cvv=123 card 4111 1111 1111 1111`,
    );

    expect(sanitized.text).not.toContain(apiKey);
    expect(sanitized.text).not.toContain("hunter123");
    expect(sanitized.text).not.toContain("4111");
    expect(sanitized.categories).toEqual(
      expect.arrayContaining([
        "card_number",
        "card_security_code",
        "provider_secret",
        "secret_assignment",
      ]),
    );
  });

  it("rejects forbidden internal identifiers and excessive history before provider invocation", () => {
    expect(() =>
      assertSafeAiProviderContext({ ...context, userId: "internal" } as AiProviderContext),
    ).toThrow(/prohibited field/);
    expect(() =>
      assertSafeAiProviderContext({
        ...context,
        untrustedRecentHistory: ["אחד", "שניים", "שלושה"],
      }),
    ).toThrow(/history boundary/);
  });

  it("accepts only Hebrew, evidence-cited output without provider-generated digits", () => {
    const accepted = validateAiStructuredResponse(
      {
        fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: "הסכום הבטוח מוצג בנתון המאומת." }],
        insight: [{ evidenceRefs: ["engine.safe_to_spend"], text: "מרחב ההוצאה מוגבל כרגע." }],
        recommendation: [{ evidenceRefs: ["engine.safe_to_spend"], text: "כדאי לבחון את ההתחייבויות הקרובות." }],
      },
      evidence,
    );
    expect(accepted.fact).toHaveLength(1);

    expect(() =>
      validateAiStructuredResponse(
        {
          fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: "הסכום הוא 999." }],
          insight: [],
          recommendation: [],
        },
        evidence,
      ),
    ).toThrow(/numerical claims/);
    expect(() =>
      validateAiStructuredResponse(
        {
          fact: [{ evidenceRefs: ["foreign.fact"], text: "זהו נתון לא זמין." }],
          insight: [],
          recommendation: [],
        },
        evidence,
      ),
    ).toThrow(/unavailable financial evidence/);
  });
});
