import { z } from "zod";

import type { AiEvidenceFact, AiProviderUsage, AiStructuredResponse } from "@/lib/ai/ai";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const REPORT_AI_SUMMARY_POLICY_VERSION = "phase-16-report-summary-v1";

export const generateReportSummaryCommandSchema = z.object({
  expectedSummaryVersion: z.number().int().positive().nullable(),
  idempotencyKey: z.string().uuid(),
  reportId: z.string().regex(/^[0-9a-f]{24}$/i),
}).strict();
export const deleteReportSummaryCommandSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

export type ReportAiSummary = Readonly<{
  createdAt: Date;
  evidence: readonly AiEvidenceFact[];
  id: string;
  model: string;
  policyVersion: typeof REPORT_AI_SUMMARY_POLICY_VERSION;
  provider: "anthropic";
  reportId: string;
  reportSourceFingerprint: string;
  response: AiStructuredResponse;
  usage: AiProviderUsage;
  version: number;
}>;
export type ReportAiSummaryView = Omit<ReportAiSummary, "createdAt"> & Readonly<{ createdAt: string }>;

export function toReportAiSummaryView(summary: ReportAiSummary): ReportAiSummaryView { return { ...summary, createdAt: summary.createdAt.toISOString() }; }
export function parseReportSummaryCommand<T>(schema: z.ZodType<T>, input: unknown): T { return parseUntrusted(schema, input); }
