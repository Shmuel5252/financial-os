import { z } from "zod";

import type { Money, SerializedMoney } from "@/lib/domain/money/money";
import { serializeMoney } from "@/lib/domain/money/money";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const REPORT_ENGINE_VERSION = "financial-report-v1";
export const REPORT_POLICY_VERSION = "phase-16-report-policy-v1";
export const REPORT_EXPORT_VERSION = "financial-report-export-v1";
export const REPORT_MAX_SOURCE_RECORDS = 10_000;

export const reportPeriodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("month"), value: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.object({ kind: z.literal("year"), value: z.string().regex(/^\d{4}$/) }),
]);

export const reportScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("personal") }),
  z.object({ householdId: z.string().regex(/^[0-9a-f]{24}$/i), kind: z.literal("household") }),
]);

export const reportQuerySchema = z.object({
  periodKind: z.enum(["month", "year"]),
  periodValue: z.string().min(4).max(7),
  scopeKind: z.enum(["personal", "household"]).default("personal"),
  householdId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
  snapshotId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
}).superRefine((value, context) => {
  if ((value.scopeKind === "household") !== (value.householdId !== undefined)) {
    context.addIssue({ code: "custom", message: "Household scope requires exactly one household.", path: ["householdId"] });
  }
});

export const closeReportCommandSchema = z.object({
  action: z.enum(["close", "restate"]),
  idempotencyKey: z.string().uuid(),
  period: reportPeriodSchema,
  reason: z.string().trim().min(5).max(500).optional(),
  scope: reportScopeSchema,
  supersedesId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
}).superRefine((value, context) => {
  if (value.action === "close" && (value.reason !== undefined || value.supersedesId !== undefined)) {
    context.addIssue({ code: "custom", message: "A close does not supersede another report.", path: ["action"] });
  }
  if (value.action === "restate" && (value.reason === undefined || value.supersedesId === undefined)) {
    context.addIssue({ code: "custom", message: "A restatement requires a reason and prior report.", path: ["supersedesId"] });
  }
});

export const deleteReportCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export type ReportScope = z.infer<typeof reportScopeSchema>;

export type ReportSourceReference = Readonly<{
  alias: string;
  kind: string;
  sourceId: string;
  version: string;
}>;

export type ReportMoneyLine = Readonly<{
  amount: Money;
  key: string;
  label: string;
  sourceAliases: readonly string[];
}>;

export type FinancialReport = Readonly<{
  engineVersion: typeof REPORT_ENGINE_VERSION;
  generatedAt: string;
  period: ReportPeriod;
  periodEnd: string;
  periodStart: string;
  policyVersion: typeof REPORT_POLICY_VERSION;
  scope: ReportScope;
  sections: Readonly<{
    accounts: readonly ReportMoneyLine[];
    budget: readonly ReportMoneyLine[];
    cashFlow: readonly ReportMoneyLine[];
    categories: readonly ReportMoneyLine[];
    debt: readonly ReportMoneyLine[];
    goals: readonly ReportMoneyLine[];
    netWorth: readonly ReportMoneyLine[];
    savings: readonly ReportMoneyLine[];
    subscriptions: readonly ReportMoneyLine[];
  }>;
  sourceFingerprint: string;
  sourceReferences: readonly ReportSourceReference[];
  timeZone: string;
}>;

export type ReportMoneyLineView = Omit<ReportMoneyLine, "amount"> & Readonly<{ amount: SerializedMoney }>;
export type FinancialReportView = Omit<FinancialReport, "sections" | "sourceReferences"> & Readonly<{
  sections: { [K in keyof FinancialReport["sections"]]: readonly ReportMoneyLineView[] };
  sourceReferences: readonly Omit<ReportSourceReference, "sourceId">[];
}>;

export type SavedFinancialReport = Readonly<{
  authorizationFingerprint: string | null;
  createdAt: Date;
  hiddenAt: Date | null;
  id: string;
  report: FinancialReport;
  reportVersion: number;
  restatementReason: string | null;
  rootReportId: string;
  schemaVersion: 1;
  status: "closed" | "restated";
  supersedesId: string | null;
  version: number;
}>;

export type SavedFinancialReportView = Readonly<{
  createdAt: string;
  id: string;
  report: FinancialReportView;
  reportVersion: number;
  restatementReason: string | null;
  rootReportId: string;
  schemaVersion: 1;
  status: "closed" | "restated";
  supersedesId: string | null;
  version: number;
}>;

const reportMoneySchema = z.object({
  amountMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).transform((value) => ({ ...value, currency: value.currency as Money["currency"] }));
const reportLineSchema = z.object({
  amount: reportMoneySchema,
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  sourceAliases: z.array(z.string().min(1).max(100)).max(REPORT_MAX_SOURCE_RECORDS),
});
const reportSectionSchema = z.array(reportLineSchema).max(REPORT_MAX_SOURCE_RECORDS);
export const financialReportDomainSchema = z.object({
  engineVersion: z.literal(REPORT_ENGINE_VERSION),
  generatedAt: z.string().datetime(),
  period: reportPeriodSchema,
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  policyVersion: z.literal(REPORT_POLICY_VERSION),
  scope: reportScopeSchema,
  sections: z.object({
    accounts: reportSectionSchema,
    budget: reportSectionSchema,
    cashFlow: reportSectionSchema,
    categories: reportSectionSchema,
    debt: reportSectionSchema,
    goals: reportSectionSchema,
    netWorth: reportSectionSchema,
    savings: reportSectionSchema,
    subscriptions: reportSectionSchema,
  }),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  sourceReferences: z.array(z.object({
    alias: z.string().min(1).max(100),
    kind: z.string().min(1).max(50),
    sourceId: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
  })).max(REPORT_MAX_SOURCE_RECORDS * 4),
  timeZone: z.string().min(1).max(100),
});

export function validateFinancialReport(value: unknown): FinancialReport {
  return financialReportDomainSchema.parse(value) as unknown as FinancialReport;
}

export function parseReportCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseUntrusted(schema, input);
}

function lineView(line: ReportMoneyLine): ReportMoneyLineView {
  return { ...line, amount: serializeMoney(line.amount) };
}

export function toFinancialReportView(report: FinancialReport): FinancialReportView {
  return {
    ...report,
    sections: Object.fromEntries(Object.entries(report.sections).map(([key, lines]) => [key, lines.map(lineView)])) as unknown as FinancialReportView["sections"],
    sourceReferences: report.sourceReferences.map((reference) => ({ alias: reference.alias, kind: reference.kind, version: reference.version })),
  };
}

export function toSavedFinancialReportView(saved: SavedFinancialReport): SavedFinancialReportView {
  return {
    createdAt: saved.createdAt.toISOString(),
    id: saved.id,
    report: toFinancialReportView(saved.report),
    reportVersion: saved.reportVersion,
    restatementReason: saved.restatementReason,
    rootReportId: saved.rootReportId,
    schemaVersion: saved.schemaVersion,
    status: saved.status,
    supersedesId: saved.supersedesId,
    version: saved.version,
  };
}
