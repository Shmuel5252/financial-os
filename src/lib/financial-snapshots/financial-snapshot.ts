import { z } from "zod";

import { manualSectionSchema, type ManualSection } from "@/lib/onboarding/manual-record";

export const financialSnapshotSections = [
  "accounts",
  "transactions",
  "recurring_transactions",
  "income",
  "expenses",
  "cards",
  "loans",
  "savings",
] as const satisfies readonly ManualSection[];

export const createFinancialSnapshotCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
});

export const financialSnapshotPageQuerySchema = z.object({
  cursor: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type FinancialSnapshotSource = Readonly<{
  records: readonly Readonly<{
    id: string;
    updatedAt: Date;
    version: number;
  }>[];
  section: ManualSection;
}>;

export type FinancialSnapshot = Readonly<{
  capturedAt: Date;
  id: string;
  kind: "source_manifest";
  primaryCurrency: string;
  schemaVersion: 1;
  sources: readonly FinancialSnapshotSource[];
}>;

export type FinancialSnapshotView = Readonly<{
  capturedAt: string;
  id: string;
  kind: "source_manifest";
  primaryCurrency: string;
  schemaVersion: 1;
  sources: readonly Readonly<{
    records: readonly Readonly<{
      id: string;
      updatedAt: string;
      version: number;
    }>[];
    section: ManualSection;
  }>[];
}>;

export const storedFinancialSnapshotSourceSchema = z.object({
  records: z.array(
    z.object({
      id: z.string().regex(/^[0-9a-f]{24}$/i),
      updatedAt: z.date(),
      version: z.number().int().positive(),
    }),
  ),
  section: manualSectionSchema,
});

export function toFinancialSnapshotView(
  snapshot: FinancialSnapshot,
): FinancialSnapshotView {
  return {
    ...snapshot,
    capturedAt: snapshot.capturedAt.toISOString(),
    sources: snapshot.sources.map((source) => ({
      records: source.records.map((record) => ({
        ...record,
        updatedAt: record.updatedAt.toISOString(),
      })),
      section: source.section,
    })),
  };
}
