import { describe, expect, it, vi } from "vitest";

import type { AiProviderContext } from "@/lib/ai/ai";
import {
  AnthropicAiProvider,
  AnthropicProviderError,
} from "@/lib/adapters/anthropic/anthropic-ai-provider";
import { DependencyUnavailableError } from "@/lib/errors/application-error";

const context: AiProviderContext = {
  evidence: [
    {
      label: "engine.safe_to_spend",
      ref: "engine.safe_to_spend",
      value: { amountMinor: "273000", currency: "ILS", kind: "money" },
    },
  ],
  focus: "safe_to_spend",
  minimizationVersion: "test",
  redactionCategories: [],
  sourceReferences: [
    { alias: "engine.current", kind: "financial_engine_snapshot", version: "engine/test" },
  ],
  untrustedRecentHistory: [],
  untrustedUserText: "למה הסכום הבטוח נמוך?",
};

function providerPayload() {
  return {
    content: [
      {
        text: JSON.stringify({
          fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: "הסכום הבטוח מגיע מהמנוע הדטרמיניסטי." }],
          insight: [{ evidenceRefs: ["engine.safe_to_spend"], text: "מרחב ההוצאה מוגבל כרגע." }],
          recommendation: [{ evidenceRefs: ["engine.safe_to_spend"], text: "כדאי לבדוק התחייבויות קרובות." }],
        }),
        type: "text",
      },
    ],
    model: "claude-test-model",
    stop_reason: "end_turn",
    usage: { input_tokens: 42, output_tokens: 21 },
  };
}

describe("Anthropic provider adapter", () => {
  it("terminates provider transport details and sends only minimized structured context", async () => {
    let capturedBody = "";
    let capturedWorkspaceHeader: string | null = null;
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = String(init?.body ?? "");
      capturedWorkspaceHeader = new Headers(init?.headers).get("anthropic-workspace-id");
      return new Response(JSON.stringify(providerPayload()), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    const provider = new AnthropicAiProvider({
      apiKey: "test-only-key",
      fetchImplementation: fetchImplementation as typeof fetch,
      model: "claude-test-model",
      workspaceId: "wrkspc_Test123",
    });

    const result = await provider.generate({ context, requestId: crypto.randomUUID() });

    expect(result.provider).toBe("anthropic");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 21 });
    expect(capturedBody).toContain("untrustedUserText");
    expect(capturedBody).not.toContain("sourceId");
    expect(capturedBody).not.toContain("userId");
    expect(capturedBody).not.toContain("test-only-key");
    expect(capturedBody).toContain("json_schema");
    expect(capturedBody).not.toMatch(/minLength|maxLength|minItems|maxItems/);
    expect(capturedWorkspaceHeader).toBe("wrkspc_Test123");
  });

  it("fails safely on provider errors and hallucinated numerical output", async () => {
    const failedProvider = new AnthropicAiProvider({
      apiKey: "test-only-key",
      fetchImplementation: vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "raw-sensitive-provider-detail" } }), {
          status: 500,
        }),
      ) as typeof fetch,
      model: "claude-test-model",
    });
    await expect(
      failedProvider.generate({ context, requestId: crypto.randomUUID() }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "The AI provider request failed safely.",
      }),
    );

    const hallucinatingProvider = new AnthropicAiProvider({
      apiKey: "test-only-key",
      fetchImplementation: vi.fn(async () => {
        const payload = providerPayload();
        payload.content[0]!.text = JSON.stringify({
          fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: "הסכום הוא 999." }],
          insight: [],
          recommendation: [],
        });
        return new Response(JSON.stringify(payload), { status: 200 });
      }) as typeof fetch,
      model: "claude-test-model",
    });
    await expect(
      hallucinatingProvider.generate({ context, requestId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it("classifies rejected provider contracts without exposing the provider response", async () => {
    const provider = new AnthropicAiProvider({
      apiKey: "test-only-key",
      fetchImplementation: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Schema contains an unsupported parameter",
              type: "invalid_request_error",
            },
          }),
          { status: 400 },
        ),
      ) as typeof fetch,
      model: "claude-test-model",
    });

    await expect(
      provider.generate({ context, requestId: crypto.randomUUID() }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AnthropicProviderError>>({
        message: "The AI provider request failed safely.",
        providerCategory: "OUTPUT_SCHEMA_REJECTED",
      }),
    );
  });

  it("fails with a safe configuration error when a multi-workspace key needs selection", async () => {
    const provider = new AnthropicAiProvider({
      apiKey: "test-only-key",
      fetchImplementation: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "anthropic-workspace-id is required when authenticating with this key",
              type: "invalid_request_error",
            },
          }),
          { status: 400 },
        ),
      ) as typeof fetch,
      model: "claude-test-model",
    });

    await expect(
      provider.generate({ context, requestId: crypto.randomUUID() }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "The AI provider workspace configuration is required.",
      }),
    );
  });
});
