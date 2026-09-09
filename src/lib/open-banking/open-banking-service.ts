import "server-only";
import { assertCapabilityEnabled } from "@/lib/operations/controls";

import { createHash, createHmac } from "node:crypto";

import { getFinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import type { Actor } from "@/lib/auth/actor";
import {
  getConfigurationStatus,
  getServerEnv,
  requireOpenFinanceEnv,
} from "@/lib/config/server-env";
import { calendarDateAtInstant } from "@/lib/domain/financial-engine/financial-calendar";
import { money } from "@/lib/domain/money/money";
import {
  ConfigurationError,
  DependencyUnavailableError,
  InputValidationError,
  NotFoundError,
} from "@/lib/errors/application-error";
import type { ManualFields } from "@/lib/onboarding/manual-record";
import {
  OPEN_BANKING_MAX_PAGES,
  OPEN_BANKING_NORMALIZATION_VERSION,
  OPEN_BANKING_POLICY_VERSION,
  OPEN_BANKING_PROVIDER,
  type OpenBankingCenterView,
  type OpenBankingSyncRunView,
} from "@/lib/open-banking/open-banking";
import {
  getOpenBankingRepository,
  type OpenBankingRepository,
} from "@/lib/open-banking/open-banking-repository";
import {
  OpenBankingProviderError,
  type OpenBankingAccountObservation,
  type OpenBankingConnectionObservation,
  type OpenBankingProvider,
  type OpenBankingTransactionObservation,
} from "@/lib/open-banking/open-banking-provider";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

type SyncCounts = {
  accountObservationCount: number;
  canonicalAccountCount: number;
  canonicalTransactionCount: number;
  connectionObservationCount: number;
  transactionObservationCount: number;
};

export type OpenBankingDependencies = Readonly<{
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  provider?: OpenBankingProvider;
  repository?: OpenBankingRepository;
}>;

function stable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function alias(kind: string, externalId: string): string {
  const key = getServerEnv().AUTH_SECRET;
  if (key === undefined) throw new ConfigurationError("Authentication is not configured.");
  return createHmac("sha256", key).update(`${OPEN_BANKING_PROVIDER}:${kind}:${externalId}`, "utf8").digest("hex");
}

function subjectAlias(): string {
  return alias("subject", requireOpenFinanceEnv().userId);
}

function safeText(value: string | null, maximum = 120): string | null {
  if (value === null) return null;
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\d{5,}/g, "••••")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}

function category(
  input: OpenBankingTransactionObservation,
  type: "expense" | "income",
): Extract<ManualFields, Readonly<{ category: string }>>["category"] {
  const normalized = `${input.changedCategoryMain ?? input.categoryMain ?? ""} ${input.changedCategorySub ?? input.categorySub ?? ""}`.toLowerCase();
  if (type === "income") {
    if (/salary|wage|payroll|משכורת|שכר/.test(normalized)) return "salary";
    if (/benefit|allowance|קצבה|מענק/.test(normalized)) return "benefits";
    return "other";
  }
  const rules: readonly [RegExp, Extract<ManualFields, Readonly<{ category: string }>>["category"]][] = [
    [/rent|mortgage|housing|דיור|שכירות|משכנת/, "housing"],
    [/utilit|electric|water|gas|חשמל|מים/, "utilities"],
    [/insurance|ביטוח/, "insurance"],
    [/phone|internet|communication|תקשורת/, "communications"],
    [/child|school|ילד|חינוך/, "children"],
    [/subscription|מינוי/, "subscriptions"],
    [/transport|fuel|vehicle|car|תחבורה|דלק|רכב/, "transport"],
    [/grocery|food|supermarket|מזון|סופר/, "food"],
    [/loan|debt|credit payment|הלווא|חוב/, "debt_payment"],
    [/saving|deposit|חיסכון/, "savings"],
    [/entertainment|leisure|בילוי/, "entertainment"],
    [/restaurant|cafe|מסעד|בית קפה/, "restaurants"],
    [/shop|retail|קני|חנות/, "shopping"],
    [/transfer|העברה/, "transfer"],
  ];
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? "other";
}

function selectedBalance(account: OpenBankingAccountObservation) {
  const ranks: Readonly<Record<OpenBankingAccountObservation["accountType"], readonly string[]>> = {
    CARD: ["interimBooked", "closingBooked", "interimAvailable", "expected"],
    CHECKING: ["interimAvailable", "interimBooked", "closingBooked", "expected"],
    LOAN: ["closingBooked", "interimBooked", "expected"],
    SAVINGS: ["closingBooked", "expected", "interimAvailable", "interimBooked"],
    SECURITY: ["closingBooked", "interimBooked", "expected"],
  };
  const eligible = account.balances.filter((balance) =>
    balance.amount.currency === account.currency && balance.creditLimitIncluded !== true,
  );
  for (const type of ranks[account.accountType]) {
    const found = eligible.find((balance) => balance.type === type);
    if (found !== undefined) return found.amount;
  }
  return eligible[0]?.amount ?? null;
}

function canonicalAccountFields(
  account: OpenBankingAccountObservation,
  primaryCurrency: string,
): ManualFields | null {
  if (account.isDuplicate || account.currency !== primaryCurrency || account.accountType === "SECURITY") return null;
  const balance = selectedBalance(account);
  if (balance === null) return null;
  const type = {
    CARD: "credit_card",
    CHECKING: "bank",
    LOAN: "loan",
    SAVINGS: "savings",
  }[account.accountType] as "bank" | "credit_card" | "loan" | "savings";
  return {
    balance,
    name: safeText(account.displayName) ?? "חשבון בנקאי",
    type,
  } as ManualFields;
}

function canonicalTransactionFields(
  transaction: OpenBankingTransactionObservation,
  primaryCurrency: string,
  canonicalAccountId: string | null,
): ManualFields | null {
  const date = transaction.bookingDate ?? transaction.valueDate ?? transaction.transactionDate;
  if (
    transaction.status !== "BOOKED" || transaction.isDuplicate ||
    transaction.amount === null || transaction.amount.currency !== primaryCurrency ||
    transaction.amount.amountMinor === 0n || canonicalAccountId === null || date === null
  ) return null;
  const type = transaction.amount.amountMinor < 0n ? "expense" : "income";
  return {
    accountId: canonicalAccountId,
    amount: money(transaction.amount.amountMinor < 0n ? -transaction.amount.amountMinor : transaction.amount.amountMinor, transaction.amount.currency),
    category: category(transaction, type),
    confidenceBps: 10_000,
    date,
    destinationAccountId: null,
    merchant: safeText(transaction.merchantName),
    notes: null,
    recurring: false,
    refundOfTransactionId: null,
    type,
  } as ManualFields;
}

function providerFailure(error: unknown): DependencyUnavailableError {
  const category = error instanceof OpenBankingProviderError ? error.category : "internal";
  return new DependencyUnavailableError(`Open Banking is temporarily unavailable (${category}).`);
}

async function dependencies(input?: OpenBankingDependencies) {
  return {
    now: input?.now ?? (() => new Date()),
    profileRepository: input?.profileRepository,
    provider: input?.provider ?? getFinancyOpenBankingProvider(),
    repository: input?.repository ?? await getOpenBankingRepository(),
  };
}

function assertSubjectScope(connections: readonly OpenBankingConnectionObservation[]): void {
  const configuredUserId = requireOpenFinanceEnv().userId;
  if (connections.some((connection) => connection.subjectExternalId !== configuredUserId)) {
    throw new DependencyUnavailableError("The provider returned an unexpected user scope.");
  }
}

export async function claimConfiguredOpenBankingSubject(
  actor: Actor,
  dependenciesInput?: OpenBankingDependencies,
): Promise<void> {
  const resolved = await dependencies(dependenciesInput);
  try {
    const connections = await resolved.provider.listConnections();
    assertSubjectScope(connections);
  } catch (error) {
    if (error instanceof DependencyUnavailableError) throw error;
    throw providerFailure(error);
  }
  await resolved.repository.claimBinding(actor, subjectAlias());
}

export async function synchronizeOpenBanking(
  actor: Actor,
  idempotencyKey: string,
  dependenciesInput?: OpenBankingDependencies,
): Promise<OpenBankingSyncRunView> {
  const resolved = await dependencies(dependenciesInput);
  const profile = await loadProfile(actor, resolved.profileRepository === undefined ? undefined : { repository: resolved.profileRepository });
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required before bank synchronization." }]);
  await resolved.repository.assertBinding(actor, subjectAlias());
  let connections: readonly OpenBankingConnectionObservation[];
  try {
    connections = await resolved.provider.listConnections();
    assertSubjectScope(connections);
  } catch (error) {
    throw providerFailure(error);
  }
  // No run, observation, or canonical write may occur before this safety gate.
  // Retired development aliases are exact owner-approved historical targets;
  // this never exempts a new reconnect from the normal continuity safety gate.
  const retiredAliases = await resolved.repository.retiredDevelopmentConnectionAliases(actor);
  connections = connections.filter((connection) => !retiredAliases.has(alias("connection", connection.externalId)));
  await resolved.repository.assertConnectionContinuity(actor, connections.map((connection) => ({
    connectionAlias: alias("connection", connection.externalId),
    providerAlias: alias("institution", connection.providerExternalId),
    status: connection.status,
  })));
  const start = await resolved.repository.startSync(actor, idempotencyKey);
  if (start.alreadyCompleted) return start.run;
  const counts: SyncCounts = {
    accountObservationCount: 0,
    canonicalAccountCount: 0,
    canonicalTransactionCount: 0,
    connectionObservationCount: 0,
    transactionObservationCount: 0,
  };
  const connectionCounts = new Map<string, { accounts: number; transactions: number }>();
  const accountIds = new Map<string, string | null>();
  const scopedConnections = new Map(connections.map((connection) => [connection.externalId, connection.providerExternalId]));
  const scopedAccounts = new Map<string, { connection: string; provider: string }>();
  try {
    for (const connection of connections) {
      const connectionAlias = alias("connection", connection.externalId);
      const providerAlias = alias("institution", connection.providerExternalId);
      await resolved.repository.observeConnection(actor, connection, { connection: connectionAlias, provider: providerAlias }, fingerprint({
        connectionAlias,
        expiryDate: connection.expiryDate,
        lastFetchedAt: connection.lastFetchedAt,
        lastFetchedDataDate: connection.lastFetchedDataDate,
        mode: connection.mode,
        providerAlias,
        status: connection.status,
      }));
      connectionCounts.set(connectionAlias, { accounts: 0, transactions: 0 });
      counts.connectionObservationCount += 1;
    }

    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < OPEN_BANKING_MAX_PAGES; pageNumber += 1) {
      const page = await resolved.provider.listAccountsPage(cursor);
      for (const account of page.items) {
        if (retiredAliases.has(alias("connection", account.connectionExternalId))) continue;
        if (scopedConnections.get(account.connectionExternalId) !== account.providerExternalId) {
          throw new OpenBankingProviderError("schema", false, 200);
        }
        scopedAccounts.set(account.externalId, { connection: account.connectionExternalId, provider: account.providerExternalId });
        const accountAlias = alias("account", account.externalId);
        const connectionAlias = alias("connection", account.connectionExternalId);
        const normalizedFingerprint = fingerprint({
          accountAlias,
          accountType: account.accountType,
          balances: account.balances,
          connectionAlias,
          currency: account.currency,
          displayName: safeText(account.displayName),
          isDuplicate: account.isDuplicate,
          normalizationVersion: OPEN_BANKING_NORMALIZATION_VERSION,
          identity: account.identity ?? null,
        });
        const observed = await resolved.repository.observeAccount(
          actor,
          { ...account, displayName: safeText(account.displayName) ?? "חשבון בנקאי" },
          { account: accountAlias, connection: connectionAlias },
          normalizedFingerprint,
          canonicalAccountFields(account, profile.fields.primaryCurrency),
        );
        accountIds.set(accountAlias, observed.canonicalId);
        counts.accountObservationCount += 1;
        if (observed.canonicalChanged) counts.canonicalAccountCount += 1;
        const current = connectionCounts.get(connectionAlias) ?? { accounts: 0, transactions: 0 };
        current.accounts += 1;
        connectionCounts.set(connectionAlias, current);
      }
      if (page.nextCursor === null) { cursor = undefined; break; }
      cursor = page.nextCursor;
      if (pageNumber === OPEN_BANKING_MAX_PAGES - 1) throw new OpenBankingProviderError("schema", false, 200);
    }

    cursor = undefined;
    for (let pageNumber = 0; pageNumber < OPEN_BANKING_MAX_PAGES; pageNumber += 1) {
      const page = await resolved.provider.listTransactionsPage(cursor);
      for (const transaction of page.items) {
        if (retiredAliases.has(alias("connection", transaction.connectionExternalId))) continue;
        const parentScope = scopedAccounts.get(transaction.accountExternalId);
        if (parentScope?.connection !== transaction.connectionExternalId || parentScope.provider !== transaction.providerExternalId) {
          throw new OpenBankingProviderError("schema", false, 200);
        }
        const transactionAlias = alias("transaction", transaction.stableExternalKey);
        const accountAlias = alias("account", transaction.accountExternalId);
        const connectionAlias = alias("connection", transaction.connectionExternalId);
        const normalizedFingerprint = fingerprint({
          accountAlias,
          amount: transaction.amount,
          bookingDate: transaction.bookingDate,
          categoryMain: transaction.categoryMain,
          categorySub: transaction.categorySub,
          changedCategoryMain: transaction.changedCategoryMain,
          changedCategorySub: transaction.changedCategorySub,
          connectionAlias,
          installmentNumber: transaction.installmentNumber,
          installmentTotal: transaction.installmentTotal,
          isDuplicate: transaction.isDuplicate,
          merchantName: safeText(transaction.merchantName),
          normalizationVersion: OPEN_BANKING_NORMALIZATION_VERSION,
          originalAmount: transaction.originalAmount,
          status: transaction.status,
          transactionAlias,
          transactionDate: transaction.transactionDate,
          type: transaction.type,
          valueDate: transaction.valueDate,
        });
        const observed = await resolved.repository.observeTransaction(
          actor,
          { ...transaction, merchantName: safeText(transaction.merchantName) },
          { account: accountAlias, connection: connectionAlias, transaction: transactionAlias },
          normalizedFingerprint,
          canonicalTransactionFields(transaction, profile.fields.primaryCurrency, accountIds.get(accountAlias) ?? null),
        );
        counts.transactionObservationCount += 1;
        if (observed.canonicalChanged) counts.canonicalTransactionCount += 1;
        const current = connectionCounts.get(connectionAlias) ?? { accounts: 0, transactions: 0 };
        current.transactions += 1;
        connectionCounts.set(connectionAlias, current);
      }
      if (page.nextCursor === null) { cursor = undefined; break; }
      cursor = page.nextCursor;
      if (pageNumber === OPEN_BANKING_MAX_PAGES - 1) throw new OpenBankingProviderError("schema", false, 200);
    }
    await resolved.repository.updateConnectionCounts(actor, connectionCounts);
    return await resolved.repository.completeSync(actor, start.run.id, counts);
  } catch (error) {
    const category = error instanceof OpenBankingProviderError ? error.category : "internal";
    await resolved.repository.failSync(actor, start.run.id, counts, category);
    throw providerFailure(error);
  }
}

export async function loadOpenBankingCenter(
  actor: Actor,
  dependenciesInput?: OpenBankingDependencies,
): Promise<OpenBankingCenterView> {
  if (!getConfigurationStatus().futureAdapters.openBankingConfigured) {
    return {
      accounts: [], bindingClaimed: false, configured: false, connections: [], latestRun: null,
      policyVersion: OPEN_BANKING_POLICY_VERSION, provider: OPEN_BANKING_PROVIDER,
    };
  }
  const resolved = await dependencies(dependenciesInput);
  const profile = await loadProfile(actor, resolved.profileRepository === undefined ? undefined : { repository: resolved.profileRepository });
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required." }]);
  const today = calendarDateAtInstant(resolved.now().toISOString(), profile.fields.timeZone);
  return resolved.repository.loadCenter(actor, subjectAlias(), today);
}

export async function requestOpenBankingRefresh(
  actor: Actor,
  idempotencyKey: string,
  dependenciesInput?: OpenBankingDependencies,
): Promise<Readonly<{ costCredits: number; status: string }>> {
  assertCapabilityEnabled("bankRefresh");
  const resolved = await dependencies(dependenciesInput);
  await resolved.repository.assertBinding(actor, subjectAlias());
  const lifecycle = await resolved.repository.startLifecycle(actor, "refresh", idempotencyKey);
  if (lifecycle.completed) return { costCredits: 20, status: lifecycle.resultStatus ?? "accepted" };
  try {
    const result = await resolved.provider.refreshConnections();
    await resolved.repository.recordRefresh(actor);
    await resolved.repository.finishLifecycle(actor, lifecycle.id, "completed", result.status);
    return result;
  } catch (error) {
    await resolved.repository.finishLifecycle(actor, lifecycle.id, "failed", error instanceof OpenBankingProviderError ? error.category : "internal");
    throw providerFailure(error);
  }
}

export async function disconnectOpenBankingConnection(
  actor: Actor,
  connectionId: string,
  expectedVersion: number,
  idempotencyKey: string,
  dependenciesInput?: OpenBankingDependencies,
): Promise<void> {
  const resolved = await dependencies(dependenciesInput);
  await resolved.repository.assertBinding(actor, subjectAlias());
  const connection = await resolved.repository.connectionById(actor, connectionId);
  if (connection === null) throw new NotFoundError();
  const lifecycle = await resolved.repository.startLifecycle(actor, "disconnect", idempotencyKey);
  if (lifecycle.completed) return;
  try {
    const providerConnections = await resolved.provider.listConnections();
    assertSubjectScope(providerConnections);
    const external = providerConnections.find((candidate) => alias("connection", candidate.externalId) === connection.connectionAlias);
    if (external !== undefined) await resolved.provider.deleteConnection(external.externalId);
    await resolved.repository.markDisconnected(actor, connectionId, expectedVersion);
    await resolved.repository.finishLifecycle(actor, lifecycle.id, "completed", "disconnected");
  } catch (error) {
    await resolved.repository.finishLifecycle(actor, lifecycle.id, "failed", error instanceof OpenBankingProviderError ? error.category : "internal");
    throw providerFailure(error);
  }
}
