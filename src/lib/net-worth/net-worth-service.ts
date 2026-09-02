import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { calculateNetWorth, type NetWorthComponentInput, type NetWorthStatement } from "@/lib/domain/net-worth/net-worth-engine";
import { money } from "@/lib/domain/money/money";
import type { GoalRepository } from "@/lib/goals/goal-repository";
import { getGoalRepository } from "@/lib/goals/goal-repository";
import {
  type NetWorthCenterView,
  type NetWorthItem,
  type NetWorthItemFields,
  type NetWorthSnapshot,
  parseNetWorthItemFields,
  toNetWorthItemView,
  toNetWorthSnapshotView,
  toNetWorthStatementView,
} from "@/lib/net-worth/net-worth";
import { getNetWorthRepository, type NetWorthRepository } from "@/lib/net-worth/net-worth-repository";
import { manualSectionDomainSchemas } from "@/lib/onboarding/manual-record";
import { getManualRecordRepository, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";
import { InputValidationError } from "@/lib/errors/application-error";

export type NetWorthDependencies = Readonly<{
  accountRepository?: ManualRecordRepository;
  cardRepository?: ManualRecordRepository;
  goalRepository?: GoalRepository;
  loanRepository?: ManualRecordRepository;
  netWorthRepository?: NetWorthRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  savingsRepository?: ManualRecordRepository;
}>;

async function repositories(dependencies?: NetWorthDependencies) {
  return {
    accounts: dependencies?.accountRepository ?? await getManualRecordRepository("accounts"),
    cards: dependencies?.cardRepository ?? await getManualRecordRepository("cards"),
    goals: dependencies?.goalRepository ?? await getGoalRepository(),
    loans: dependencies?.loanRepository ?? await getManualRecordRepository("loans"),
    netWorth: dependencies?.netWorthRepository ?? await getNetWorthRepository(),
    savings: dependencies?.savingsRepository ?? await getManualRecordRepository("savings"),
  };
}

function sourceProvenance(note: string) {
  return { kind: "user_entered" as const, note };
}

async function buildCurrent(
  actor: Actor,
  dependencies?: NetWorthDependencies,
): Promise<Readonly<{
  components: readonly NetWorthComponentInput[];
  items: readonly NetWorthItem[];
  statement: NetWorthStatement;
  sourceOptions: NetWorthCenterView["sourceOptions"];
}>> {
  const profile = await loadProfile(actor, dependencies?.profileRepository === undefined ? undefined : { repository: dependencies.profileRepository });
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required." }]);
  const resolved = await repositories(dependencies);
  const [accountRecords, cardRecords, loanRecords, savingsRecords, items] = await Promise.all([
    resolved.accounts.listAllForActor(actor, 1_000),
    resolved.cards.listAllForActor(actor, 1_000),
    resolved.loans.listAllForActor(actor, 1_000),
    resolved.savings.listAllForActor(actor, 1_000),
    resolved.netWorth.listItemsForActor(actor),
  ]);
  const components: NetWorthComponentInput[] = [];
  for (const record of accountRecords) {
    const fields = manualSectionDomainSchemas.accounts.parse(record.fields);
    const positive = fields.balance.amountMinor >= 0n;
    const accountId = `account:${record.id}`;
    components.push({
      aggregation: fields.type === "savings" && positive
        ? { groupId: "detailed-savings", kind: "fallback" }
        : { kind: "independent" },
      amount: money(positive ? fields.balance.amountMinor : -fields.balance.amountMinor, fields.balance.currency),
      category: positive
        ? fields.type === "investments" ? "investment" : fields.type === "savings" ? "savings" : "cash"
        : "overdraft",
      effectiveAt: record.updatedAt.toISOString(),
      id: accountId,
      label: fields.name,
      liquidity: positive && (fields.type === "bank" || fields.type === "cash") ? "cash" : fields.type === "savings" ? "savings" : "non_cash",
      provenance: sourceProvenance("manual_account_balance"),
      side: positive ? "asset" : "liability",
      sourceId: record.id,
      sourceKind: "account",
      sourceVersion: record.version,
      valuationType: positive && fields.type === "cash" ? "cash_balance" : "account_balance",
    });
  }
  for (const record of savingsRecords) {
    const fields = manualSectionDomainSchemas.savings.parse(record.fields);
    components.push({
      aggregation: { groupId: "detailed-savings", kind: "authority" },
      amount: fields.balance,
      category: "savings",
      effectiveAt: record.updatedAt.toISOString(),
      id: `savings:${record.id}`,
      label: fields.name,
      liquidity: "savings",
      provenance: sourceProvenance("manual_savings_vehicle"),
      side: "asset",
      sourceId: record.id,
      sourceKind: "savings",
      sourceVersion: record.version,
      valuationType: "account_balance",
    });
  }
  for (const record of loanRecords) {
    const fields = manualSectionDomainSchemas.loans.parse(record.fields);
    components.push({
      aggregation: { kind: "liability_candidate", subjectId: `loan:${record.id}` },
      amount: fields.remainingBalance,
      category: "loan",
      effectiveAt: record.updatedAt.toISOString(),
      id: `loan:${record.id}:fallback`,
      label: fields.name,
      liquidity: "non_cash",
      provenance: sourceProvenance("manual_principal_balance_not_exact_payoff"),
      side: "liability",
      sourceId: record.id,
      sourceKind: "loan",
      sourceVersion: record.version,
      valuationType: "principal_balance",
    });
  }
  for (const record of cardRecords) {
    const fields = manualSectionDomainSchemas.cards.parse(record.fields);
    components.push({
      aggregation: { kind: "liability_candidate", subjectId: `credit_card:${record.id}` },
      amount: fields.used,
      category: "credit_card",
      effectiveAt: record.updatedAt.toISOString(),
      id: `credit-card:${record.id}:fallback`,
      label: fields.name,
      liquidity: "non_cash",
      provenance: sourceProvenance("manual_posted_outstanding_balance"),
      side: "liability",
      sourceId: record.id,
      sourceKind: "credit_card",
      sourceVersion: record.version,
      valuationType: "outstanding_balance",
    });
  }
  for (const item of items) {
    const relationship = item.fields.relationship;
    components.push({
      aggregation: relationship.kind === "standalone"
        ? { kind: "independent" }
        : relationship.kind === "account_detail"
          ? { kind: "account_detail", mode: relationship.aggregationMode, parentComponentId: `account:${relationship.accountId}` }
          : { kind: "liability_candidate", subjectId: `${relationship.recordKind}:${relationship.recordId}` },
      amount: item.fields.amount,
      category: item.fields.category,
      effectiveAt: item.fields.effectiveAt,
      id: `net-worth-item:${item.id}`,
      label: item.fields.label,
      liquidity: item.fields.category === "cash" ? "cash" : item.fields.category === "savings" ? "savings" : "non_cash",
      provenance: item.fields.provenance,
      side: item.fields.side,
      sourceId: item.id,
      sourceKind: "net_worth_item",
      sourceVersion: item.version,
      valuationType: item.fields.valuationType,
    });
  }
  const now = (dependencies?.now ?? (() => new Date()))();
  return {
    components,
    items,
    sourceOptions: {
      accounts: accountRecords.map((record) => ({ id: record.id, label: manualSectionDomainSchemas.accounts.parse(record.fields).name, version: record.version })),
      cards: cardRecords.map((record) => ({ id: record.id, label: manualSectionDomainSchemas.cards.parse(record.fields).name, version: record.version })),
      loans: loanRecords.map((record) => ({ id: record.id, label: manualSectionDomainSchemas.loans.parse(record.fields).name, version: record.version })),
    },
    statement: calculateNetWorth({ asOf: now.toISOString(), components, timeZone: profile.fields.timeZone }),
  };
}

async function captureMaterialChange(actor: Actor, dependencies?: NetWorthDependencies): Promise<NetWorthSnapshot> {
  const current = await buildCurrent(actor, dependencies);
  const repository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  return repository.captureSnapshotForActor(actor, current.statement, "material_change");
}

export async function createNetWorthItem(
  actor: Actor,
  input: unknown,
  idempotencyKey: string,
  dependencies?: NetWorthDependencies,
): Promise<Readonly<{ item: NetWorthItem; snapshot: NetWorthSnapshot }>> {
  const repository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  const item = await repository.createItemForActor(actor, parseNetWorthItemFields(input), idempotencyKey);
  return { item, snapshot: await captureMaterialChange(actor, dependencies) };
}

export async function updateNetWorthItem(
  actor: Actor,
  id: string,
  expectedVersion: number,
  input: unknown,
  dependencies?: NetWorthDependencies,
): Promise<Readonly<{ item: NetWorthItem; snapshot: NetWorthSnapshot }>> {
  const repository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  const item = await repository.updateItemForActor(actor, id, expectedVersion, parseNetWorthItemFields(input));
  return { item, snapshot: await captureMaterialChange(actor, dependencies) };
}

export async function deleteNetWorthItem(
  actor: Actor,
  id: string,
  expectedVersion: number,
  dependencies?: NetWorthDependencies,
): Promise<NetWorthSnapshot> {
  const repository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  await repository.deleteItemForActor(actor, id, expectedVersion);
  return captureMaterialChange(actor, dependencies);
}

export async function captureExplicitNetWorthSnapshot(actor: Actor, dependencies?: NetWorthDependencies): Promise<NetWorthSnapshot> {
  const current = await buildCurrent(actor, dependencies);
  const repository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  return repository.captureSnapshotForActor(actor, current.statement, "explicit");
}

export async function loadNetWorthCenter(actor: Actor, dependencies?: NetWorthDependencies): Promise<NetWorthCenterView> {
  const current = await buildCurrent(actor, dependencies);
  const resolved = await repositories(dependencies);
  const [snapshots, definitions] = await Promise.all([
    resolved.netWorth.listSnapshotsForActor(actor, { limit: 20 }),
    resolved.goals.listAllDefinitionsForActor(actor),
  ]);
  const latestDefinitions = new Map<string, (typeof definitions)[number]>();
  for (const definition of definitions) {
    const prior = latestDefinitions.get(definition.goalId);
    if (prior === undefined || definition.version > prior.version) latestDefinitions.set(definition.goalId, definition);
  }
  const goalLinks: NetWorthCenterView["goalLinks"][number][] = [];
  for (const definition of latestDefinitions.values()) {
    const configuration = definition.configuration;
    if (configuration.kind !== "emergency_fund" && configuration.kind !== "savings_target") continue;
    for (const sourceId of configuration.fundScope.recordIds) {
      goalLinks.push({
        goalId: definition.goalId,
        goalVersion: definition.version,
        sourceId,
        sourceKind: configuration.fundScope.source === "accounts" ? "account" : "savings",
      });
    }
  }
  return {
    current: toNetWorthStatementView(current.statement),
    goalLinks,
    items: current.items.map(toNetWorthItemView),
    snapshots: snapshots.snapshots.map(toNetWorthSnapshotView),
    sourceOptions: current.sourceOptions,
  };
}

export async function listNetWorthSnapshots(
  actor: Actor,
  request: Readonly<{ cursor?: string | undefined; limit: number }>,
  dependencies?: NetWorthDependencies,
) {
  const repository = dependencies?.netWorthRepository ?? await getNetWorthRepository();
  return repository.listSnapshotsForActor(actor, request);
}

export type { NetWorthItemFields };
