import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { requireOpenFinanceEnv } from "@/lib/config/server-env";
import { ConflictError, DependencyUnavailableError, NotFoundError } from "@/lib/errors/application-error";
import { getFinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import { bankAlias, safeAccountLabel } from "@/lib/open-banking/account-identity";
import {
  ACCOUNT_RECONCILIATION_POLICY, type AccountReconciliationCommand, type AccountReconciliationRow,
  type AccountReconciliationView, type ReconciliationComparison,
} from "@/lib/open-banking/account-reconciliation";
import {
  getAccountReconciliationRepository, type AccountIdentityReference, type AccountReconciliationRepository,
} from "@/lib/open-banking/account-reconciliation-repository";
import { getOpenBankingRepository, type OpenBankingRepository } from "@/lib/open-banking/open-banking-repository";
import { OPEN_BANKING_MAX_PAGES } from "@/lib/open-banking/open-banking";
import type { OpenBankingAccountObservation, OpenBankingProvider } from "@/lib/open-banking/open-banking-provider";

export type AccountReconciliationDependencies = Readonly<{
  repository: AccountReconciliationRepository;
  bankingRepository: OpenBankingRepository;
  provider: OpenBankingProvider;
}>;

async function dependencies(input?: AccountReconciliationDependencies): Promise<AccountReconciliationDependencies> {
  return input ?? { repository: await getAccountReconciliationRepository(), bankingRepository: await getOpenBankingRepository(), provider: getFinancyOpenBankingProvider() };
}
const readable = new Set(["CONNECTED", "ACTIVE", "COMPLETED"]);
const ended = new Set(["DISCONNECTED", "TERMINATED_BY_USER", "REVOKED", "REPLACED", "EXPIRED", "TERMINATED_BY_ASPSP", "TERMINATED_BY_TPP"]);

async function reviewState(actor: Actor, resolved: AccountReconciliationDependencies) {
  await resolved.bankingRepository.assertBinding(actor, bankAlias("subject", requireOpenFinanceEnv().userId));
  const [legacyAccounts, ledgers] = await Promise.all([
    resolved.repository.listLegacyAccounts(actor), resolved.repository.listLedgers(actor),
  ]);
  if (ledgers.length > 500) throw new ConflictError("Account review requires a bounded scope.");
  let connections;
  const accounts: OpenBankingAccountObservation[] = [];
  try {
    connections = await resolved.provider.listConnections();
    if (connections.some((connection) => connection.subjectExternalId !== requireOpenFinanceEnv().userId)) {
      throw new DependencyUnavailableError("Provider subject verification failed.");
    }
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < OPEN_BANKING_MAX_PAGES; pageNumber++) {
      const page = await resolved.provider.listAccountsPage(cursor);
      for (const account of page.items) {
        const connection = connections.find((item) => item.externalId === account.connectionExternalId);
        if (connection === undefined || connection.providerExternalId !== account.providerExternalId) throw new DependencyUnavailableError();
        if (readable.has(connection.status) && !account.isDuplicate) accounts.push(account);
      }
      if (accounts.length > 500) throw new DependencyUnavailableError();
      if (page.nextCursor === null) { cursor = undefined; break; }
      if (seen.has(page.nextCursor)) throw new DependencyUnavailableError();
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
    if (cursor !== undefined) throw new DependencyUnavailableError();
  } catch {
    throw new DependencyUnavailableError("Live account comparison is unavailable. No financial data was changed.");
  }
  const live = connections.map((connection) => ({
    alias: bankAlias("connection", connection.externalId), institutionAlias: bankAlias("institution", connection.providerExternalId),
    institution: safeAccountLabel(connection.providerExternalId), status: connection.status,
  }));
  const newAccounts = accounts.map((account): AccountIdentityReference => ({
    accountAlias: bankAlias("account", account.externalId), connectionAlias: bankAlias("connection", account.connectionExternalId),
    institutionAlias: bankAlias("institution", account.providerExternalId), identity: account.identity ?? null,
    comparison: { institution: safeAccountLabel(account.providerExternalId), name: safeAccountLabel(account.displayName),
      type: account.accountType, currency: account.currency, maskedNumber: account.identity?.maskedNumber ?? null,
      bankCode: account.identity?.bankCode ?? null, branchCode: account.identity?.branchCode ?? null },
  }));
  if (new Set(newAccounts.map((item) => item.accountAlias)).size !== newAccounts.length) throw new ConflictError("Duplicate provider identities require review.");
  const rows = [];
  for (const legacy of legacyAccounts) {
    const ledger = ledgers.find((item) => item.canonicalAccountId.toHexString() === legacy.id);
    const institution = live.find((item) => item.institutionAlias === legacy.institutionAlias)?.institution ?? "מוסד היסטורי";
    const legacyComparison: ReconciliationComparison = {
      institution, name: safeAccountLabel(legacy.name), type: legacy.type, currency: legacy.currency,
      maskedNumber: legacy.identity?.maskedNumber ?? null, bankCode: legacy.identity?.bankCode ?? null, branchCode: legacy.identity?.branchCode ?? null,
    };
    const oldIdentity: AccountIdentityReference = ledger?.active ?? {
      accountAlias: legacy.accountAlias, connectionAlias: legacy.connectionAlias,
      institutionAlias: legacy.institutionAlias, identity: legacy.identity, comparison: legacyComparison,
    };
    const previousStatus = live.find((item) => item.alias === oldIdentity.connectionAlias)?.status ?? legacy.institutionStatus;
    const confirmed = ledger?.active !== null && ledger?.active !== undefined && readable.has(previousStatus);
    if (!confirmed && (!ended.has(previousStatus) || !live.some((item) => readable.has(item.status) &&
      item.institutionAlias === oldIdentity.institutionAlias && item.alias !== oldIdentity.connectionAlias))) continue;
    const candidates = confirmed ? [] : newAccounts.filter((account) => {
      if (account.connectionAlias === oldIdentity.connectionAlias || account.institutionAlias !== oldIdentity.institutionAlias ||
        account.comparison.type !== oldIdentity.comparison.type || account.comparison.currency !== oldIdentity.comparison.currency) return false;
      if (oldIdentity.identity?.referenceDigest && account.identity?.referenceDigest &&
        oldIdentity.identity.referenceDigest !== account.identity.referenceDigest) return false;
      return !ledgers.some((other) => other.canonicalAccountId.toHexString() !== legacy.id && other.aliases.includes(account.accountAlias));
    }).sort((left, right) => left.accountAlias.localeCompare(right.accountAlias));
    const key = bankAlias("account-review-row", `${actor.userId}:${legacy.id}`);
    const reviewToken = bankAlias("account-review-view", JSON.stringify({
      actor: actor.userId, key, canonicalVersion: legacy.version, ledgerVersion: ledger?.version ?? 0,
      oldIdentity, candidates, policy: ACCOUNT_RECONCILIATION_POLICY,
    }));
    const last = ledger?.events.at(-1);
    const view: AccountReconciliationRow = {
      key, legacy: oldIdentity.comparison, reviewToken,
      candidates: candidates.map((item) => ({ key: item.accountAlias, comparison: item.comparison,
        previouslyRejected: ledger?.events.some((event) => event.decision === "not_same" && event.newIdentity?.accountAlias === item.accountAlias) ?? false })),
      status: confirmed ? "confirmed" : last?.decision === "not_same" ? "not_same" : last?.decision === "cannot_determine" ? "cannot_determine" : "unresolved",
      confirmedAccount: confirmed ? ledger?.active?.comparison ?? null : null,
      lastDecisionAt: last?.at.toISOString() ?? null,
    };
    rows.push({ legacy, ledger, oldIdentity, candidates, view });
  }
  return rows;
}

export async function loadAccountReconciliation(actor: Actor, input?: AccountReconciliationDependencies): Promise<AccountReconciliationView> {
  const rows = await reviewState(actor, await dependencies(input));
  return { rows: rows.map((item) => item.view), policyVersion: ACCOUNT_RECONCILIATION_POLICY, transactionGate: rows.length === 0 ? "not_required" : "pending" };
}

export async function decideAccountReconciliation(actor: Actor, command: AccountReconciliationCommand, input?: AccountReconciliationDependencies) {
  const resolved = await dependencies(input);
  await resolved.bankingRepository.assertBinding(actor, bankAlias("subject", requireOpenFinanceEnv().userId));
  if (await resolved.repository.isRecordedRequest(actor, command)) return;
  const rows = await reviewState(actor, resolved);
  const row = rows.find((item) => item.view.key === command.legacyKey);
  if (row === undefined) throw new NotFoundError();
  if (row.view.status === "confirmed" || row.view.reviewToken !== command.reviewToken) throw new ConflictError();
  const candidate = command.candidateKey === null ? null : row.candidates.find((item) => item.accountAlias === command.candidateKey);
  if (candidate === undefined || (candidate === null && command.decision !== "cannot_determine")) throw new ConflictError();
  await resolved.repository.recordDecision(actor, {
    legacy: row.legacy, expectedVersion: row.ledger?.version ?? 0, oldIdentity: row.oldIdentity,
    newIdentity: candidate, command,
  });
  // No sync/transaction read/mutation here. Account attestation is not financial
  // import approval; the existing continuity guard remains until transaction acceptance.
}
