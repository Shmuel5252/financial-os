import { createHash } from "node:crypto";

import { money, type Money } from "@/lib/domain/money/money";
import {
  TRANSACTION_INTELLIGENCE_MAX_SIGNALS,
  TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS,
  type TransactionIntelligenceCalculation,
  type TransactionIntelligenceEvidence,
  type TransactionIntelligenceInput,
  type TransactionIntelligenceSignal,
  type TransactionIntelligenceSignalKind,
} from "@/lib/transaction-intelligence/transaction-intelligence";

type MerchantRule = Readonly<{
  categoryId: string;
  canonical: string;
  patterns: readonly string[];
  subscription: boolean;
}>;

const merchantRules: readonly MerchantRule[] = [
  {
    canonical: "Netflix",
    categoryId: "system:subscriptions",
    patterns: ["netflix"],
    subscription: true,
  },
  {
    canonical: "Spotify",
    categoryId: "system:subscriptions",
    patterns: ["spotify"],
    subscription: true,
  },
  {
    canonical: "Apple Services",
    categoryId: "system:subscriptions",
    patterns: ["apple com bill", "apple services"],
    subscription: true,
  },
  {
    canonical: "Google Services",
    categoryId: "system:subscriptions",
    patterns: ["google services", "google storage", "youtube premium"],
    subscription: true,
  },
  {
    canonical: "שופרסל",
    categoryId: "system:food",
    patterns: ["שופרסל", "shufersal"],
    subscription: false,
  },
  {
    canonical: "רמי לוי",
    categoryId: "system:food",
    patterns: ["רמי לוי", "rami levi"],
    subscription: false,
  },
  {
    canonical: "Carrefour",
    categoryId: "system:food",
    patterns: ["carrefour", "קרפור"],
    subscription: false,
  },
  {
    canonical: "Pango",
    categoryId: "system:transport",
    patterns: ["pango", "פנגו"],
    subscription: false,
  },
  {
    canonical: "Gett",
    categoryId: "system:transport",
    patterns: ["gett"],
    subscription: false,
  },
  {
    canonical: "Wolt",
    categoryId: "system:restaurants",
    patterns: ["wolt", "וולט"],
    subscription: false,
  },
];

type PreparedTransaction = TransactionIntelligenceInput &
  Readonly<{
    merchantRule: MerchantRule | null;
    normalizedMerchant: string | null;
  }>;

function groupBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): ReadonlyMap<string, readonly T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function merchantBase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("he")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function merchantRuleFor(base: string): MerchantRule | null {
  return (
    merchantRules.find((rule) =>
      rule.patterns.some((pattern) => base.includes(pattern)),
    ) ?? null
  );
}

export function normalizeMerchant(value: string | null): Readonly<{
  normalizedMerchant: string | null;
  rule: MerchantRule | null;
}> {
  if (value === null) {
    return { normalizedMerchant: null, rule: null };
  }
  const base = merchantBase(value);
  if (base.length === 0) {
    return { normalizedMerchant: null, rule: null };
  }
  const rule = merchantRuleFor(base);
  return {
    normalizedMerchant: rule?.canonical ?? base,
    rule,
  };
}

function epochDay(value: string): number {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function medianBigInt(values: readonly bigint[]): bigint {
  if (values.length === 0) {
    throw new RangeError("A median requires at least one value.");
  }
  const sorted = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2n;
}

function stableSignalId(
  kind: TransactionIntelligenceSignalKind,
  transactionId: string,
  evidenceIds: readonly string[],
): string {
  return createHash("sha256")
    .update(`${kind}|${transactionId}|${[...evidenceIds].sort().join(",")}`)
    .digest("hex")
    .slice(0, 32);
}

function evidence(transaction: PreparedTransaction): TransactionIntelligenceEvidence {
  return {
    amount: transaction.amount,
    confirmedCategoryId: transaction.confirmedCategoryId,
    date: transaction.date,
    normalizedMerchant: transaction.normalizedMerchant,
    rawMerchant: transaction.merchant,
    transactionId: transaction.id,
  };
}

function signal(input: Readonly<{
  baselineAmount?: Money | null;
  confidenceBps: number;
  evidence: readonly PreparedTransaction[];
  explanationCode: TransactionIntelligenceSignal["explanationCode"];
  kind: TransactionIntelligenceSignalKind;
  periodDays?: number | null;
  suggestedCategoryId?: string | null;
  transaction: PreparedTransaction;
}>): TransactionIntelligenceSignal {
  const boundedEvidence = input.evidence.slice(-12);
  return {
    amount: input.transaction.amount,
    baselineAmount: input.baselineAmount ?? null,
    confidenceBps: input.confidenceBps,
    evidence: boundedEvidence.map(evidence),
    explanationCode: input.explanationCode,
    id: stableSignalId(
      input.kind,
      input.transaction.id,
      boundedEvidence.map((item) => item.id),
    ),
    kind: input.kind,
    normalizedMerchant: input.transaction.normalizedMerchant,
    periodDays: input.periodDays ?? null,
    suggestedCategoryId: input.suggestedCategoryId ?? null,
    transactionId: input.transaction.id,
  };
}

function periodClass(days: number): string | null {
  if (days >= 6 && days <= 8) return "weekly";
  if (days >= 13 && days <= 15) return "biweekly";
  if (days >= 26 && days <= 35) return "monthly";
  if (days >= 80 && days <= 100) return "quarterly";
  if (days >= 350 && days <= 380) return "annual";
  return null;
}

function recurringPattern(
  transactions: readonly PreparedTransaction[],
): Readonly<{ periodDays: number; stableAmount: boolean }> | null {
  const uniqueDates = [...new Map(transactions.map((item) => [item.date, item])).values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  if (uniqueDates.length < 3) {
    return null;
  }
  const gaps = uniqueDates
    .slice(1)
    .map((item, index) => epochDay(item.date) - epochDay(uniqueDates[index]!.date));
  const classes = gaps.map(periodClass);
  if (classes[0] === null || classes.some((value) => value !== classes[0])) {
    return null;
  }
  const amounts = uniqueDates.map((item) => item.amount.amountMinor);
  const median = medianBigInt(amounts);
  const maximumDeviation = amounts.reduce((maximum, amount) => {
    const difference = amount > median ? amount - median : median - amount;
    return difference > maximum ? difference : maximum;
  }, 0n);
  return {
    periodDays: Number(medianBigInt(gaps.map(BigInt))),
    stableAmount: median === 0n || maximumDeviation * 10_000n <= median * 1_000n,
  };
}

function prepare(
  inputs: readonly TransactionIntelligenceInput[],
): readonly PreparedTransaction[] {
  return inputs
    .map((transaction) => {
      const normalized = normalizeMerchant(transaction.merchant);
      return {
        ...transaction,
        merchantRule: normalized.rule,
        normalizedMerchant: normalized.normalizedMerchant,
      };
    })
    .sort((left, right) =>
      left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
    );
}

function categorySignals(
  transactions: readonly PreparedTransaction[],
): Readonly<{ omitted: number; signals: readonly TransactionIntelligenceSignal[] }> {
  const result: TransactionIntelligenceSignal[] = [];
  let omitted = 0;
  const groups = groupBy(
    transactions.filter((item) => item.normalizedMerchant !== null),
    (item) => item.normalizedMerchant!,
  );

  for (const transaction of transactions) {
    if (
      transaction.type !== "expense" ||
      transaction.normalizedMerchant === null ||
      transaction.confirmedCategoryId !== "system:other"
    ) {
      continue;
    }
    const history = (groups.get(transaction.normalizedMerchant) ?? []).filter(
      (item) =>
        item.id !== transaction.id &&
        item.date <= transaction.date &&
        item.type === "expense" &&
        item.confirmedCategoryId !== null &&
        item.confirmedCategoryId !== "system:other",
    );
    const categories = new Set(history.map((item) => item.confirmedCategoryId!));
    let confidenceBps = 0;
    let suggestedCategoryId: string | null = null;
    let explanationCode: TransactionIntelligenceSignal["explanationCode"] =
      "CATEGORY_CURATED_MERCHANT";
    let signalEvidence: readonly PreparedTransaction[] = [transaction];

    if (categories.size === 1) {
      suggestedCategoryId = [...categories][0]!;
      confidenceBps = history.length >= 2 ? 9_500 : 7_500;
      explanationCode = "CATEGORY_CONFIRMED_HISTORY";
      signalEvidence = [...history.slice(-5), transaction];
    } else if (categories.size > 1) {
      omitted += 1;
      continue;
    } else if (transaction.merchantRule !== null) {
      suggestedCategoryId = transaction.merchantRule.categoryId;
      confidenceBps = 8_500;
    }

    if (
      suggestedCategoryId === null ||
      confidenceBps < TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS
    ) {
      if (suggestedCategoryId !== null) omitted += 1;
      continue;
    }
    result.push(
      signal({
        confidenceBps,
        evidence: signalEvidence,
        explanationCode,
        kind: "category_suggestion",
        suggestedCategoryId,
        transaction,
      }),
    );
  }
  return { omitted, signals: result };
}

function duplicateSignals(
  transactions: readonly PreparedTransaction[],
): readonly TransactionIntelligenceSignal[] {
  const eligible = transactions.filter(
    (item) =>
      item.type !== "transfer" &&
      item.type !== "refund" &&
      item.normalizedMerchant !== null,
  );
  const groups = groupBy(eligible, (item) =>
    [
      item.accountId,
      item.amount.currency,
      item.amount.amountMinor.toString(),
      item.date,
      item.normalizedMerchant,
      item.type,
    ].join("|"),
  );
  return [...groups.values()].flatMap((group) => {
    if (group.length < 2) return [];
    const latest = group.at(-1)!;
    return [
      signal({
        confidenceBps: 9_200,
        evidence: group,
        explanationCode: "DUPLICATE_EXACT_MATCH",
        kind: "possible_duplicate",
        transaction: latest,
      }),
    ];
  });
}

function recurringAndAmountSignals(
  transactions: readonly PreparedTransaction[],
): readonly TransactionIntelligenceSignal[] {
  const result: TransactionIntelligenceSignal[] = [];
  const groups = groupBy(
    transactions.filter(
      (item) =>
        item.type === "expense" && item.normalizedMerchant !== null,
    ),
    (item) => `${item.normalizedMerchant}|${item.amount.currency}`,
  );

  for (const group of groups.values()) {
    const latest = group.at(-1)!;
    const pattern = recurringPattern(group);
    const isSubscription =
      latest.merchantRule?.subscription === true ||
      group.some((item) => item.confirmedCategoryId === "system:subscriptions");
    if (pattern !== null && pattern.stableAmount) {
      result.push(
        signal({
          confidenceBps: group.length >= 4 ? 9_000 : 8_000,
          evidence: group,
          explanationCode: isSubscription
            ? "SUBSCRIPTION_CALENDAR_PATTERN"
            : "RECURRING_CALENDAR_PATTERN",
          kind: isSubscription
            ? "subscription_candidate"
            : "recurring_candidate",
          periodDays: pattern.periodDays,
          transaction: latest,
        }),
      );
    }

    if (group.length >= 3) {
      const previous = group.slice(0, -1);
      const baselineMinor = medianBigInt(
        previous.map((item) => item.amount.amountMinor),
      );
      const latestMinor = latest.amount.amountMinor;
      if (
        isSubscription &&
        latestMinor > baselineMinor &&
        latestMinor * 10_000n >= baselineMinor * 11_000n
      ) {
        result.push(
          signal({
            baselineAmount: money(baselineMinor, latest.amount.currency),
            confidenceBps: 9_000,
            evidence: group,
            explanationCode: "SUBSCRIPTION_PRICE_INCREASE",
            kind: "subscription_increase",
            transaction: latest,
          }),
        );
      }
    }

    if (group.length >= 5) {
      const previous = group.slice(0, -1);
      const baselineMinor = medianBigInt(
        previous.map((item) => item.amount.amountMinor),
      );
      const latestMinor = latest.amount.amountMinor;
      if (
        latestMinor >= baselineMinor * 2n ||
        latestMinor * 2n <= baselineMinor
      ) {
        result.push(
          signal({
            baselineAmount: money(baselineMinor, latest.amount.currency),
            confidenceBps: 8_500,
            evidence: group,
            explanationCode: "AMOUNT_DEVIATES_FROM_MERCHANT_MEDIAN",
            kind: "amount_anomaly",
            transaction: latest,
          }),
        );
      }
    }
  }
  return result;
}

function unusualMerchantSignals(
  transactions: readonly PreparedTransaction[],
): readonly TransactionIntelligenceSignal[] {
  const result: TransactionIntelligenceSignal[] = [];
  const seen = new Set<string>();
  const priorByCurrency = new Map<string, bigint[]>();
  const newestDate = transactions.at(-1)?.date ?? null;

  for (const transaction of transactions) {
    if (
      transaction.type !== "expense" ||
      transaction.normalizedMerchant === null
    ) {
      continue;
    }
    const prior = priorByCurrency.get(transaction.amount.currency) ?? [];
    const firstSeen = !seen.has(transaction.normalizedMerchant);
    const recent =
      newestDate !== null && epochDay(newestDate) - epochDay(transaction.date) <= 90;
    if (
      firstSeen &&
      recent &&
      prior.length >= 10 &&
      transaction.amount.amountMinor >= medianBigInt(prior) * 3n
    ) {
      const baselineMinor = medianBigInt(prior);
      result.push(
        signal({
          baselineAmount: money(baselineMinor, transaction.amount.currency),
          confidenceBps: 7_800,
          evidence: [transaction],
          explanationCode: "NEW_MERCHANT_HIGH_AMOUNT",
          kind: "unusual_merchant",
          transaction,
        }),
      );
    }
    seen.add(transaction.normalizedMerchant);
    prior.push(transaction.amount.amountMinor);
    priorByCurrency.set(transaction.amount.currency, prior);
  }
  return result;
}

export function calculateTransactionIntelligence(
  inputs: readonly TransactionIntelligenceInput[],
): TransactionIntelligenceCalculation {
  const transactions = prepare(inputs);
  const category = categorySignals(transactions);
  const allSignals = [
    ...category.signals,
    ...duplicateSignals(transactions),
    ...recurringAndAmountSignals(transactions),
    ...unusualMerchantSignals(transactions),
  ].sort((left, right) => {
    const leftDate = left.evidence.at(-1)?.date ?? "";
    const rightDate = right.evidence.at(-1)?.date ?? "";
    return (
      rightDate.localeCompare(leftDate) ||
      right.confidenceBps - left.confidenceBps ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id)
    );
  });
  const merchantGroups = [...groupBy(
    transactions.filter((item) => item.normalizedMerchant !== null),
    (item) => item.normalizedMerchant!,
  ).entries()]
    .map(([normalizedMerchant, group]) => ({
      latestRawMerchant: group.at(-1)!.merchant!,
      normalizedMerchant,
      occurrenceCount: group.length,
      transactionIds: group.slice(-12).map((item) => item.id),
    }))
    .sort((left, right) =>
      right.occurrenceCount - left.occurrenceCount ||
      left.normalizedMerchant.localeCompare(right.normalizedMerchant, "he"),
    )
    .slice(0, 200);

  return {
    analyzedThroughDate: transactions.at(-1)?.date ?? null,
    inputCount: transactions.length,
    merchantGroups,
    omittedLowConfidenceCount: category.omitted,
    signals: allSignals.slice(0, TRANSACTION_INTELLIGENCE_MAX_SIGNALS),
    truncatedSignalCount: Math.max(
      0,
      allSignals.length - TRANSACTION_INTELLIGENCE_MAX_SIGNALS,
    ),
  };
}
