import { z } from "zod";

import {
  NET_WORTH_ENGINE_VERSION,
  NET_WORTH_FRESHNESS_VERSION,
  NET_WORTH_POLICY_VERSION,
  type NetWorthCategory,
  type NetWorthStatement,
  type NetWorthValuationType,
} from "@/lib/domain/net-worth/net-worth-engine";
import { moneyInputSchema, parseMajorMoney } from "@/lib/domain/money/money-input";
import { money, serializeMoney, type Money } from "@/lib/domain/money/money";
import { utcInstantSchema } from "@/lib/domain/time/financial-time";
import { InputValidationError } from "@/lib/errors/application-error";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const categorySchema = z.enum([
  "cash",
  "credit_card",
  "investment",
  "loan",
  "other_asset",
  "other_liability",
  "overdraft",
  "real_estate",
  "savings",
]);
const valuationTypeSchema = z.enum([
  "account_balance",
  "appraisal",
  "cash_balance",
  "derived_balance",
  "market_value",
  "outstanding_balance",
  "principal_balance",
  "settlement_balance",
  "user_estimate",
]);
const relationshipSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("standalone") }).strict(),
  z.object({
    accountId: objectIdSchema,
    aggregationMode: z.enum(["detail_authoritative", "parent_authoritative"]),
    kind: z.literal("account_detail"),
  }).strict(),
  z.object({
    kind: z.literal("liability_evidence"),
    recordId: objectIdSchema,
    recordKind: z.enum(["credit_card", "loan"]),
  }).strict(),
]);

const commandFields = {
  amount: moneyInputSchema,
  category: categorySchema,
  effectiveAt: utcInstantSchema,
  label: z.string().trim().min(1).max(100),
  provenanceNote: z.string().trim().max(240).nullable().default(null),
  relationship: relationshipSchema,
  side: z.enum(["asset", "liability"]),
  valuationType: valuationTypeSchema,
} as const;

function validateItemShape(
  value: Readonly<{
    category: NetWorthCategory;
    relationship: z.infer<typeof relationshipSchema>;
    side: "asset" | "liability";
    valuationType: NetWorthValuationType;
  }>,
  context: z.RefinementCtx,
): void {
  const assetCategories = new Set<NetWorthCategory>([
    "cash", "investment", "other_asset", "real_estate", "savings",
  ]);
  if ((value.side === "asset") !== assetCategories.has(value.category)) {
    context.addIssue({ code: "custom", message: "The category does not match the item side.", path: ["category"] });
  }
  if (value.relationship.kind === "account_detail") {
    if (value.side !== "asset" || value.category !== "investment") {
      context.addIssue({ code: "custom", message: "Account detail must be an investment asset.", path: ["relationship"] });
    }
  }
  if (value.relationship.kind === "liability_evidence") {
    if (value.side !== "liability") {
      context.addIssue({ code: "custom", message: "Liability evidence must be a liability.", path: ["relationship"] });
    }
    if (value.relationship.recordKind === "loan" && value.category !== "loan") {
      context.addIssue({ code: "custom", message: "Loan evidence must use the loan category.", path: ["category"] });
    }
    if (value.relationship.recordKind === "credit_card" && value.category !== "credit_card") {
      context.addIssue({ code: "custom", message: "Card evidence must use the credit-card category.", path: ["category"] });
    }
    if (!["derived_balance", "outstanding_balance", "principal_balance", "settlement_balance", "user_estimate"].includes(value.valuationType)) {
      context.addIssue({ code: "custom", message: "The valuation type is not valid for liability evidence.", path: ["valuationType"] });
    }
  }
}

const itemInputSchema = z.object(commandFields).strict().superRefine(validateItemShape);

export const createNetWorthItemCommandSchema = z.object({
  fields: itemInputSchema,
  idempotencyKey: z.string().uuid(),
}).strict();
export const updateNetWorthItemCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  fields: itemInputSchema,
  id: objectIdSchema,
}).strict();
export const deleteNetWorthItemCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  id: objectIdSchema,
}).strict();
export const netWorthPageQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export const createNetWorthSnapshotCommandSchema = z.object({
  trigger: z.literal("explicit").default("explicit"),
}).strict();

export type NetWorthItemRelationship = z.infer<typeof relationshipSchema>;
export type NetWorthItemFields = Readonly<{
  amount: Money;
  category: NetWorthCategory;
  effectiveAt: string;
  label: string;
  provenance: Readonly<{ kind: "user_entered"; note: string | null }>;
  relationship: NetWorthItemRelationship;
  side: "asset" | "liability";
  valuationType: NetWorthValuationType;
}>;
export type NetWorthItem = Readonly<{
  createdAt: Date;
  fields: NetWorthItemFields;
  id: string;
  updatedAt: Date;
  version: number;
}>;
export type NetWorthSnapshot = Readonly<{
  createdAt: Date;
  id: string;
  schemaVersion: 1;
  stateFingerprint: string;
  statement: NetWorthStatement;
  trigger: "explicit" | "material_change";
}>;

function parseMoney(input: z.infer<typeof moneyInputSchema>): Money {
  try {
    const parsed = parseMajorMoney(input);
    if (parsed.amountMinor < 0n) throw new RangeError("Amount cannot be negative.");
    return parsed;
  } catch (error) {
    throw new InputValidationError([{ field: "amount", message: error instanceof Error ? error.message : "Invalid amount." }]);
  }
}

export function parseNetWorthItemFields(input: unknown): NetWorthItemFields {
  const parsed = parseUntrusted(itemInputSchema, input);
  return {
    amount: parseMoney(parsed.amount),
    category: parsed.category,
    effectiveAt: parsed.effectiveAt,
    label: parsed.label,
    provenance: { kind: "user_entered", note: parsed.provenanceNote },
    relationship: parsed.relationship,
    side: parsed.side,
    valuationType: parsed.valuationType,
  };
}

const domainMoneySchema = z.object({ amountMinor: z.bigint(), currency: z.string().regex(/^[A-Z]{3}$/) })
  .transform((value) => money(value.amountMinor, value.currency));
export const netWorthItemFieldsDomainSchema: z.ZodType<NetWorthItemFields> = z.object({
  amount: domainMoneySchema.refine((value) => value.amountMinor >= 0n),
  category: categorySchema,
  effectiveAt: utcInstantSchema,
  label: z.string().min(1).max(100),
  provenance: z.object({ kind: z.literal("user_entered"), note: z.string().max(240).nullable() }),
  relationship: relationshipSchema,
  side: z.enum(["asset", "liability"]),
  valuationType: valuationTypeSchema,
}).superRefine(validateItemShape);

const provenanceDomainSchema = z.object({
  kind: z.enum(["deterministic_derived", "imported", "market_data_provider", "user_entered", "verified_provider"]),
  note: z.string().nullable(),
});
const aggregationDomainSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("independent") }),
  z.object({ groupId: z.string(), kind: z.literal("authority") }),
  z.object({ groupId: z.string(), kind: z.literal("fallback") }),
  z.object({
    kind: z.literal("account_detail"),
    mode: z.enum(["detail_authoritative", "parent_authoritative"]),
    parentComponentId: z.string(),
  }),
  z.object({ kind: z.literal("liability_candidate"), subjectId: z.string() }),
]);
const componentDomainSchema = z.object({
  ageCalendarDays: z.number().int(),
  aggregation: aggregationDomainSchema,
  amount: domainMoneySchema,
  category: categorySchema,
  effectiveAt: utcInstantSchema,
  freshness: z.enum(["FRESH", "NOT_YET_EFFECTIVE", "STALE"]),
  freshnessThresholdDays: z.number().int().positive(),
  id: z.string().min(1),
  label: z.string().min(1),
  liquidity: z.enum(["cash", "non_cash", "savings"]),
  provenance: provenanceDomainSchema,
  side: z.enum(["asset", "liability"]),
  sourceId: z.string().min(1),
  sourceKind: z.enum(["account", "credit_card", "loan", "net_worth_item", "savings"]),
  sourceVersion: z.number().int().positive(),
  valuationType: valuationTypeSchema,
});
const currencyTotalDomainSchema = z.object({
  assets: domainMoneySchema,
  cashAssets: domainMoneySchema,
  liabilities: domainMoneySchema,
  netWorth: domainMoneySchema,
  nonCashAssets: domainMoneySchema,
});
export const netWorthStatementDomainSchema: z.ZodType<NetWorthStatement> = z.object({
  asOf: utcInstantSchema,
  engineVersion: z.literal(NET_WORTH_ENGINE_VERSION),
  evaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excluded: z.array(z.object({
    component: componentDomainSchema,
    reason: z.enum(["detail_authoritative", "fallback_replaced", "future_effective_date", "lower_priority_liability", "parent_account_authoritative"]),
  })),
  freshness: z.enum(["FRESH", "STALE"]),
  freshnessVersion: z.literal(NET_WORTH_FRESHNESS_VERSION),
  included: z.array(componentDomainSchema),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  policyVersion: z.literal(NET_WORTH_POLICY_VERSION),
  timeZone: z.string().min(1),
  totals: z.array(currencyTotalDomainSchema),
});

function toComponentView(component: NetWorthStatement["included"][number]) {
  return { ...component, amount: serializeMoney(component.amount) };
}

export function toNetWorthStatementView(statement: NetWorthStatement) {
  return {
    ...statement,
    excluded: statement.excluded.map((entry) => ({ ...entry, component: toComponentView(entry.component) })),
    included: statement.included.map(toComponentView),
    totals: statement.totals.map((total) => ({
      assets: serializeMoney(total.assets),
      cashAssets: serializeMoney(total.cashAssets),
      liabilities: serializeMoney(total.liabilities),
      netWorth: serializeMoney(total.netWorth),
      nonCashAssets: serializeMoney(total.nonCashAssets),
    })),
  };
}

export type NetWorthStatementView = ReturnType<typeof toNetWorthStatementView>;
export type NetWorthCenterView = Readonly<{
  current: NetWorthStatementView;
  goalLinks: readonly Readonly<{ goalId: string; goalVersion: number; sourceId: string; sourceKind: "account" | "savings" }> [];
  items: readonly ReturnType<typeof toNetWorthItemView>[];
  snapshots: readonly ReturnType<typeof toNetWorthSnapshotView>[];
  sourceOptions: Readonly<{
    accounts: readonly Readonly<{ id: string; label: string; version: number }>[];
    cards: readonly Readonly<{ id: string; label: string; version: number }>[];
    loans: readonly Readonly<{ id: string; label: string; version: number }>[];
  }>;
}>;

export function toNetWorthItemView(item: NetWorthItem) {
  return {
    createdAt: item.createdAt.toISOString(),
    fields: { ...item.fields, amount: serializeMoney(item.fields.amount) },
    id: item.id,
    updatedAt: item.updatedAt.toISOString(),
    version: item.version,
  };
}

export function toNetWorthSnapshotView(snapshot: NetWorthSnapshot) {
  return {
    createdAt: snapshot.createdAt.toISOString(),
    id: snapshot.id,
    schemaVersion: snapshot.schemaVersion,
    stateFingerprint: snapshot.stateFingerprint,
    statement: toNetWorthStatementView(snapshot.statement),
    trigger: snapshot.trigger,
  };
}

export function assertNetWorthStatementVersions(statement: NetWorthStatement): void {
  if (
    statement.engineVersion !== NET_WORTH_ENGINE_VERSION ||
    statement.policyVersion !== NET_WORTH_POLICY_VERSION ||
    statement.freshnessVersion !== NET_WORTH_FRESHNESS_VERSION
  ) throw new RangeError("Stored net-worth statement version is invalid.");
}

export function parseNetWorthCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseUntrusted(schema, input);
}
