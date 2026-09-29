/** Stored user-visible AI history only; no provider calls, prompt reconstruction or financial authority. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { aiEvidenceLabels } from "@/lib/ai/ai";
import { sanitizeAiUserText } from "@/lib/domain/ai/ai-safety";
import { REPORT_AI_SUMMARY_POLICY_VERSION } from "@/lib/reports/report-summary";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ref = z.string().min(1).max(80);
const value = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amountMinor: z.string().regex(/^-?\d+$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  z.object({ kind: z.literal("basis_points"), value: z.string().regex(/^-?\d+$/) }).strict(),
  z.object({ kind: z.literal("calendar_date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal("status"), value: z.string().min(1).max(100) }).strict(),
]);
const evidence = z.array(z.object({ label: z.enum(aiEvidenceLabels), ref, value }).strict()).max(32);
const item = z.object({ evidenceRefs: z.array(ref).min(1).max(8), text: z.string().min(1).max(500) }).strict();
const response = z.object({ fact: z.array(item).min(1).max(5), insight: z.array(item).max(5), recommendation: z.array(item).max(5) }).strict();
const usage = z.object({ inputTokens: count, outputTokens: count }).strict();
const generated = { evidence, response, usage, model: z.string().min(1).max(100), provider: z.literal("anthropic") };
const source = z.object({ alias: ref, kind: z.enum(["budget_period", "financial_engine_snapshot", "goal_progress", "purchase_simulation"]),
  sourceId: z.string().regex(/^[0-9a-f]{24}$/i), version: z.string().min(1).max(160) }).strict();
const messageBase = { id: z.string().uuid(), createdAt: z.date() };
const message = z.discriminatedUnion("role", [
  z.object({ ...messageBase, role: z.literal("user"), text: z.string().min(1).max(1000) }).strict(),
  z.object({ ...messageBase, ...generated, role: z.literal("assistant"), focus: z.enum(["goal", "monthly", "purchase", "safe_to_spend"]),
    sourceReferences: z.array(source).min(1).max(4) }).strict(),
]);
const conversation = z.object({ _id: id, userId: id, createdAt: z.date(), updatedAt: z.date(), schemaVersion: z.literal(1), version,
  title: z.string().min(1).max(80), messages: z.array(message).min(2).max(24) }).strict();
const summary = z.object({ _id: id, userId: id, createdAt: z.date(), deletedAt: z.date().nullable(), ...generated,
  idempotencyKeyHash: hash, policyVersion: z.literal(REPORT_AI_SUMMARY_POLICY_VERSION), reportId: id, reportSourceFingerprint: hash, version }).strict();
const fail = (): never => { throw new Error("AI history recovery requires review"); };
function checkedText(text: string) { if (sanitizeAiUserText(text).categories.length > 0) return fail(); }
function checkedMetadata(text: string) {
  // References/versions can legitimately contain long numeric revisions or hash segments.
  // Keep assignment/credential checks; do not reinterpret those identifiers as card numbers.
  if (sanitizeAiUserText(text).categories.some(category => category !== "card_number")) return fail();
}
function checkedGenerated(row: z.infer<typeof summary> | Extract<z.infer<typeof message>, { role: "assistant" }>) {
  checkedText(row.model);
  const refs = new Set(row.evidence.map(fact => fact.ref)); if (refs.size !== row.evidence.length) return fail();
  for (const fact of row.evidence) { checkedMetadata(fact.ref); if (fact.value.kind === "status") checkedText(fact.value.value); }
  for (const item of [...row.response.fact, ...row.response.insight, ...row.response.recommendation]) {
    checkedText(item.text); if (item.evidenceRefs.some(ref => !refs.has(ref))) return fail();
  }
  // Cited stored facts are not proof of canonical source ownership, historical correctness or current advice.
}
export function projectRecoveryAiConversation(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = conversation.parse(input); checkedText(row.title);
    if (row.messages.length !== row.version * 2 || new Set(row.messages.map(item => item.id)).size !== row.messages.length) return fail();
    for (const [index, message] of row.messages.entries()) {
      if (message.role !== (index % 2 === 0 ? "user" : "assistant")) return fail();
      if (message.role === "user") checkedText(message.text);
      else {
        checkedGenerated(message);
        for (const source of message.sourceReferences) { checkedMetadata(source.alias); checkedMetadata(source.version); }
      }
    }
    return input;
  } catch { return fail(); }
}
export function projectRecoveryReportSummary(input: Document): Document {
  try { assertRecoveryContent(input); const row = summary.parse(input); checkedGenerated(row); return input; }
  catch { return fail(); }
}
// Text checks reject known patterns, not arbitrary secrets. Real export/release needs its separate content/consistency gates.
