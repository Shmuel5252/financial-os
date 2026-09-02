import "server-only";

import { createHash } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import { budgetCorrectionState, effectiveTransactionCategory } from "@/lib/budgets/category-projection";
import { getBudgetRepository } from "@/lib/budgets/budget-repository";
import { calculateFinancialReport, type ReportBalanceInput, type ReportTransactionInput } from "@/lib/domain/reports/report-engine";
import { deserializeMoney, money } from "@/lib/domain/money/money";
import { ConflictError, InputValidationError, NotFoundError } from "@/lib/errors/application-error";
import { loadGoalCenterView } from "@/lib/goals/goal-service";
import { loadHouseholdCenter } from "@/lib/households/household-service";
import { loadNetWorthCenter } from "@/lib/net-worth/net-worth-service";
import { manualSectionDomainSchemas, type ManualRecord } from "@/lib/onboarding/manual-record";
import { getManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { loadProfile } from "@/lib/profiles/profile-service";
import {
  REPORT_MAX_SOURCE_RECORDS,
  type FinancialReport,
  type ReportPeriod,
  type ReportScope,
  type SavedFinancialReport,
} from "@/lib/reports/report";
import { getFinancialReportRepository, type FinancialReportRepository } from "@/lib/reports/report-repository";
import { loadLatestTransactionIntelligence } from "@/lib/transaction-intelligence/transaction-intelligence-service";

type ReportServiceDependencies = Readonly<{
  loadHousehold?: typeof loadHouseholdCenter;
  now?: () => Date;
  repository?: FinancialReportRepository;
}>;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function householdReportAuthorizationFingerprint(center: Awaited<ReturnType<typeof loadHouseholdCenter>>): string {
  if (center.selected === null) throw new NotFoundError();
  return hash({
    household: { id: center.selected.id },
    accounts: center.sharedAccounts.map((item) => item.provenanceAlias).sort(),
    goals: center.sharedGoals.map((item) => item.provenanceAlias).sort(),
  });
}

function recordBalance(record: ManualRecord, section: "accounts" | "loans" | "savings"): ReportBalanceInput {
  if (section === "accounts") {
    const fields = manualSectionDomainSchemas.accounts.parse(record.fields);
    return { amount: fields.balance, id: record.id, label: fields.name, version: record.version };
  }
  if (section === "loans") {
    const fields = manualSectionDomainSchemas.loans.parse(record.fields);
    return { amount: fields.remainingBalance, id: record.id, label: fields.name, version: record.version };
  }
  const fields = manualSectionDomainSchemas.savings.parse(record.fields);
  return { amount: fields.balance, id: record.id, label: fields.name, version: record.version };
}

async function buildPersonalReport(actor: Actor, period: ReportPeriod, now: Date): Promise<FinancialReport> {
  const profile = await loadProfile(actor);
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required for reporting." }]);
  const [transactions, accounts, loans, savings, budgetRepository, goals, netWorth, intelligence] = await Promise.all([
    (await getManualRecordRepository("transactions")).listAllForActor(actor, REPORT_MAX_SOURCE_RECORDS),
    (await getManualRecordRepository("accounts")).listAllForActor(actor, REPORT_MAX_SOURCE_RECORDS),
    (await getManualRecordRepository("loans")).listAllForActor(actor, REPORT_MAX_SOURCE_RECORDS),
    (await getManualRecordRepository("savings")).listAllForActor(actor, REPORT_MAX_SOURCE_RECORDS),
    getBudgetRepository(), loadGoalCenterView(actor), loadNetWorthCenter(actor), loadLatestTransactionIntelligence(actor),
  ]);
  const [corrections, budgetPeriods] = await Promise.all([
    budgetRepository.listCorrectionsForActor(actor, transactions.map((record) => record.id)),
    budgetRepository.listPeriodsForActor(actor),
  ]);
  const recordMap = new Map(transactions.map((record) => [record.id, record]));
  const correctionMap = budgetCorrectionState(corrections);
  const transactionInputs: ReportTransactionInput[] = transactions.map((record) => {
    const fields = manualSectionDomainSchemas.transactions.parse(record.fields);
    return { amount: fields.amount, category: effectiveTransactionCategory(record, recordMap, correctionMap) ?? "uncategorized", date: fields.date, id: record.id, type: fields.type, version: record.version };
  });
  const months = budgetPeriods.filter((item) => period.kind === "month" ? item.calendarMonth === period.value : item.calendarMonth.startsWith(`${period.value}-`));
  const budget: ReportBalanceInput[] = months.flatMap((item) => {
    const amountMinor = item.allocations.reduce((sum, allocation) => sum + allocation.amount.amountMinor, 0n);
    return [{ amount: money(amountMinor, item.currency), id: item.id, label: item.calendarMonth, version: item.version }];
  });
  const goalInputs: ReportBalanceInput[] = goals.goals.map((goal) => ({
    amount: deserializeMoney(goal.latestProgress?.result.currentValue ?? goal.reported.currentValue),
    id: goal.reported.id, label: goal.reported.title, version: goal.definition?.version ?? goal.reported.version,
  }));
  const netWorthInputs: ReportBalanceInput[] = netWorth.current.totals.map((total, index) => ({
    amount: deserializeMoney(total.netWorth), id: `net-worth:${total.netWorth.currency}`, label: "net worth", version: index + 1,
  }));
  const subscriptions: ReportBalanceInput[] = (intelligence?.signals ?? []).filter((signal) =>
    (signal.kind === "subscription_candidate" || signal.kind === "subscription_increase") && signal.currentDecision !== "dismissed",
  ).map((signal) => ({ amount: deserializeMoney(signal.amount), id: signal.id, label: signal.normalizedMerchant ?? "subscription", version: 1 }));
  return calculateFinancialReport({
    accounts: accounts.map((record) => recordBalance(record, "accounts")), budget, generatedAt: now.toISOString(), goals: goalInputs,
    liabilities: loans.map((record) => recordBalance(record, "loans")), netWorth: netWorthInputs, period,
    savings: savings.map((record) => recordBalance(record, "savings")), scope: { kind: "personal" }, subscriptions,
    timeZone: profile.fields.timeZone, transactions: transactionInputs,
  });
}

async function buildHouseholdReport(actor: Actor, scope: Extract<ReportScope, { kind: "household" }>, period: ReportPeriod, now: Date): Promise<Readonly<{ authorizationFingerprint: string; report: FinancialReport }>> {
  const [profile, center] = await Promise.all([loadProfile(actor), loadHouseholdCenter(actor, scope.householdId)]);
  if (profile === null || center.selected === null) throw new NotFoundError();
  return {
    authorizationFingerprint: householdReportAuthorizationFingerprint(center),
    report: calculateFinancialReport({
      accounts: center.sharedAccounts.map((item, index) => ({ amount: deserializeMoney(item.balance), id: item.provenanceAlias, label: `${item.label} — ${item.ownerLabel}`, version: index + 1 })),
      budget: [], generatedAt: now.toISOString(),
      goals: center.sharedGoals.map((item, index) => ({ amount: deserializeMoney(item.currentValue ?? item.targetValue), id: item.provenanceAlias, label: `${item.label} — ${item.ownerLabel}`, version: index + 1 })),
      liabilities: [], netWorth: center.totals.map((item, index) => ({ amount: deserializeMoney(item.amount), id: `household-total:${item.amount.currency}`, label: "household shared total", version: index + 1 })),
      period, savings: [], scope, subscriptions: [], timeZone: profile.fields.timeZone, transactions: [],
    }),
  };
}

async function build(actor: Actor, scope: ReportScope, period: ReportPeriod, now: Date) {
  if (scope.kind === "personal") return { authorizationFingerprint: null, report: await buildPersonalReport(actor, period, now) };
  return buildHouseholdReport(actor, scope, period, now);
}

async function repository(dependencies?: ReportServiceDependencies) {
  return dependencies?.repository ?? await getFinancialReportRepository();
}

export async function generateCurrentReport(actor: Actor, scope: ReportScope, period: ReportPeriod, dependencies?: ReportServiceDependencies): Promise<FinancialReport> {
  return (await build(actor, scope, period, (dependencies?.now ?? (() => new Date()))())).report;
}

export async function assertSavedReportAuthorization(actor: Actor, saved: SavedFinancialReport, dependencies?: Pick<ReportServiceDependencies, "loadHousehold">): Promise<void> {
  if (saved.report.scope.kind !== "household") return;
  const center = await (dependencies?.loadHousehold ?? loadHouseholdCenter)(actor, saved.report.scope.householdId);
  if (saved.authorizationFingerprint !== householdReportAuthorizationFingerprint(center)) throw new NotFoundError();
}

export async function findSavedReport(actor: Actor, id: string, dependencies?: ReportServiceDependencies): Promise<SavedFinancialReport> {
  const saved = await (await repository(dependencies)).findForActor(actor, id);
  if (saved === null) throw new NotFoundError();
  await assertSavedReportAuthorization(actor, saved, dependencies);
  return saved;
}

export async function listSavedReports(actor: Actor, dependencies?: ReportServiceDependencies): Promise<readonly SavedFinancialReport[]> {
  const items = await (await repository(dependencies)).listForActor(actor);
  const visible: SavedFinancialReport[] = [];
  for (const item of items) {
    try { await assertSavedReportAuthorization(actor, item, dependencies); visible.push(item); } catch (error) { if (!(error instanceof NotFoundError)) throw error; }
  }
  return visible;
}

export async function closeOrRestateReport(actor: Actor, command: Readonly<{
  action: "close" | "restate"; idempotencyKey: string; period: ReportPeriod; reason?: string | undefined; scope: ReportScope; supersedesId?: string | undefined;
}>, dependencies?: ReportServiceDependencies): Promise<SavedFinancialReport> {
  const reportRepository = await repository(dependencies);
  const idempotencyPayload = { action: command.action, period: command.period, reason: command.reason ?? null, scope: command.scope, supersedesId: command.supersedesId ?? null };
  const idempotent = await reportRepository.findIdempotentForActor(actor, command.idempotencyKey, idempotencyPayload);
  if (idempotent !== null) { await assertSavedReportAuthorization(actor, idempotent, dependencies); return idempotent; }
  let supersedes: SavedFinancialReport | null = null;
  if (command.action === "restate") {
    supersedes = await findSavedReport(actor, command.supersedesId!, dependencies);
    if (JSON.stringify(supersedes.report.period) !== JSON.stringify(command.period) || JSON.stringify(supersedes.report.scope) !== JSON.stringify(command.scope)) throw new ConflictError("A restatement must preserve its period and scope.");
    const latest = (await reportRepository.listForActor(actor, 100)).filter((item) => item.rootReportId === supersedes!.rootReportId).sort((a, b) => b.reportVersion - a.reportVersion)[0];
    if (latest?.id !== supersedes.id) throw new ConflictError("Only the latest report version may be restated.");
  } else {
    const duplicate = (await reportRepository.listForActor(actor, 100)).find((item) => item.status === "closed" && JSON.stringify(item.report.period) === JSON.stringify(command.period) && JSON.stringify(item.report.scope) === JSON.stringify(command.scope));
    if (duplicate !== undefined) throw new ConflictError("This report period is already closed. Create an explicit restatement instead.");
  }
  const current = await build(actor, command.scope, command.period, (dependencies?.now ?? (() => new Date()))());
  return reportRepository.createForActor(actor, {
    authorizationFingerprint: current.authorizationFingerprint, idempotencyKey: command.idempotencyKey, idempotencyPayload, report: current.report,
    restatementReason: command.action === "restate" ? command.reason! : null, supersedes,
  });
}

export async function hideSavedReport(actor: Actor, id: string, expectedVersion: number, dependencies?: ReportServiceDependencies): Promise<void> {
  await findSavedReport(actor, id, dependencies);
  await (await repository(dependencies)).hideForActor(actor, id, expectedVersion);
}
