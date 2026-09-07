import "server-only";

import { z } from "zod";

import { requireOpenFinanceEnv } from "@/lib/config/server-env";
import { parseMajorMoney } from "@/lib/domain/money/money-input";
import {
  OpenBankingProviderError,
  type OpenBankingAccountObservation,
  type OpenBankingConnectionObservation,
  type OpenBankingPage,
  type OpenBankingProvider,
  type OpenBankingProviderErrorCategory,
  type OpenBankingRefreshResult,
  type OpenBankingTransactionObservation,
} from "@/lib/open-banking/open-banking-provider";
import { OPEN_BANKING_PAGE_LIMIT } from "@/lib/open-banking/open-banking";
import { parseJsonPreservingNumbers } from "@/lib/adapters/financy/financy-json";
import { minimizeAccountIdentity, safeAccountLabel } from "@/lib/open-banking/account-identity";

const AUTH_URL = "https://api.open-finance.ai/oauth/token";
const API_BASE_URL = "https://api.open-finance.ai/v2";
const REFRESH_URL = "https://api.open-finance.ai/chat/chat/connections/refresh";
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });
const boundedText = z.string().trim().min(1).max(500);
const exactDecimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const exactAmountSchema = z.object({ amount: exactDecimal, currency });
const transactionAmountSchema = z.object({ amount: z.union([exactDecimal, z.literal("")]), currency });
const optionalDate = calendarDate.nullable().optional();
const optionalInstant = instant.nullable().optional();

const tokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.coerce.number().int().positive().max(604_800),
  tokenType: z.string().min(1),
});

const connectionSchema = z.object({
  expiryDate: optionalDate,
  id: boundedText,
  lastFetchedAt: optionalInstant,
  lastFetchedDataDate: optionalDate,
  mode: z.string().trim().max(100).nullable().optional(),
  providerId: boundedText,
  status: boundedText,
  userId: boundedText.nullable().optional(),
});

const balanceSchema = z.object({
  amount: exactDecimal.optional(),
  balanceAmount: exactAmountSchema.optional(),
  balanceType: boundedText.optional(),
  creditLimitIncluded: z.boolean().nullable().optional(),
  currency: currency.optional(),
  referenceDate: optionalDate,
});

const accountSchema = z.object({
  accountNumber: z.string().max(500).nullable().optional(),
  parsedAccount: z.object({
    bank: z.string().max(100).nullable().optional(),
    branch: z.string().max(100).nullable().optional(),
    number: z.string().max(500).nullable().optional(),
  }).nullable().optional(),
  accountName: z.string().trim().max(120).nullable().optional(),
  accountType: z.enum(["CARD", "CHECKING", "LOAN", "SAVINGS", "SECURITY"]),
  balances: z.array(balanceSchema).max(32).default([]),
  connectionId: boundedText,
  currency,
  id: boundedText,
  isDuplicate: z.boolean().optional().default(false),
  providerId: boundedText,
});

const categorySchema = z.object({
  main: z.string().trim().max(120).nullable().optional(),
  sub: z.string().trim().max(120).nullable().optional(),
}).nullable().optional();

const transactionSchema = z.object({
  SK: boundedText,
  accountId: boundedText,
  amount: z.object({
    chargedAmount: transactionAmountSchema,
    originalAmount: transactionAmountSchema.nullable().optional(),
  }).optional(),
  bookingDate: optionalDate,
  category: categorySchema,
  changedCategory: categorySchema,
  chargedAmount: transactionAmountSchema.optional(),
  connectionId: boundedText,
  date: z.object({
    bookingDate: optionalDate,
    transactionDate: optionalDate,
    valueDate: optionalDate,
  }).optional(),
  description: z.union([
    z.string().trim().max(2_000),
    z.object({
      description: z.string().trim().max(2_000).nullable().optional(),
      initialClean: z.string().trim().max(2_000).nullable().optional(),
    }),
  ]).nullable().optional(),
  id: boundedText,
  installments: z.object({
    number: z.coerce.number().int().positive().max(10_000).nullable().optional(),
    total: z.coerce.number().int().positive().max(10_000).nullable().optional(),
  }).nullable().optional(),
  isDuplicate: z.boolean().optional().default(false),
  merchantName: z.string().trim().max(120).nullable().optional(),
  originalAmount: transactionAmountSchema.nullable().optional(),
  providerId: boundedText,
  status: boundedText,
  transactionDate: optionalDate,
  type: boundedText,
  valueDate: optionalDate,
});

const pageSchema = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  nextPage: z.string().min(1).max(4_096).nullable().optional(),
});

const connectionListSchema = z.union([
  z.array(connectionSchema),
  pageSchema(connectionSchema),
]);
const accountPageSchema = pageSchema(accountSchema);
const transactionPageSchema = pageSchema(transactionSchema);
const refreshSchema = z.object({
  cost: z.coerce.number().int().nonnegative().optional().default(20),
  status: z.enum(["accepted", "already_running"]),
});
const providerErrorSchema = z.object({
  type: z.string().max(100).optional(),
});

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function sanitizeDisplayName(value: string | null | undefined): string {
  const normalized = value?.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return normalized === undefined || normalized.length === 0
    ? "חשבון בנקאי"
    : normalized.slice(0, 120);
}

function classifyProviderError(
  status: number,
  body: unknown,
): Readonly<{ category: OpenBankingProviderErrorCategory; retryable: boolean }> {
  const type = providerErrorSchema.safeParse(body).success
    ? providerErrorSchema.parse(body).type
    : undefined;
  if (status === 401) return { category: "authentication", retryable: false };
  if (status === 402) return { category: "credits", retryable: false };
  if (status === 404) return { category: "not_found", retryable: false };
  if (status === 409 || status === 403) return { category: "consent", retryable: false };
  if (status === 423) return { category: "locked", retryable: true };
  if (status === 429) return { category: "rate_limited", retryable: true };
  if (status >= 500 || status === 503 || type === "PROVIDER_UNAVAILABLE") {
    return { category: "provider_unavailable", retryable: true };
  }
  return { category: "unknown", retryable: false };
}

function normalizeBalance(input: z.output<typeof balanceSchema>) {
  const amount = input.balanceAmount ?? (
    input.amount !== undefined && input.currency !== undefined
      ? { amount: input.amount, currency: input.currency }
      : null
  );
  if (amount === null) {
    throw new OpenBankingProviderError("schema", false, 200);
  }
  return {
    amount: parseMajorMoney(amount),
    creditLimitIncluded: input.creditLimitIncluded ?? null,
    referenceDate: input.referenceDate ?? null,
    type: input.balanceType ?? "unspecified",
  } as const;
}

function normalizeAccount(input: z.output<typeof accountSchema>): OpenBankingAccountObservation {
  return {
    identity: minimizeAccountIdentity(input),
    accountType: input.accountType,
    balances: input.balances.map(normalizeBalance),
    connectionExternalId: input.connectionId,
    currency: input.currency,
    displayName: safeAccountLabel(sanitizeDisplayName(input.accountName)),
    externalId: input.id,
    isDuplicate: input.isDuplicate,
    providerExternalId: input.providerId,
  };
}

function normalizeTransaction(input: z.output<typeof transactionSchema>): OpenBankingTransactionObservation {
  const chargedAmount = input.chargedAmount ?? input.amount?.chargedAmount;
  if (chargedAmount === undefined) throw new OpenBankingProviderError("schema", false, 200, "chargedAmount");
  const originalAmount = input.originalAmount ?? input.amount?.originalAmount;
  const description = typeof input.description === "string"
    ? input.description
    : input.description?.description ?? input.description?.initialClean ?? null;
  return {
    accountExternalId: input.accountId,
    amount: chargedAmount.amount === "" ? null : parseMajorMoney(chargedAmount),
    bookingDate: input.bookingDate ?? input.date?.bookingDate ?? null,
    categoryMain: input.category?.main ?? null,
    categorySub: input.category?.sub ?? null,
    changedCategoryMain: input.changedCategory?.main ?? null,
    changedCategorySub: input.changedCategory?.sub ?? null,
    connectionExternalId: input.connectionId,
    externalId: input.id,
    installmentNumber: input.installments?.number ?? null,
    installmentTotal: input.installments?.total ?? null,
    isDuplicate: input.isDuplicate,
    merchantName: sanitizeDisplayName(input.merchantName ?? description) === "חשבון בנקאי"
      ? null
      : sanitizeDisplayName(input.merchantName ?? description),
    originalAmount: originalAmount === null || originalAmount === undefined || originalAmount.amount === ""
      ? null
      : parseMajorMoney(originalAmount),
    providerExternalId: input.providerId,
    stableExternalKey: input.SK,
    status: input.status.toUpperCase(),
    transactionDate: input.transactionDate ?? input.date?.transactionDate ?? null,
    type: input.type,
    valueDate: input.valueDate ?? input.date?.valueDate ?? null,
  };
}

function schemaDiagnostic(error: z.ZodError): string {
  return [...new Set(error.issues.map((issue) => issue.path.join(".") || "root"))].slice(0, 8).join(",");
}

export class FinancyOpenBankingProvider implements OpenBankingProvider {
  private token: Readonly<{ accessToken: string; expiresAt: number }> | null = null;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = () => Date.now(),
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  private async acquireToken(force = false): Promise<string> {
    if (!force && this.token !== null && this.token.expiresAt - 60_000 > this.now()) {
      return this.token.accessToken;
    }
    const configuration = requireOpenFinanceEnv();
    let response: Response;
    try {
      response = await this.fetchImpl(AUTH_URL, {
        body: JSON.stringify({
          clientId: configuration.clientId,
          clientSecret: configuration.clientSecret,
          userId: configuration.userId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OpenBankingProviderError("provider_unavailable", true, null);
    }
    const body = await this.readBody(response);
    if (!response.ok) {
      const classified = classifyProviderError(response.status, body);
      throw new OpenBankingProviderError(classified.category, classified.retryable, response.status);
    }
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success || parsed.data.tokenType.toLowerCase() !== "bearer") {
      throw new OpenBankingProviderError("schema", false, response.status);
    }
    this.token = {
      accessToken: parsed.data.accessToken,
      expiresAt: this.now() + parsed.data.expiresIn * 1_000,
    };
    return parsed.data.accessToken;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new OpenBankingProviderError("schema", false, response.status);
    }
    if (text.length === 0) return null;
    try {
      return parseJsonPreservingNumbers(text);
    } catch {
      throw new OpenBankingProviderError("schema", false, response.status);
    }
  }

  private async request(path: string, init?: RequestInit, absolute = false): Promise<unknown> {
    // Without provider idempotency guarantees, retrying a timed-out/failed paid
    // mutation can consume credits twice. Only read requests may auto-retry.
    const canRetry = (init?.method ?? "GET").toUpperCase() === "GET";
    let renewed = false;
    let transientRetries = 0;
    while (true) {
      const token = await this.acquireToken(renewed);
      let response: Response;
      try {
        response = await this.fetchImpl(absolute ? path : `${API_BASE_URL}${path}`, {
          ...init,
          headers: { ...init?.headers, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        if (canRetry && transientRetries < 2) {
          await this.delay(100 * (2 ** transientRetries));
          transientRetries += 1;
          continue;
        }
        throw new OpenBankingProviderError("provider_unavailable", true, null);
      }
      const body = await this.readBody(response);
      if (response.ok) return body;
      if (canRetry && response.status === 401 && !renewed) {
        this.token = null;
        renewed = true;
        continue;
      }
      const classified = classifyProviderError(response.status, body);
      if (canRetry && classified.retryable && transientRetries < 2) {
        await this.delay(100 * (2 ** transientRetries));
        transientRetries += 1;
        continue;
      }
      throw new OpenBankingProviderError(classified.category, classified.retryable, response.status);
    }
  }

  async listConnections(): Promise<readonly OpenBankingConnectionObservation[]> {
    const parsed = connectionListSchema.safeParse(await this.request("/connections"));
    if (!parsed.success) throw new OpenBankingProviderError("schema", false, 200, schemaDiagnostic(parsed.error));
    const items = Array.isArray(parsed.data) ? parsed.data : parsed.data.items;
    return items.map((item) => ({
      expiryDate: item.expiryDate ?? null,
      externalId: item.id,
      lastFetchedAt: item.lastFetchedAt ?? null,
      lastFetchedDataDate: item.lastFetchedDataDate ?? null,
      mode: item.mode ?? null,
      providerExternalId: item.providerId,
      status: item.status.toUpperCase(),
      subjectExternalId: item.userId ?? null,
    }));
  }

  async listAccountsPage(cursor?: string): Promise<OpenBankingPage<OpenBankingAccountObservation>> {
    const query = new URLSearchParams({ includeDuplicates: "0", limit: String(OPEN_BANKING_PAGE_LIMIT), sort: "1" });
    if (cursor !== undefined) query.set("nextPage", cursor);
    const parsed = accountPageSchema.safeParse(await this.request(`/data/accounts?${query.toString()}`));
    if (!parsed.success) throw new OpenBankingProviderError("schema", false, 200, schemaDiagnostic(parsed.error));
    return { items: parsed.data.items.map(normalizeAccount), nextCursor: parsed.data.nextPage ?? null };
  }

  async listTransactionsPage(cursor?: string): Promise<OpenBankingPage<OpenBankingTransactionObservation>> {
    const query = new URLSearchParams({ includeDuplicates: "0", limit: String(OPEN_BANKING_PAGE_LIMIT), sort: "1" });
    if (cursor !== undefined) query.set("nextPage", cursor);
    const parsed = transactionPageSchema.safeParse(await this.request(`/data/transactions?${query.toString()}`));
    if (!parsed.success) throw new OpenBankingProviderError("schema", false, 200, schemaDiagnostic(parsed.error));
    return { items: parsed.data.items.map(normalizeTransaction), nextCursor: parsed.data.nextPage ?? null };
  }

  async refreshConnections(): Promise<OpenBankingRefreshResult> {
    const parsed = refreshSchema.safeParse(await this.request(REFRESH_URL, { method: "POST" }, true));
    if (!parsed.success) throw new OpenBankingProviderError("schema", false, 200, schemaDiagnostic(parsed.error));
    return { costCredits: parsed.data.cost, status: parsed.data.status };
  }

  async deleteConnection(externalConnectionId: string): Promise<void> {
    await this.request(`/connections/${encodeURIComponent(externalConnectionId)}`, { method: "DELETE" });
  }
}

let processProvider: FinancyOpenBankingProvider | undefined;

export function getFinancyOpenBankingProvider(): FinancyOpenBankingProvider {
  processProvider ??= new FinancyOpenBankingProvider();
  return processProvider;
}
