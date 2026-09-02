import { createHash } from "node:crypto";

import { money, type Money } from "@/lib/domain/money/money";
import {
  REPORT_ENGINE_VERSION,
  REPORT_POLICY_VERSION,
  type FinancialReport,
  type ReportMoneyLine,
  type ReportPeriod,
  type ReportScope,
  type ReportSourceReference,
} from "@/lib/reports/report";

export type ReportTransactionInput = Readonly<{
  amount: Money;
  category: string;
  date: string;
  id: string;
  type: "expense" | "income" | "refund" | "transfer";
  version: number;
}>;

export type ReportBalanceInput = Readonly<{
  amount: Money;
  id: string;
  label: string;
  version: number;
}>;

export type ReportEngineInput = Readonly<{
  accounts: readonly ReportBalanceInput[];
  budget: readonly ReportBalanceInput[];
  generatedAt: string;
  goals: readonly ReportBalanceInput[];
  liabilities: readonly ReportBalanceInput[];
  netWorth: readonly ReportBalanceInput[];
  period: ReportPeriod;
  savings: readonly ReportBalanceInput[];
  scope: ReportScope;
  subscriptions: readonly ReportBalanceInput[];
  timeZone: string;
  transactions: readonly ReportTransactionInput[];
}>;

export function reportPeriodBounds(period: ReportPeriod): Readonly<{ end: string; start: string }> {
  if (period.kind === "year") return { end: `${period.value}-12-31`, start: `${period.value}-01-01` };
  const [yearText, monthText] = period.value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { end: `${period.value}-${String(lastDay).padStart(2, "0")}`, start: `${period.value}-01` };
}

function stable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}

function alias(kind: string, id: string): string {
  return `${kind}.${createHash("sha256").update(id, "utf8").digest("hex").slice(0, 12)}`;
}

function sumLines(inputs: readonly ReportBalanceInput[], prefix: string): readonly ReportMoneyLine[] {
  const grouped = new Map<string, bigint>();
  for (const input of inputs) grouped.set(input.amount.currency, (grouped.get(input.amount.currency) ?? 0n) + input.amount.amountMinor);
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({
    amount: money(amountMinor, currency), key: `${prefix}.total`, label: prefix, sourceAliases: inputs.filter((input) => input.amount.currency === currency).map((input) => alias(prefix, input.id)).sort(),
  }));
}

function itemLines(inputs: readonly ReportBalanceInput[], prefix: string): readonly ReportMoneyLine[] {
  return [...inputs].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)).map((input) => ({
    amount: input.amount, key: `${prefix}.item`, label: input.label, sourceAliases: [alias(prefix, input.id)],
  }));
}

function cashFlow(transactions: readonly ReportTransactionInput[]): readonly ReportMoneyLine[] {
  const grouped = new Map<string, { expense: bigint; income: bigint; refund: bigint }>();
  for (const transaction of transactions) {
    if (transaction.type === "transfer") continue;
    const current = grouped.get(transaction.amount.currency) ?? { expense: 0n, income: 0n, refund: 0n };
    current[transaction.type] += transaction.amount.amountMinor;
    grouped.set(transaction.amount.currency, current);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([currency, total]) => {
    const sourceAliases = transactions.filter((item) => item.amount.currency === currency && item.type !== "transfer").map((item) => alias("transaction", item.id)).sort();
    return [
      { amount: money(total.income, currency), key: "cash_flow.income", label: "income", sourceAliases },
      { amount: money(total.expense, currency), key: "cash_flow.expense", label: "expense", sourceAliases },
      { amount: money(total.refund, currency), key: "cash_flow.refund", label: "refund", sourceAliases },
      { amount: money(total.income - total.expense + total.refund, currency), key: "cash_flow.net", label: "net", sourceAliases },
    ];
  });
}

function categories(transactions: readonly ReportTransactionInput[]): readonly ReportMoneyLine[] {
  const grouped = new Map<string, { amountMinor: bigint; sourceAliases: string[] }>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense" && transaction.type !== "refund") continue;
    const key = `${transaction.category}\u0000${transaction.amount.currency}`;
    const current = grouped.get(key) ?? { amountMinor: 0n, sourceAliases: [] };
    current.amountMinor += transaction.type === "expense" ? transaction.amount.amountMinor : -transaction.amount.amountMinor;
    current.sourceAliases.push(alias("transaction", transaction.id));
    grouped.set(key, current);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, total]) => {
    const [category, currency] = key.split("\u0000");
    if (category === undefined || currency === undefined) throw new RangeError("Invalid category aggregation key.");
    return { amount: money(total.amountMinor, currency), key: "category.spending", label: category, sourceAliases: total.sourceAliases.sort() };
  });
}

export function calculateFinancialReport(input: ReportEngineInput): FinancialReport {
  const bounds = reportPeriodBounds(input.period);
  const transactions = input.transactions.filter((item) => item.date >= bounds.start && item.date <= bounds.end);
  const allSources: readonly Readonly<{ id: string; kind: string; version: number }>[] = [
    ...input.accounts.map((item) => ({ ...item, kind: "account" })),
    ...input.budget.map((item) => ({ ...item, kind: "budget" })),
    ...input.goals.map((item) => ({ ...item, kind: "goal" })),
    ...input.liabilities.map((item) => ({ ...item, kind: "liability" })),
    ...input.netWorth.map((item) => ({ ...item, kind: "net_worth" })),
    ...input.savings.map((item) => ({ ...item, kind: "savings" })),
    ...input.subscriptions.map((item) => ({ ...item, kind: "subscription" })),
    ...transactions.map((item) => ({ ...item, kind: "transaction" })),
  ];
  const sourceReferences: ReportSourceReference[] = allSources
    .map((source) => ({ alias: alias(source.kind, source.id), kind: source.kind, sourceId: source.id, version: String(source.version) }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
  const sourceFingerprint = hash({ period: input.period, scope: input.scope, sources: allSources });
  return {
    engineVersion: REPORT_ENGINE_VERSION,
    generatedAt: input.generatedAt,
    period: input.period,
    periodEnd: bounds.end,
    periodStart: bounds.start,
    policyVersion: REPORT_POLICY_VERSION,
    scope: input.scope,
    sections: {
      accounts: itemLines(input.accounts, "account"),
      budget: itemLines(input.budget, "budget"),
      cashFlow: cashFlow(transactions),
      categories: categories(transactions),
      debt: itemLines(input.liabilities, "liability"),
      goals: itemLines(input.goals, "goal"),
      netWorth: sumLines(input.netWorth, "net_worth"),
      savings: itemLines(input.savings, "savings"),
      subscriptions: itemLines(input.subscriptions, "subscription"),
    },
    sourceFingerprint,
    sourceReferences,
    timeZone: input.timeZone,
  };
}
