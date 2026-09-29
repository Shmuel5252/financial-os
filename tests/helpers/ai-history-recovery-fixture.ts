import { randomUUID } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { REPORT_AI_SUMMARY_POLICY_VERSION } from "@/lib/reports/report-summary";

export function aiHistoryRecoveryFixture(owner = new ObjectId()) {
  const at = new Date("2026-09-29T00:00:00Z"); const sourceId = new ObjectId();
  const evidence = [{ label: "engine.available_cash", ref: "engine.fact", value: { amountMinor: "9007199254740993", currency: "ILS", kind: "money" } }];
  const response = { fact: [{ evidenceRefs: ["engine.fact"], text: "זהו הסבר סינתטי בלבד" }], insight: [], recommendation: [] };
  const usage = { inputTokens: 1, outputTokens: 1 };
  const user = { id: randomUUID(), role: "user", createdAt: at, text: "שאלה סינתטית לבדיקה" };
  const assistant = { id: randomUUID(), role: "assistant", createdAt: at, evidence, response, usage, focus: "safe_to_spend",
    model: "synthetic-model", provider: "anthropic", sourceReferences: [{ alias: "engine", kind: "financial_engine_snapshot", sourceId: sourceId.toHexString(), version: "synthetic-version" }] };
  const conversation: Document = { _id: new ObjectId(), userId: owner, createdAt: at, updatedAt: at, schemaVersion: 1,
    title: user.text, messages: [user, assistant], version: 1 };
  const summary: Document = { _id: new ObjectId(), userId: owner, createdAt: at, deletedAt: null, evidence, response, usage,
    idempotencyKeyHash: "a".repeat(64), model: "synthetic-model", provider: "anthropic", reportId: new ObjectId(),
    reportSourceFingerprint: "b".repeat(64), policyVersion: REPORT_AI_SUMMARY_POLICY_VERSION, version: 1 };
  return { conversation, summary };
}
