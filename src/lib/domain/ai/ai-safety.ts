import { z } from "zod";

import type {
  AiEvidenceFact,
  AiProviderContext,
  AiStructuredResponse,
} from "@/lib/ai/ai";

export const AI_MINIMIZATION_VERSION = "ai-minimization/1.0.0";
export const AI_REDACTION_VERSION = "ai-redaction/1.0.0";

const responseItemSchema = z.object({
  evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(8),
  text: z.string().trim().min(1).max(500),
});

export const aiStructuredResponseSchema = z.object({
  fact: z.array(responseItemSchema).min(1).max(5),
  insight: z.array(responseItemSchema).max(5),
  recommendation: z.array(responseItemSchema).max(5),
});

type RedactionResult = Readonly<{
  categories: readonly string[];
  text: string;
}>;

const redactionRules: readonly Readonly<{
  category: string;
  pattern: RegExp;
  replacement: string;
}>[] = [
  {
    category: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    category: "authorization",
    pattern: /\b(?:authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._~+\/-]{16,}/gi,
    replacement: "[REDACTED_AUTHORIZATION]",
  },
  {
    category: "provider_secret",
    pattern: /\b(?:sk-ant-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g,
    replacement: "[REDACTED_PROVIDER_SECRET]",
  },
  {
    category: "secret_assignment",
    pattern: /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?token|password|secret|webhook[_ -]?secret)\s*[:=]\s*[^\s,;]{4,}/gi,
    replacement: "[REDACTED_SECRET]",
  },
  {
    category: "credential_uri",
    pattern: /\b(?:mongodb(?:\+srv)?|https?):\/\/[^\s:/]+:[^\s@/]+@[^\s]+/gi,
    replacement: "[REDACTED_CREDENTIAL_URI]",
  },
  {
    category: "card_security_code",
    pattern: /\b(?:cvv|cvc)\s*[:=]?\s*\d{3,4}\b/gi,
    replacement: "[REDACTED_CARD_SECURITY_CODE]",
  },
  {
    category: "card_number",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[REDACTED_CARD_NUMBER]",
  },
];

const forbiddenContextKeys = new Set([
  "_id",
  "accesstoken",
  "apikey",
  "authorization",
  "cookie",
  "cvv",
  "cvc",
  "password",
  "privatekey",
  "providertoken",
  "refreshtoken",
  "sessionid",
  "sessiontoken",
  "userid",
  "webhooksecret",
]);

const digitPattern = /[0-9\u0660-\u0669\u06f0-\u06f9]/u;
const hebrewPattern = /[\u0590-\u05ff]/u;

export function sanitizeAiUserText(input: string): RedactionResult {
  const categories = new Set<string>();
  let text = input.trim();

  for (const rule of redactionRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      categories.add(rule.category);
      rule.pattern.lastIndex = 0;
      text = text.replace(rule.pattern, rule.replacement);
    }
  }

  return { categories: [...categories].sort(), text };
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function inspectContext(value: unknown, path: string, fieldName?: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectContext(entry, `${path}[${index}]`, fieldName));
    return;
  }
  if (value === null || typeof value !== "object") {
    if (
      typeof value === "string" &&
      fieldName !== "amountMinor" &&
      fieldName !== "value" &&
      fieldName !== "version"
    ) {
      const sanitized = sanitizeAiUserText(value);
      if (sanitized.categories.length > 0) {
        throw new RangeError(`AI context contains prohibited data at ${path}.`);
      }
    }
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenContextKeys.has(normalizeKey(key))) {
      throw new RangeError(`AI context contains a prohibited field at ${path}.${key}.`);
    }
    inspectContext(entry, `${path}.${key}`, key);
  }
}

export function assertSafeAiProviderContext(context: AiProviderContext): void {
  inspectContext(context, "context");
  if (context.evidence.length > 32) {
    throw new RangeError("AI context exceeds the evidence minimization boundary.");
  }
  if (context.untrustedRecentHistory.length > 2) {
    throw new RangeError("AI context exceeds the explicit history boundary.");
  }
}

function validateItem(
  item: Readonly<{ evidenceRefs: readonly string[]; text: string }>,
  evidenceRefs: ReadonlySet<string>,
): void {
  if (!hebrewPattern.test(item.text)) {
    throw new RangeError("AI response text must use Hebrew.");
  }
  if (digitPattern.test(item.text)) {
    throw new RangeError("AI response text cannot introduce numerical claims.");
  }
  for (const reference of item.evidenceRefs) {
    if (!evidenceRefs.has(reference)) {
      throw new RangeError("AI response cites unavailable financial evidence.");
    }
  }
}

export function validateAiStructuredResponse(
  input: unknown,
  evidence: readonly AiEvidenceFact[],
): AiStructuredResponse {
  const response = aiStructuredResponseSchema.parse(input);
  const evidenceRefs = new Set(evidence.map((fact) => fact.ref));
  for (const item of [
    ...response.fact,
    ...response.insight,
    ...response.recommendation,
  ]) {
    validateItem(item, evidenceRefs);
  }
  return response;
}
