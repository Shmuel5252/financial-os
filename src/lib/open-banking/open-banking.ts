import { z } from "zod";

import type { SerializedMoney } from "@/lib/domain/money/money";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const OPEN_BANKING_PROVIDER = "financy" as const;
export const OPEN_BANKING_POLICY_VERSION = "open-banking-policy-v1";
export const OPEN_BANKING_NORMALIZATION_VERSION = "financy-normalization-v2";
export const OPEN_BANKING_MAX_PAGES = 20;
export const OPEN_BANKING_PAGE_LIMIT = 500;
export const OPEN_BANKING_FRESHNESS_MAX_AGE_DAYS = 2;

export const claimOpenBankingCommandSchema = z.object({
  confirmation: z.literal("CLAIM_CONFIGURED_FINANCY_SUBJECT"),
});

export const synchronizeOpenBankingCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
});

export const refreshOpenBankingCommandSchema = z.object({
  confirmation: z.literal("CONFIRM_20_CREDIT_REFRESH"),
  idempotencyKey: z.string().uuid(),
});

export const disconnectOpenBankingCommandSchema = z.object({
  confirmation: z.literal("DELETE_FINANCY_CONNECTION"),
  connectionId: z.string().regex(/^[0-9a-f]{24}$/i),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export type OpenBankingFreshness = "FRESH" | "STALE" | "UNKNOWN";

export type OpenBankingConnectionView = Readonly<{
  accountCount: number;
  consentExpiresOn: string | null;
  freshness: OpenBankingFreshness;
  id: string;
  lastFetchedAt: string | null;
  lastFetchedDataDate: string | null;
  mode: string | null;
  status: string;
  transactionCount: number;
  version: number;
}>;

export type OpenBankingAccountView = Readonly<{
  balances: readonly Readonly<{
    amount: SerializedMoney;
    referenceDate: string | null;
    type: string;
  }>[];
  currency: string;
  displayName: string;
  type: "CARD" | "CHECKING" | "LOAN" | "SAVINGS" | "SECURITY";
}>;

export type OpenBankingSyncRunView = Readonly<{
  accountObservationCount: number;
  canonicalAccountCount: number;
  canonicalTransactionCount: number;
  completedAt: string | null;
  connectionObservationCount: number;
  errorCategory: string | null;
  id: string;
  startedAt: string;
  status: "completed" | "failed" | "partial" | "running";
  transactionObservationCount: number;
}>;

export type OpenBankingCenterView = Readonly<{
  accounts: readonly OpenBankingAccountView[];
  bindingClaimed: boolean;
  configured: boolean;
  connections: readonly OpenBankingConnectionView[];
  latestRun: OpenBankingSyncRunView | null;
  policyVersion: string;
  provider: typeof OPEN_BANKING_PROVIDER;
}>;

export function parseOpenBankingCommand<TOutput>(
  schema: z.ZodType<TOutput>,
  input: unknown,
): TOutput {
  return parseUntrusted(schema, input);
}
