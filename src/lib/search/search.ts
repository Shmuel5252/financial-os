import { z } from "zod";

import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const SEARCH_INDEX_VERSION = "authorized-search-index-v1";
export const SEARCH_POLICY_VERSION = "phase-16-search-policy-v1";
export const SEARCH_MAX_RESULTS = 100;

export const searchQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  householdId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_RESULTS).default(25),
  query: z.string().trim().min(2).max(100),
  scopeKind: z.enum(["personal", "household"]).default("personal"),
}).superRefine((value, context) => {
  if ((value.scopeKind === "household") !== (value.householdId !== undefined)) {
    context.addIssue({ code: "custom", message: "Household scope requires one household.", path: ["householdId"] });
  }
});

export const rebuildSearchIndexCommandSchema = z.object({ confirm: z.literal(true) }).strict();

export type SearchDomain = "account" | "ai_summary" | "asset" | "budget_category" | "debt" | "goal" | "notification" | "report" | "transaction";
export type SearchIndexItem = Readonly<{
  domain: SearchDomain;
  searchText?: string;
  sourceId: string;
  sourceUpdatedAt: string;
  sourceVersion: number;
  subtitle: string;
  title: string;
}>;
export type SearchResultView = Readonly<{
  domain: SearchDomain;
  freshness: "CURRENT" | "STALE";
  key: string;
  subtitle: string;
  title: string;
}>;
export type SearchPageView = Readonly<{ nextCursor: string | null; results: readonly SearchResultView[] }>;

export function parseSearchQuery(input: unknown) {
  return parseUntrusted(searchQuerySchema, input);
}
