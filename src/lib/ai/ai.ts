import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);

export const aiFocusSchema = z.enum([
  "goal",
  "monthly",
  "purchase",
  "safe_to_spend",
]);

export const sendAiMessageCommandSchema = z
  .object({
    conversationId: objectIdSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    focus: aiFocusSchema,
    includeRecentHistory: z.boolean().default(false),
    question: z.string().trim().min(5).max(1_000),
  })
  .superRefine((value, context) => {
    if ((value.conversationId === undefined) !== (value.expectedVersion === undefined)) {
      context.addIssue({
        code: "custom",
        message: "conversationId and expectedVersion must be provided together.",
        path: ["conversationId"],
      });
    }
    if (value.conversationId === undefined && value.includeRecentHistory) {
      context.addIssue({
        code: "custom",
        message: "Recent history requires an existing conversation.",
        path: ["includeRecentHistory"],
      });
    }
  });

export const aiConversationPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const deleteAiConversationCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export type AiFocus = z.infer<typeof aiFocusSchema>;
export type AiProviderFocus = AiFocus | "report";
export type SendAiMessageCommand = z.infer<typeof sendAiMessageCommandSchema>;

export const aiEvidenceLabels = [
  "budget.allocated",
  "budget.confirmed_income",
  "budget.forecast_spending",
  "budget.month",
  "budget.spending",
  "budget.unallocated",
  "budget.uncertain_income",
  "engine.available_cash",
  "engine.future_balance",
  "engine.horizon_end",
  "engine.minimum_balance",
  "engine.safe_to_spend",
  "engine.safety_margin",
  "engine.shortfall",
  "goal.current",
  "goal.evaluation_date",
  "goal.progress",
  "goal.remaining_gap",
  "goal.status",
  "goal.target",
  "purchase.classification",
  "purchase.financed_cost",
  "purchase.freshness",
  "purchase.minimum_balance",
  "purchase.proposed_date",
  "purchase.safer_date",
  "purchase.safety_margin",
  "purchase.total_price",
  "report.budget_allocated",
  "report.debt",
  "report.goal",
  "report.net_cash_flow",
  "report.net_worth",
  "report.savings",
] as const;

export type AiEvidenceLabel = (typeof aiEvidenceLabels)[number];

export type AiEvidenceValue =
  | Readonly<{ amountMinor: string; currency: string; kind: "money" }>
  | Readonly<{ kind: "basis_points"; value: string }>
  | Readonly<{ kind: "calendar_date"; value: string }>
  | Readonly<{ kind: "status"; value: string }>;

export type AiEvidenceFact = Readonly<{
  label: AiEvidenceLabel;
  ref: string;
  value: AiEvidenceValue;
}>;

export type AiSourceReference = Readonly<{
  alias: string;
  kind: "budget_period" | "financial_engine_snapshot" | "goal_progress" | "purchase_simulation" | "report_snapshot";
  sourceId: string;
  version: string;
}>;

export type AiProviderSourceReference = Omit<AiSourceReference, "sourceId">;

export type AiPreparedContext = Readonly<{
  evidence: readonly AiEvidenceFact[];
  focus: AiProviderFocus;
  minimizationVersion: string;
  redactionCategories: readonly string[];
  sourceReferences: readonly AiSourceReference[];
  untrustedRecentHistory: readonly string[];
  untrustedUserText: string;
}>;

export type AiProviderContext = Omit<AiPreparedContext, "sourceReferences"> &
  Readonly<{ sourceReferences: readonly AiProviderSourceReference[] }>;

export type AiResponseItem = Readonly<{
  evidenceRefs: readonly string[];
  text: string;
}>;

export type AiStructuredResponse = Readonly<{
  fact: readonly AiResponseItem[];
  insight: readonly AiResponseItem[];
  recommendation: readonly AiResponseItem[];
}>;

export type AiProviderUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
}>;

export type AiProviderResult = Readonly<{
  model: string;
  provider: "anthropic";
  response: AiStructuredResponse;
  usage: AiProviderUsage;
}>;

export type AiProviderRequest = Readonly<{
  context: AiProviderContext;
  requestId: string;
}>;

export type AiConversationMessage =
  | Readonly<{
      createdAt: Date;
      id: string;
      role: "user";
      text: string;
    }>
  | Readonly<{
      createdAt: Date;
      evidence: readonly AiEvidenceFact[];
      focus: AiFocus;
      id: string;
      model: string;
      provider: "anthropic";
      response: AiStructuredResponse;
      role: "assistant";
      sourceReferences: readonly AiSourceReference[];
      usage: AiProviderUsage;
    }>;

export type AiConversation = Readonly<{
  createdAt: Date;
  id: string;
  messages: readonly AiConversationMessage[];
  schemaVersion: 1;
  title: string;
  updatedAt: Date;
  version: number;
}>;

export type AiConversationMessageView =
  | Readonly<{
      createdAt: string;
      id: string;
      role: "user";
      text: string;
    }>
  | Readonly<{
      createdAt: string;
      evidence: readonly AiEvidenceFact[];
      focus: AiFocus;
      id: string;
      model: string;
      provider: "anthropic";
      response: AiStructuredResponse;
      role: "assistant";
      sourceReferences: readonly AiProviderSourceReference[];
      usage: AiProviderUsage;
    }>;

export type AiConversationView = Readonly<{
  createdAt: string;
  id: string;
  messages: readonly AiConversationMessageView[];
  schemaVersion: 1;
  title: string;
  updatedAt: string;
  version: number;
}>;

export function toAiConversationView(conversation: AiConversation): AiConversationView {
  return {
    ...conversation,
    createdAt: conversation.createdAt.toISOString(),
    messages: conversation.messages.map((message) =>
      message.role === "user"
        ? { ...message, createdAt: message.createdAt.toISOString() }
        : {
            ...message,
            createdAt: message.createdAt.toISOString(),
            sourceReferences: message.sourceReferences.map((reference) => ({
              alias: reference.alias,
              kind: reference.kind,
              version: reference.version,
            })),
          },
    ),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}
