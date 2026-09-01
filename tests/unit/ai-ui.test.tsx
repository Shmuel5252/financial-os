import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FinancialCopilot } from "@/components/ai/financial-copilot";
import type { AiConversationView } from "@/lib/ai/ai";
import { messages } from "@/lib/i18n";

const conversation: AiConversationView = {
  createdAt: "2026-09-01T10:00:00.000Z",
  id: "507f1f77bcf86cd799439011",
  messages: [
    {
      createdAt: "2026-09-01T10:00:00.000Z",
      id: "f46b229b-0698-4447-9500-7fee4661fe4d",
      role: "user",
      text: "למה הסכום הבטוח נמוך?",
    },
    {
      createdAt: "2026-09-01T10:00:01.000Z",
      evidence: [
        {
          label: "engine.safe_to_spend",
          ref: "engine.safe_to_spend",
          value: { amountMinor: "273000", currency: "ILS", kind: "money" },
        },
      ],
      focus: "safe_to_spend",
      id: "9149dfca-815e-415f-b131-b5acf49813ac",
      model: "claude-test-model",
      provider: "anthropic",
      response: {
        fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: "הסכום מבוסס על תמונת המנוע." }],
        insight: [],
        recommendation: [{ evidenceRefs: ["engine.safe_to_spend"], text: "כדאי לבדוק התחייבויות קרובות." }],
      },
      role: "assistant",
      sourceReferences: [
        { alias: "engine.current", kind: "financial_engine_snapshot", version: "engine/test" },
      ],
      usage: { inputTokens: 40, outputTokens: 20 },
    },
  ],
  schemaVersion: 1,
  title: "למה הסכום הבטוח נמוך?",
  updatedAt: "2026-09-01T10:00:01.000Z",
  version: 1,
};

describe("Phase 8 Hebrew/RTL copilot presentation", () => {
  it("shows Hebrew authority/privacy copy, separated sections, evidence, and LTR values", () => {
    const html = renderToStaticMarkup(
      <FinancialCopilot configured initialConversations={[conversation]} />,
    );

    expect(html).toContain(messages.copilot.configured.ready);
    expect(html).toContain(messages.copilot.privacy);
    expect(html).toContain(messages.copilot.sections.fact);
    expect(html).toContain(messages.copilot.sections.recommendation);
    expect(html).toContain(messages.copilot.evidence["engine.safe_to_spend"]);
    expect(html).toContain("2730.00 ILS");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain(messages.copilot.form.historyHelp);
  });
});
