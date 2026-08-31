import { z } from "zod";

import type { ManualSection } from "@/lib/onboarding/manual-record";

export const phaseTwoFinancialSectionSchema = z.enum([
  "accounts",
  "transactions",
  "recurring_transactions",
  "income",
  "expenses",
  "cards",
  "loans",
  "savings",
  "goals",
]);

export type PhaseTwoFinancialSection = z.infer<
  typeof phaseTwoFinancialSectionSchema
>;

export const phaseTwoFinancialSections =
  phaseTwoFinancialSectionSchema.options satisfies readonly ManualSection[];
