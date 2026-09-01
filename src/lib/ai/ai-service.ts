import "server-only";

import { randomUUID } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import type {
  AiConversation,
  AiConversationMessage,
  AiConversationView,
  SendAiMessageCommand,
} from "@/lib/ai/ai";
import {
  buildAiPreparedContext,
  toAiProviderContext,
  type AiContextDependencies,
} from "@/lib/ai/ai-context-service";
import {
  getAiConversationRepository,
  type AiConversationRepository,
} from "@/lib/ai/ai-conversation-repository";
import type { AiProvider } from "@/lib/ai/ai-provider";
import { getAnthropicAiProvider } from "@/lib/adapters/anthropic/anthropic-ai-provider";
import {
  ConsoleAiTelemetrySink,
  type AiTelemetrySink,
} from "@/lib/ai/ai-telemetry";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { AI_MINIMIZATION_VERSION, AI_REDACTION_VERSION } from "@/lib/domain/ai/ai-safety";
import { ApplicationError, ConflictError, NotFoundError } from "@/lib/errors/application-error";

export type AiServiceDependencies = AiContextDependencies &
  Readonly<{
    now?: () => Date;
    provider?: AiProvider;
    repository?: AiConversationRepository;
    telemetry?: AiTelemetrySink;
  }>;

async function resolveDependencies(dependencies?: AiServiceDependencies) {
  return {
    now: dependencies?.now ?? (() => new Date()),
    provider: dependencies?.provider ?? getAnthropicAiProvider(),
    repository: dependencies?.repository ?? (await getAiConversationRepository()),
    telemetry: dependencies?.telemetry ?? new ConsoleAiTelemetrySink(),
  };
}

function recentHistory(conversation: AiConversation | null): readonly string[] {
  if (conversation === null) return [];
  return conversation.messages.slice(-2).map((message) =>
    message.role === "user"
      ? message.text
      : [...message.response.fact, ...message.response.insight, ...message.response.recommendation]
          .map((item) => item.text)
          .join(" "),
  );
}

function safeErrorCategory(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "providerCategory" in error &&
    typeof error.providerCategory === "string"
  ) {
    return error.providerCategory;
  }
  if (error instanceof ApplicationError) return error.code;
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

export async function sendAiMessage(
  actor: Actor,
  command: SendAiMessageCommand,
  dependencies?: AiServiceDependencies,
): Promise<AiConversation> {
  const resolved = await resolveDependencies(dependencies);
  const existing =
    command.conversationId === undefined
      ? null
      : await resolved.repository.findForActor(actor, command.conversationId);
  if (command.conversationId !== undefined && existing === null) throw new NotFoundError();
  if (existing !== null && existing.version !== command.expectedVersion) {
    throw new ConflictError();
  }

  const prepared = await buildAiPreparedContext(
    actor,
    command.focus,
    command.question,
    command.includeRecentHistory ? recentHistory(existing) : [],
    dependencies,
  );
  const requestId = randomUUID();
  const startedAt = Date.now();
  let providerResult;
  try {
    providerResult = await resolved.provider.generate({
      context: toAiProviderContext(prepared),
      requestId,
    });
  } catch (error) {
    resolved.telemetry.emit({
      durationMs: Math.max(0, Date.now() - startedAt),
      errorCategory: safeErrorCategory(error),
      inputTokens: null,
      minimizationVersion: `${AI_MINIMIZATION_VERSION};${AI_REDACTION_VERSION}`,
      model: "unavailable",
      outputTokens: null,
      provider: "anthropic",
      requestId,
      retryCount: 0,
      status: "failure",
    });
    throw error;
  }

  resolved.telemetry.emit({
    durationMs: Math.max(0, Date.now() - startedAt),
    errorCategory: null,
    inputTokens: providerResult.usage.inputTokens,
    minimizationVersion: prepared.minimizationVersion,
    model: providerResult.model,
    outputTokens: providerResult.usage.outputTokens,
    provider: "anthropic",
    requestId,
    retryCount: 0,
    status: "success",
  });

  const now = resolved.now();
  const messages: readonly AiConversationMessage[] = [
    { createdAt: now, id: randomUUID(), role: "user", text: prepared.untrustedUserText },
    {
      createdAt: now,
      evidence: prepared.evidence,
      focus: command.focus,
      id: randomUUID(),
      model: providerResult.model,
      provider: providerResult.provider,
      response: providerResult.response,
      role: "assistant",
      sourceReferences: prepared.sourceReferences,
      usage: providerResult.usage,
    },
  ];

  if (existing === null) {
    return resolved.repository.createForActor(
      actor,
      prepared.untrustedUserText.slice(0, 80),
      messages,
    );
  }
  return resolved.repository.appendForActor(actor, existing.id, existing.version, messages);
}

export async function listAiConversations(
  actor: Actor,
  limit: number,
  dependencies?: AiServiceDependencies,
): Promise<readonly AiConversation[]> {
  const repository = dependencies?.repository ?? (await getAiConversationRepository());
  return repository.listForActor(actor, limit);
}

export async function deleteAiConversation(
  actor: Actor,
  conversationId: string,
  expectedVersion: number,
  dependencies?: AiServiceDependencies,
): Promise<void> {
  const repository = dependencies?.repository ?? (await getAiConversationRepository());
  if (!(await repository.deleteForActor(actor, conversationId, expectedVersion))) {
    throw new NotFoundError();
  }
}

export async function loadAiCopilotView(
  actor: Actor,
  dependencies?: AiServiceDependencies,
): Promise<Readonly<{
  configured: boolean;
  conversations: readonly AiConversationView[];
}>> {
  const { toAiConversationView } = await import("@/lib/ai/ai");
  return {
    configured: getConfigurationStatus().futureAdapters.anthropicConfigured,
    conversations: (await listAiConversations(actor, 10, dependencies)).map(toAiConversationView),
  };
}
