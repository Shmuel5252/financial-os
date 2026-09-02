import { createHash } from "node:crypto";

import {
  calendarDateAtInstant,
} from "@/lib/domain/financial-engine/financial-calendar";
import { money, type Money } from "@/lib/domain/money/money";
import { utcInstantSchema } from "@/lib/domain/time/financial-time";

export const NET_WORTH_ENGINE_VERSION = "net-worth/1.0.0" as const;
export const NET_WORTH_POLICY_VERSION = "net-worth-policy-v1" as const;
export const NET_WORTH_FRESHNESS_VERSION = "net-worth-freshness-v1" as const;

export type NetWorthSide = "asset" | "liability";
export type NetWorthFreshness = "FRESH" | "NOT_YET_EFFECTIVE" | "STALE";
export type NetWorthProvenanceKind =
  | "deterministic_derived"
  | "imported"
  | "market_data_provider"
  | "user_entered"
  | "verified_provider";
export type NetWorthValuationType =
  | "account_balance"
  | "appraisal"
  | "cash_balance"
  | "derived_balance"
  | "market_value"
  | "outstanding_balance"
  | "principal_balance"
  | "settlement_balance"
  | "user_estimate";
export type NetWorthCategory =
  | "cash"
  | "credit_card"
  | "investment"
  | "loan"
  | "other_asset"
  | "other_liability"
  | "overdraft"
  | "real_estate"
  | "savings";
export type NetWorthSourceKind =
  | "account"
  | "credit_card"
  | "loan"
  | "net_worth_item"
  | "savings";

export type NetWorthAggregation =
  | Readonly<{ kind: "independent" }>
  | Readonly<{ groupId: string; kind: "authority" | "fallback" }>
  | Readonly<{
      kind: "account_detail";
      mode: "detail_authoritative" | "parent_authoritative";
      parentComponentId: string;
    }>
  | Readonly<{
      kind: "liability_candidate";
      subjectId: string;
    }>;

export type NetWorthComponentInput = Readonly<{
  aggregation: NetWorthAggregation;
  amount: Money;
  category: NetWorthCategory;
  effectiveAt: string;
  id: string;
  label: string;
  liquidity: "cash" | "non_cash" | "savings";
  provenance: Readonly<{
    kind: NetWorthProvenanceKind;
    note: string | null;
  }>;
  side: NetWorthSide;
  sourceId: string;
  sourceKind: NetWorthSourceKind;
  sourceVersion: number;
  valuationType: NetWorthValuationType;
}>;

export type NetWorthComponent = NetWorthComponentInput &
  Readonly<{
    ageCalendarDays: number;
    freshness: NetWorthFreshness;
    freshnessThresholdDays: number;
  }>;

export type NetWorthExcludedComponent = Readonly<{
  component: NetWorthComponent;
  reason:
    | "detail_authoritative"
    | "fallback_replaced"
    | "future_effective_date"
    | "lower_priority_liability"
    | "parent_account_authoritative";
}>;

export type NetWorthCurrencyTotal = Readonly<{
  assets: Money;
  cashAssets: Money;
  liabilities: Money;
  netWorth: Money;
  nonCashAssets: Money;
}>;

export type NetWorthInput = Readonly<{
  asOf: string;
  components: readonly NetWorthComponentInput[];
  timeZone: string;
}>;

export type NetWorthStatement = Readonly<{
  asOf: string;
  engineVersion: typeof NET_WORTH_ENGINE_VERSION;
  evaluationDate: string;
  excluded: readonly NetWorthExcludedComponent[];
  freshness: "FRESH" | "STALE";
  freshnessVersion: typeof NET_WORTH_FRESHNESS_VERSION;
  included: readonly NetWorthComponent[];
  inputHash: string;
  policyVersion: typeof NET_WORTH_POLICY_VERSION;
  timeZone: string;
  totals: readonly NetWorthCurrencyTotal[];
}>;

const SOURCE_THRESHOLDS: Readonly<Record<NetWorthProvenanceKind, number>> = {
  deterministic_derived: 7,
  imported: 14,
  market_data_provider: 1,
  user_entered: 30,
  verified_provider: 1,
};

const VALUATION_THRESHOLDS: Readonly<Record<NetWorthValuationType, number>> = {
  account_balance: 7,
  appraisal: 90,
  cash_balance: 7,
  derived_balance: 7,
  market_value: 1,
  outstanding_balance: 7,
  principal_balance: 30,
  settlement_balance: 7,
  user_estimate: 30,
};

function dateNumber(calendarDate: string): number {
  const [year, month, day] = calendarDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError("Invalid calendar date.");
  }
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function stable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function evaluateFreshness(
  component: NetWorthComponentInput,
  evaluationDate: string,
  timeZone: string,
): NetWorthComponent {
  if (component.amount.amountMinor < 0n) {
    throw new RangeError("Net-worth components must use non-negative magnitudes.");
  }
  if (!Number.isInteger(component.sourceVersion) || component.sourceVersion < 1) {
    throw new RangeError("Net-worth source versions must be positive integers.");
  }
  const effectiveAt = utcInstantSchema.parse(component.effectiveAt);
  const effectiveDate = calendarDateAtInstant(effectiveAt, timeZone);
  const ageCalendarDays = dateNumber(evaluationDate) - dateNumber(effectiveDate);
  const freshnessThresholdDays = Math.min(
    SOURCE_THRESHOLDS[component.provenance.kind],
    VALUATION_THRESHOLDS[component.valuationType],
  );
  return {
    ...component,
    ageCalendarDays,
    freshness:
      ageCalendarDays < 0
        ? "NOT_YET_EFFECTIVE"
        : ageCalendarDays <= freshnessThresholdDays
          ? "FRESH"
          : "STALE",
    freshnessThresholdDays,
  };
}

function liabilityPriority(component: NetWorthComponent): number {
  const verified = component.provenance.kind === "verified_provider";
  if (verified && component.valuationType === "settlement_balance") return 400;
  if (verified && component.valuationType === "outstanding_balance") return 300;
  if (
    component.provenance.kind === "deterministic_derived" &&
    component.valuationType === "derived_balance"
  ) return 200;
  const typeRank: Readonly<Partial<Record<NetWorthValuationType, number>>> = {
    settlement_balance: 40,
    outstanding_balance: 30,
    derived_balance: 20,
    principal_balance: 10,
    user_estimate: 5,
  };
  return 100 + (typeRank[component.valuationType] ?? 0);
}

function chooseLiabilityCandidate(
  components: readonly NetWorthComponent[],
): NetWorthComponent {
  const effective = components.filter((component) => component.freshness !== "NOT_YET_EFFECTIVE");
  const fresh = effective.filter((component) => component.freshness === "FRESH");
  const candidates = fresh.length > 0 ? fresh : effective;
  const ordered = [...candidates].sort((left, right) =>
    liabilityPriority(right) - liabilityPriority(left) ||
    right.effectiveAt.localeCompare(left.effectiveAt) ||
    left.id.localeCompare(right.id),
  );
  const selected = ordered[0];
  if (selected === undefined) throw new RangeError("A liability candidate group has no effective value.");
  return selected;
}

export function calculateNetWorth(input: NetWorthInput): NetWorthStatement {
  const asOf = utcInstantSchema.parse(input.asOf);
  const evaluationDate = calendarDateAtInstant(asOf, input.timeZone);
  const identifiers = new Set<string>();
  const evaluated = input.components.map((component) => {
    if (identifiers.has(component.id)) throw new RangeError("Net-worth component IDs must be unique.");
    identifiers.add(component.id);
    return evaluateFreshness(component, evaluationDate, input.timeZone);
  });

  const included = new Map<string, NetWorthComponent>();
  const excluded = new Map<string, NetWorthExcludedComponent>();
  const future = evaluated.filter((component) => component.freshness === "NOT_YET_EFFECTIVE");
  for (const component of future) {
    excluded.set(component.id, { component, reason: "future_effective_date" });
  }
  const effective = evaluated.filter((component) => component.freshness !== "NOT_YET_EFFECTIVE");

  const authorityGroups = new Set(
    effective
      .filter((component) => component.aggregation.kind === "authority")
      .map((component) => component.aggregation.kind === "authority" ? component.aggregation.groupId : ""),
  );
  for (const component of effective) {
    if (
      component.aggregation.kind === "fallback" &&
      authorityGroups.has(component.aggregation.groupId)
    ) {
      excluded.set(component.id, { component, reason: "fallback_replaced" });
    }
  }

  const detailsByParent = new Map<string, NetWorthComponent[]>();
  for (const component of effective) {
    if (component.aggregation.kind !== "account_detail") continue;
    const group = detailsByParent.get(component.aggregation.parentComponentId) ?? [];
    group.push(component);
    detailsByParent.set(component.aggregation.parentComponentId, group);
  }
  for (const [parentId, details] of detailsByParent) {
    const authoritative = details.filter(
      (component) => component.aggregation.kind === "account_detail" && component.aggregation.mode === "detail_authoritative",
    );
    if (authoritative.length > 0) {
      const parent = effective.find((component) => component.id === parentId);
      if (parent !== undefined) excluded.set(parent.id, { component: parent, reason: "detail_authoritative" });
      for (const component of details) {
        if (component.aggregation.kind === "account_detail" && component.aggregation.mode === "parent_authoritative") {
          excluded.set(component.id, { component, reason: "parent_account_authoritative" });
        }
      }
    } else {
      for (const component of details) {
        excluded.set(component.id, { component, reason: "parent_account_authoritative" });
      }
    }
  }

  const liabilities = new Map<string, NetWorthComponent[]>();
  for (const component of effective) {
    if (component.aggregation.kind !== "liability_candidate") continue;
    const group = liabilities.get(component.aggregation.subjectId) ?? [];
    group.push(component);
    liabilities.set(component.aggregation.subjectId, group);
  }
  for (const candidates of liabilities.values()) {
    const effectiveCandidates = candidates.filter((candidate) => candidate.freshness !== "NOT_YET_EFFECTIVE");
    if (effectiveCandidates.length === 0) continue;
    const selected = chooseLiabilityCandidate(effectiveCandidates);
    for (const candidate of effectiveCandidates) {
      if (candidate.id !== selected.id) {
        excluded.set(candidate.id, { component: candidate, reason: "lower_priority_liability" });
      }
    }
  }

  for (const component of effective) {
    if (!excluded.has(component.id)) included.set(component.id, component);
  }

  const currencies = [...new Set([...included.values()].map((component) => component.amount.currency))].sort();
  const totals = currencies.map((currency) => {
    let assets = 0n;
    let cashAssets = 0n;
    let liabilitiesTotal = 0n;
    for (const component of included.values()) {
      if (component.amount.currency !== currency) continue;
      if (component.side === "asset") {
        assets += component.amount.amountMinor;
        if (component.liquidity === "cash") cashAssets += component.amount.amountMinor;
      } else {
        liabilitiesTotal += component.amount.amountMinor;
      }
    }
    return {
      assets: money(assets, currency),
      cashAssets: money(cashAssets, currency),
      liabilities: money(liabilitiesTotal, currency),
      netWorth: money(assets - liabilitiesTotal, currency),
      nonCashAssets: money(assets - cashAssets, currency),
    };
  });
  const sortedIncluded = [...included.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedExcluded = [...excluded.values()].sort((left, right) => left.component.id.localeCompare(right.component.id));
  const inputHash = createHash("sha256")
    .update(JSON.stringify(stable({
      components: evaluated,
      engineVersion: NET_WORTH_ENGINE_VERSION,
      evaluationDate,
      policyVersion: NET_WORTH_POLICY_VERSION,
      timeZone: input.timeZone,
    })), "utf8")
    .digest("hex");
  return {
    asOf,
    engineVersion: NET_WORTH_ENGINE_VERSION,
    evaluationDate,
    excluded: sortedExcluded,
    freshness: sortedIncluded.some((component) => component.freshness !== "FRESH") ? "STALE" : "FRESH",
    freshnessVersion: NET_WORTH_FRESHNESS_VERSION,
    included: sortedIncluded,
    inputHash,
    policyVersion: NET_WORTH_POLICY_VERSION,
    timeZone: input.timeZone,
    totals,
  };
}
