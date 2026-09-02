import "server-only";

import { randomUUID } from "node:crypto";

import { getAnthropicAiProvider } from "@/lib/adapters/anthropic/anthropic-ai-provider";
import type { AiEvidenceFact, AiEvidenceLabel, AiPreparedContext } from "@/lib/ai/ai";
import type { AiProvider } from "@/lib/ai/ai-provider";
import { toAiProviderContext } from "@/lib/ai/ai-context-service";
import { ConsoleAiTelemetrySink, type AiTelemetrySink } from "@/lib/ai/ai-telemetry";
import type { Actor } from "@/lib/auth/actor";
import { AI_MINIMIZATION_VERSION, AI_REDACTION_VERSION } from "@/lib/domain/ai/ai-safety";
import { ConflictError, InputValidationError } from "@/lib/errors/application-error";
import { findSavedReport } from "@/lib/reports/report-service";
import { REPORT_AI_SUMMARY_POLICY_VERSION, type ReportAiSummary } from "@/lib/reports/report-summary";
import { getReportSummaryRepository, type ReportSummaryRepository } from "@/lib/reports/report-summary-repository";

type Dependencies = Readonly<{ provider?: AiProvider; repository?: ReportSummaryRepository; telemetry?: AiTelemetrySink }>;
const mapping: Readonly<Record<string, AiEvidenceLabel>> = {
  "budget.item": "report.budget_allocated", "goal.item": "report.goal", "liability.item": "report.debt", "net_worth.total": "report.net_worth", "savings.item": "report.savings", "cash_flow.net": "report.net_cash_flow",
};

function evidenceForReport(report: Awaited<ReturnType<typeof findSavedReport>>): readonly AiEvidenceFact[] {
  const lines = [...report.report.sections.cashFlow, ...report.report.sections.budget, ...report.report.sections.debt, ...report.report.sections.savings, ...report.report.sections.netWorth, ...report.report.sections.goals];
  return lines.flatMap((line, index) => {
    const label = mapping[line.key]; if (label === undefined) return [];
    return [{ label, ref: `report.fact.${index + 1}`, value: { amountMinor: line.amount.amountMinor.toString(), currency: line.amount.currency, kind: "money" as const } }];
  }).slice(0, 32);
}

export function buildReportSummaryContext(report: Awaited<ReturnType<typeof findSavedReport>>): AiPreparedContext {
  const evidence = evidenceForReport(report);
  if (evidence.length === 0) throw new InputValidationError([{ field: "report", message: "The closed report has no deterministic facts to explain." }]);
  return {
    evidence, focus: "report", minimizationVersion: `${AI_MINIMIZATION_VERSION};${AI_REDACTION_VERSION};${REPORT_AI_SUMMARY_POLICY_VERSION}`,
    redactionCategories: [], sourceReferences: [{ alias: "report.closed", kind: "report_snapshot", sourceId: report.id, version: `${report.report.engineVersion}/${report.report.policyVersion}/${report.reportVersion}` }],
    untrustedRecentHistory: [], untrustedUserText: "הסבר בקצרה את תמונת הדוח, הסיכונים והצעדים האפשריים, ורק לפי הראיות הדטרמיניסטיות.",
  };
}

function safeErrorCategory(error: unknown): string { return typeof error === "object" && error !== null && "providerCategory" in error && typeof error.providerCategory === "string" ? error.providerCategory : error instanceof Error ? error.name : "UNKNOWN_ERROR"; }

export async function generateReportAiSummary(actor: Actor, input: Readonly<{ expectedSummaryVersion: number | null; idempotencyKey: string; reportId: string }>, dependencies?: Dependencies): Promise<ReportAiSummary> {
  const report = await findSavedReport(actor, input.reportId);
  const repository = dependencies?.repository ?? await getReportSummaryRepository();
  const existing = await repository.listForReportActor(actor, report.id);
  const currentVersion = existing[0]?.version ?? null;
  if (currentVersion !== input.expectedSummaryVersion) throw new ConflictError("The report summary changed; reload first.");
  const context = buildReportSummaryContext(report); const evidence = context.evidence;
  const provider = dependencies?.provider ?? getAnthropicAiProvider(); const telemetry = dependencies?.telemetry ?? new ConsoleAiTelemetrySink(); const requestId = randomUUID(); const startedAt = Date.now();
  let result;
  try { result = await provider.generate({ context: toAiProviderContext(context), requestId }); }
  catch (error) { telemetry.emit({ durationMs: Math.max(0, Date.now() - startedAt), errorCategory: safeErrorCategory(error), inputTokens: null, minimizationVersion: context.minimizationVersion, model: "unavailable", outputTokens: null, provider: "anthropic", requestId, retryCount: 0, status: "failure" }); throw error; }
  telemetry.emit({ durationMs: Math.max(0, Date.now() - startedAt), errorCategory: null, inputTokens: result.usage.inputTokens, minimizationVersion: context.minimizationVersion, model: result.model, outputTokens: result.usage.outputTokens, provider: "anthropic", requestId, retryCount: 0, status: "success" });
  return repository.createForActor(actor, { evidence, model: result.model, policyVersion: REPORT_AI_SUMMARY_POLICY_VERSION, provider: result.provider, reportId: report.id, reportSourceFingerprint: report.report.sourceFingerprint, response: result.response, usage: result.usage, version: (currentVersion ?? 0) + 1 }, input.idempotencyKey);
}

export async function listReportAiSummaries(actor: Actor, reportId: string, dependencies?: Dependencies) { await findSavedReport(actor, reportId); return (dependencies?.repository ?? await getReportSummaryRepository()).listForReportActor(actor, reportId); }
export async function deleteReportAiSummary(actor: Actor, id: string, reportId: string, expectedVersion: number, dependencies?: Dependencies) {
  const repository = dependencies?.repository ?? await getReportSummaryRepository(); const summaries = await listReportAiSummaries(actor, reportId, { ...dependencies, repository });
  if (!summaries.some((summary) => summary.id === id)) throw new ConflictError(); await repository.deleteForActor(actor, id, expectedVersion);
}
