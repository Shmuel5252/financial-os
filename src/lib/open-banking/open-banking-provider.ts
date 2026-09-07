import type { Money } from "@/lib/domain/money/money";
import type { SafeAccountIdentity } from "@/lib/open-banking/account-identity";

export type OpenBankingConnectionObservation = Readonly<{
  expiryDate: string | null;
  externalId: string;
  lastFetchedAt: string | null;
  lastFetchedDataDate: string | null;
  mode: string | null;
  providerExternalId: string;
  status: string;
  subjectExternalId: string | null;
}>;

export type OpenBankingBalanceObservation = Readonly<{
  amount: Money;
  creditLimitIncluded: boolean | null;
  referenceDate: string | null;
  type: string;
}>;

export type OpenBankingAccountObservation = Readonly<{
  identity?: SafeAccountIdentity;
  accountType: "CARD" | "CHECKING" | "LOAN" | "SAVINGS" | "SECURITY";
  balances: readonly OpenBankingBalanceObservation[];
  connectionExternalId: string;
  currency: string;
  displayName: string;
  externalId: string;
  isDuplicate: boolean;
  providerExternalId: string;
}>;

export type OpenBankingTransactionObservation = Readonly<{
  accountExternalId: string;
  amount: Money | null;
  bookingDate: string | null;
  categoryMain: string | null;
  categorySub: string | null;
  changedCategoryMain: string | null;
  changedCategorySub: string | null;
  connectionExternalId: string;
  externalId: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  isDuplicate: boolean;
  merchantName: string | null;
  originalAmount: Money | null;
  providerExternalId: string;
  stableExternalKey: string;
  status: string;
  transactionDate: string | null;
  type: string;
  valueDate: string | null;
}>;

export type OpenBankingPage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
}>;

export type OpenBankingRefreshResult = Readonly<{
  costCredits: number;
  status: "accepted" | "already_running";
}>;

export type OpenBankingProviderErrorCategory =
  | "authentication"
  | "consent"
  | "credits"
  | "locked"
  | "not_found"
  | "provider_unavailable"
  | "rate_limited"
  | "schema"
  | "unknown";

export class OpenBankingProviderError extends Error {
  constructor(
    readonly category: OpenBankingProviderErrorCategory,
    readonly retryable: boolean,
    readonly statusCode: number | null,
    readonly safeDiagnostic: string | null = null,
  ) {
    super("The Open Banking provider request failed.");
    this.name = "OpenBankingProviderError";
  }
}

export interface OpenBankingProvider {
  deleteConnection(externalConnectionId: string): Promise<void>;
  listAccountsPage(cursor?: string): Promise<OpenBankingPage<OpenBankingAccountObservation>>;
  listConnections(): Promise<readonly OpenBankingConnectionObservation[]>;
  listTransactionsPage(cursor?: string): Promise<OpenBankingPage<OpenBankingTransactionObservation>>;
  refreshConnections(): Promise<OpenBankingRefreshResult>;
}
