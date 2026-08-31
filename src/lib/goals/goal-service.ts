import "server-only";

import { createHash } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import type { BudgetRepository } from "@/lib/budgets/budget-repository";
import { getBudgetRepository } from "@/lib/budgets/budget-repository";
import type { BudgetView } from "@/lib/budgets/budget";
import { loadBudgetView } from "@/lib/budgets/budget-service";
import { calendarDateAtInstant, calendarMonth } from "@/lib/domain/financial-engine/financial-calendar";
import {
  addMoney,
  compareMoney,
  money,
  multiplyMoneyByRatio,
  serializeMoney,
  type Money,
} from "@/lib/domain/money/money";
import { calculateGoalProgress, newlyCrossedMilestones } from "@/lib/domain/goals/goal-engine";
import { ConflictError, InputValidationError } from "@/lib/errors/application-error";
import type { FinancialEngineSnapshotRepository } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { getFinancialEngineSnapshotRepository } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import {
  toGoalDefinitionView,
  toGoalProgressEvidenceView,
  type CreateGoalDefinitionCommand,
  type EvaluateGoalCommand,
  type GoalCenterView,
  type GoalDefinition,
  type GoalDefinitionConfiguration,
  type GoalDirection,
  type GoalEvidenceSource,
  type GoalMetricFact,
  type GoalProgressEvidence,
  type GoalProgressResult,
  type GoalVerification,
} from "@/lib/goals/goal";
import { getGoalRepository, type GoalRepository } from "@/lib/goals/goal-repository";
import { manualSectionDomainSchemas, type ManualRecord } from "@/lib/onboarding/manual-record";
import { getManualRecordRepository, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

type GoalSourceSection = "accounts" | "cards" | "goals" | "loans" | "savings";

export type GoalDependencies = Readonly<{
  budgetRepository?: BudgetRepository;
  budgetViewLoader?: (actor: Actor, calendarMonth: string) => Promise<BudgetView>;
  engineRepository?: FinancialEngineSnapshotRepository;
  goalRepository?: GoalRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  sourceRepositories?: Readonly<Partial<Record<GoalSourceSection, ManualRecordRepository>>>;
}>;

type ResolvedDependencies = Readonly<{
  budgetRepository: BudgetRepository;
  budgetViewLoader: (actor: Actor, calendarMonth: string) => Promise<BudgetView>;
  engineRepository: FinancialEngineSnapshotRepository;
  goalRepository: GoalRepository;
  now: () => Date;
  repositories: Readonly<Record<GoalSourceSection, ManualRecordRepository>>;
}>;

type MetricSnapshot = Readonly<{
  currentValue: Money;
  direction: GoalDirection;
  metricFacts: readonly GoalMetricFact[];
  sourceReferences: readonly GoalEvidenceSource[];
  successConditionMet?: boolean | undefined;
  sustainedSuccessDays: number;
  targetValue: Money;
  verification: GoalVerification;
}>;

async function resolveDependencies(dependencies?: GoalDependencies): Promise<ResolvedDependencies> {
  const repositoryEntries = await Promise.all(
    (["accounts", "cards", "goals", "loans", "savings"] as const).map(async (section) => [
      section,
      dependencies?.sourceRepositories?.[section] ?? (await getManualRecordRepository(section)),
    ] as const),
  );
  return {
    budgetRepository: dependencies?.budgetRepository ?? (await getBudgetRepository()),
    budgetViewLoader: dependencies?.budgetViewLoader ?? ((actor, month) => loadBudgetView(actor, month)),
    engineRepository: dependencies?.engineRepository ?? (await getFinancialEngineSnapshotRepository()),
    goalRepository: dependencies?.goalRepository ?? (await getGoalRepository()),
    now: dependencies?.now ?? (() => new Date()),
    repositories: Object.fromEntries(repositoryEntries) as Record<GoalSourceSection, ManualRecordRepository>,
  };
}

function zero(currency: string): Money {
  return money(0n, currency);
}

function sum(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => addMoney(total, value), zero(currency));
}

function sourceReference(record: ManualRecord): GoalEvidenceSource {
  return { id: record.id, kind: "manual_record", version: record.version };
}

async function scopedRecords(
  actor: Actor,
  repository: ManualRecordRepository,
  ids: readonly string[],
  field: string,
): Promise<readonly ManualRecord[]> {
  const records = await repository.listAllForActor(actor);
  const byId = new Map(records.map((record) => [record.id, record]));
  const selected = ids.map((id) => byId.get(id));
  if (selected.some((record) => record === undefined)) {
    throw new InputValidationError([{ field, message: "Every scoped record must belong to the authenticated user." }]);
  }
  return selected as readonly ManualRecord[];
}

function validateCurrency(values: readonly Money[], currency: string, field = "currency"): void {
  if (values.some((value) => value.currency !== currency)) {
    throw new InputValidationError([{ field, message: `Use the profile currency ${currency}.` }]);
  }
}

function goalFields(record: ManualRecord) {
  return manualSectionDomainSchemas.goals.parse(record.fields);
}

function accountFields(record: ManualRecord) {
  return manualSectionDomainSchemas.accounts.parse(record.fields);
}

function cardFields(record: ManualRecord) {
  return manualSectionDomainSchemas.cards.parse(record.fields);
}

function loanFields(record: ManualRecord) {
  return manualSectionDomainSchemas.loans.parse(record.fields);
}

function savingsFields(record: ManualRecord) {
  return manualSectionDomainSchemas.savings.parse(record.fields);
}

function configurationMoney(configuration: GoalDefinitionConfiguration): readonly Money[] {
  switch (configuration.kind) {
    case "emergency_fund":
      return configuration.targetBasis.kind === "explicit_amount" ? [configuration.targetBasis.amount] : [];
    case "savings_target":
      return [configuration.targetAmount];
    case "monthly_spending":
      return [configuration.spendingCeiling];
    case "custom":
      return [configuration.targetAmount];
    default:
      return [];
  }
}

async function assertConfigurationScope(
  actor: Actor,
  configuration: GoalDefinitionConfiguration,
  resolved: ResolvedDependencies,
): Promise<void> {
  switch (configuration.kind) {
    case "debt_free":
      await scopedRecords(actor, resolved.repositories.loans, configuration.liabilityIds, "configuration.liabilityIds");
      return;
    case "no_overdraft":
      await scopedRecords(actor, resolved.repositories.accounts, configuration.accountIds, "configuration.accountIds");
      return;
    case "no_credit_dependency":
      await Promise.all([
        scopedRecords(actor, resolved.repositories.accounts, configuration.accountIds, "configuration.accountIds"),
        configuration.cardIds.length === 0 ? Promise.resolve([]) : scopedRecords(actor, resolved.repositories.cards, configuration.cardIds, "configuration.cardIds"),
        configuration.liabilityIds.length === 0 ? Promise.resolve([]) : scopedRecords(actor, resolved.repositories.loans, configuration.liabilityIds, "configuration.liabilityIds"),
      ]);
      return;
    case "emergency_fund":
    case "savings_target": {
      const repository = configuration.fundScope.source === "accounts"
        ? resolved.repositories.accounts
        : resolved.repositories.savings;
      const records = await scopedRecords(actor, repository, configuration.fundScope.recordIds, "configuration.fundScope.recordIds");
      if (
        configuration.kind === "emergency_fund" &&
        configuration.fundScope.source === "savings" &&
        records.some((record) => savingsFields(record).availability !== "liquid")
      ) {
        throw new InputValidationError([{ field: "configuration.fundScope", message: "Emergency funds may include only verified liquid savings." }]);
      }
      return;
    }
    case "monthly_spending":
    case "custom":
      return;
  }
}

function goalTypeMatches(configuration: GoalDefinitionConfiguration, type: string): boolean {
  return configuration.kind === type;
}

async function fundMetric(
  actor: Actor,
  configuration: Extract<GoalDefinitionConfiguration, { kind: "emergency_fund" | "savings_target" }>,
  currency: string,
  resolved: ResolvedDependencies,
): Promise<Readonly<{ facts: readonly GoalMetricFact[]; references: readonly GoalEvidenceSource[]; value: Money }>> {
  const repository = configuration.fundScope.source === "accounts"
    ? resolved.repositories.accounts
    : resolved.repositories.savings;
  const records = await scopedRecords(actor, repository, configuration.fundScope.recordIds, "configuration.fundScope.recordIds");
  const values = records.map((record) =>
    configuration.fundScope.source === "accounts"
      ? accountFields(record).balance
      : savingsFields(record).balance,
  );
  validateCurrency(values, currency);
  return {
    facts: records.map((record, index) => ({ key: `fund:${record.id}`, value: values[index] ?? zero(currency) })),
    references: records.map(sourceReference),
    value: sum(values, currency),
  };
}

async function emergencyTarget(
  actor: Actor,
  configuration: Extract<GoalDefinitionConfiguration, { kind: "emergency_fund" }>,
  currency: string,
  evaluationMonth: string,
  resolved: ResolvedDependencies,
): Promise<Readonly<{ facts: readonly GoalMetricFact[]; reference: GoalEvidenceSource | null; target: Money; verification: GoalVerification }>> {
  if (configuration.targetBasis.kind === "explicit_amount") {
    validateCurrency([configuration.targetBasis.amount], currency);
    return { facts: [], reference: null, target: configuration.targetBasis.amount, verification: "verified" };
  }
  const periods = await resolved.budgetRepository.listPeriodsForActor(actor);
  const period = periods.filter(
    (candidate) => candidate.status === "closed" && candidate.calendarMonth <= evaluationMonth,
  ).at(-1);
  if (period?.closingSnapshot === null || period?.closingSnapshot === undefined) {
    return { facts: [], reference: null, target: zero(currency), verification: "insufficient_data" };
  }
  const selected = new Set(configuration.targetBasis.essentialCategoryIds);
  const basis = sum(
    period.closingSnapshot.lines.filter((line) => selected.has(line.categoryId)).map((line) => line.spent),
    currency,
  );
  const target = multiplyMoneyByRatio(basis, BigInt(configuration.targetBasis.months), 1n);
  return {
    facts: [{ key: "essential_expense_monthly_basis", value: basis }],
    reference: { id: period.id, kind: "budget_period", version: period.version },
    target,
    verification: "verified",
  };
}

function previousFact(previous: GoalProgressEvidence | null, key: string): Money | null {
  return previous?.metricFacts.find((fact) => fact.key === key)?.value ?? null;
}

async function metricSnapshot(
  actor: Actor,
  definition: GoalDefinition,
  currency: string,
  evaluationMonth: string,
  previous: GoalProgressEvidence | null,
  manualCurrentValue: Money | undefined,
  resolved: ResolvedDependencies,
): Promise<MetricSnapshot> {
  const configuration = definition.configuration;
  switch (configuration.kind) {
    case "debt_free": {
      const records = await scopedRecords(actor, resolved.repositories.loans, configuration.liabilityIds, "configuration.liabilityIds");
      const values = records.map((record) => loanFields(record).remainingBalance);
      validateCurrency(values, currency);
      return {
        currentValue: sum(values, currency),
        direction: "decrease",
        metricFacts: records.map((record, index) => ({ key: `liability:${record.id}`, value: values[index] ?? zero(currency) })),
        sourceReferences: records.map(sourceReference),
        sustainedSuccessDays: 0,
        targetValue: zero(currency),
        verification: "verified",
      };
    }
    case "no_overdraft": {
      const records = await scopedRecords(actor, resolved.repositories.accounts, configuration.accountIds, "configuration.accountIds");
      const values = records.map((record) => accountFields(record).balance);
      validateCurrency(values, currency);
      return {
        currentValue: sum(values, currency),
        direction: "increase",
        metricFacts: records.map((record, index) => ({ key: `account:${record.id}`, value: values[index] ?? zero(currency) })),
        sourceReferences: records.map(sourceReference),
        sustainedSuccessDays: configuration.sustainedSuccessDays,
        targetValue: zero(currency),
        verification: "verified",
      };
    }
    case "no_credit_dependency": {
      const [accounts, cards, liabilities, enginePage] = await Promise.all([
        scopedRecords(actor, resolved.repositories.accounts, configuration.accountIds, "configuration.accountIds"),
        configuration.cardIds.length === 0 ? Promise.resolve([]) : scopedRecords(actor, resolved.repositories.cards, configuration.cardIds, "configuration.cardIds"),
        configuration.liabilityIds.length === 0 ? Promise.resolve([]) : scopedRecords(actor, resolved.repositories.loans, configuration.liabilityIds, "configuration.liabilityIds"),
        resolved.engineRepository.listForActor(actor, { limit: 1 }),
      ]);
      const engine = enginePage.snapshots[0] ?? null;
      if (engine === null || engine.result.horizonDays < configuration.horizonDays) {
        return {
          currentValue: definition.reportedEvidence.currentValue,
          direction: "decrease",
          metricFacts: [],
          sourceReferences: [],
          sustainedSuccessDays: configuration.sustainedSuccessDays,
          targetValue: zero(currency),
          verification: "insufficient_data",
        };
      }
      const accountBalance = sum(accounts.map((record) => accountFields(record).balance), currency);
      const creditUsed = sum(cards.map((record) => cardFields(record).used), currency);
      const liabilityBalance = sum(liabilities.map((record) => loanFields(record).remainingBalance), currency);
      validateCurrency([accountBalance, creditUsed, liabilityBalance, engine.result.shortfall, engine.result.minimumConfirmedBalance], currency);
      const overdraftExposure = accountBalance.amountMinor < 0n ? money(-accountBalance.amountMinor, currency) : zero(currency);
      const currentValue = addMoney(engine.result.shortfall, overdraftExposure);
      const priorCredit = previousFact(previous, "credit_used");
      const priorLiability = previousFact(previous, "liability_balance");
      const nonIncreasingDependence =
        (priorCredit === null || compareMoney(creditUsed, priorCredit) <= 0) &&
        (priorLiability === null || compareMoney(liabilityBalance, priorLiability) <= 0);
      return {
        currentValue,
        direction: "decrease",
        metricFacts: [
          { key: "scoped_account_balance", value: accountBalance },
          { key: "credit_used", value: creditUsed },
          { key: "liability_balance", value: liabilityBalance },
          { key: "engine_shortfall", value: engine.result.shortfall },
          { key: "engine_minimum_confirmed_balance", value: engine.result.minimumConfirmedBalance },
        ],
        sourceReferences: [
          ...accounts.map(sourceReference),
          ...cards.map(sourceReference),
          ...liabilities.map(sourceReference),
          { id: engine.id, kind: "engine_snapshot", version: null },
        ],
        successConditionMet:
          currentValue.amountMinor === 0n &&
          engine.result.minimumConfirmedBalance.amountMinor >= 0n &&
          accountBalance.amountMinor >= 0n &&
          nonIncreasingDependence,
        sustainedSuccessDays: configuration.sustainedSuccessDays,
        targetValue: zero(currency),
        verification: "verified",
      };
    }
    case "emergency_fund": {
      const [fund, target] = await Promise.all([
        fundMetric(actor, configuration, currency, resolved),
        emergencyTarget(actor, configuration, currency, evaluationMonth, resolved),
      ]);
      return {
        currentValue: fund.value,
        direction: "increase",
        metricFacts: [...fund.facts, ...target.facts],
        sourceReferences: [...fund.references, ...(target.reference === null ? [] : [target.reference])],
        sustainedSuccessDays: 0,
        targetValue: target.target,
        verification: target.verification,
      };
    }
    case "savings_target": {
      const fund = await fundMetric(actor, configuration, currency, resolved);
      validateCurrency([configuration.targetAmount], currency);
      return {
        currentValue: fund.value,
        direction: "increase",
        metricFacts: fund.facts,
        sourceReferences: fund.references,
        sustainedSuccessDays: 0,
        targetValue: configuration.targetAmount,
        verification: "verified",
      };
    }
    case "monthly_spending": {
      const view = await resolved.budgetViewLoader(actor, evaluationMonth);
      const selected = new Set(configuration.categoryIds);
      const current = sum(
        view.calculation.lines
          .filter((line) => selected.has(line.categoryId))
          .map((line) => money(BigInt(line.spent.amountMinor), line.spent.currency)),
        currency,
      );
      validateCurrency([configuration.spendingCeiling, current], currency);
      const activityReferences = view.activities
        .filter((activity) => activity.categoryId !== null && selected.has(activity.categoryId))
        .map((activity) => ({ id: activity.id, kind: "manual_record" as const, version: null }));
      return {
        currentValue: current,
        direction: "decrease",
        metricFacts: [{ key: "qualifying_period_spending", value: current }],
        sourceReferences: [
          ...activityReferences,
          ...(view.period.id === null ? [] : [{ id: view.period.id, kind: "budget_period" as const, version: view.period.version }]),
        ],
        successConditionMet: view.period.status === "closed" && compareMoney(current, configuration.spendingCeiling) <= 0,
        sustainedSuccessDays: 0,
        targetValue: configuration.spendingCeiling,
        verification: "verified",
      };
    }
    case "custom": {
      const current = manualCurrentValue ?? definition.reportedEvidence.currentValue;
      validateCurrency([configuration.targetAmount, current], currency);
      return {
        currentValue: current,
        direction: configuration.direction,
        metricFacts: [{ key: `manual:${configuration.metricLabel}`, value: current }],
        sourceReferences: [{ id: definition.goalId, kind: "goal_record", version: definition.reportedEvidence.goalRecordVersion }],
        sustainedSuccessDays: 0,
        targetValue: configuration.targetAmount,
        verification: "manual_unverified",
      };
    }
  }
}

function hashEvidence(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Date) return item.toISOString();
    return item;
  }), "utf8").digest("hex");
}

async function evaluateDefinition(
  actor: Actor,
  definition: GoalDefinition,
  command: EvaluateGoalCommand,
  reason: GoalProgressEvidence["reason"],
  profile: NonNullable<Awaited<ReturnType<typeof loadProfile>>>,
  resolved: ResolvedDependencies,
): Promise<GoalProgressEvidence> {
  const evaluatedAt = resolved.now();
  if (Number.isNaN(evaluatedAt.valueOf())) throw new InputValidationError([{ field: "evaluatedAt", message: "Evaluation time is invalid." }]);
  const evaluationDate = calendarDateAtInstant(evaluatedAt.toISOString(), profile.fields.timeZone);
  const [history, idempotentRetry] = await Promise.all([
    resolved.goalRepository.listProgressForActor(actor, definition.goalId, definition.version),
    resolved.goalRepository.findProgressByIdempotencyKeyForActor(actor, command.idempotencyKey),
  ]);
  if (
    idempotentRetry !== null &&
    (idempotentRetry.goalId !== definition.goalId || idempotentRetry.goalVersion !== definition.version)
  ) {
    throw new ConflictError("The idempotency key was already used for another goal evaluation.");
  }
  const precedingHistory = idempotentRetry === null
    ? history
    : history.filter((entry) => entry.id !== idempotentRetry.id);
  const latest = precedingHistory[0] ?? null;
  if (latest !== null && evaluatedAt < latest.evaluatedAt) {
    throw new ConflictError("Goal evaluations must not precede existing immutable evidence.");
  }
  const metric = await metricSnapshot(
    actor,
    definition,
    profile.fields.primaryCurrency,
    calendarMonth(evaluationDate),
    latest,
    command.manualCurrentValue,
    resolved,
  );
  validateCurrency([metric.currentValue, metric.targetValue], profile.fields.primaryCurrency);
  const priorVerified = precedingHistory.find((entry) => entry.result.verification === "verified") ?? null;
  const baselineValue = metric.verification === "verified"
    ? priorVerified?.result.baselineValue ?? metric.currentValue
    : metric.verification === "manual_unverified"
      ? definition.reportedEvidence.startingValue
      : definition.reportedEvidence.startingValue;
  const previousResult: GoalProgressResult | null =
    latest?.result.verification === metric.verification ? latest.result : null;
  const result = calculateGoalProgress({
    baselineValue,
    currentValue: metric.currentValue,
    direction: metric.direction,
    evaluationDate,
    previous: previousResult,
    successConditionMet: metric.successConditionMet,
    sustainedSuccessDays: metric.sustainedSuccessDays,
    targetValue: metric.targetValue,
    verification: metric.verification,
  });
  const recordedMilestones = precedingHistory.flatMap((entry) => entry.milestonesCrossed);
  const milestonesCrossed = metric.verification === "verified"
    ? newlyCrossedMilestones(result.normalizedProgressBasisPoints, recordedMilestones)
    : [];
  const evidenceHash = hashEvidence({
    currentValue: metric.currentValue,
    definitionId: definition.id,
    direction: metric.direction,
    evaluationDate,
    metricFacts: metric.metricFacts,
    sourceReferences: metric.sourceReferences,
    successConditionMet: metric.successConditionMet,
    sustainedSuccessDays: metric.sustainedSuccessDays,
    targetValue: metric.targetValue,
    verification: metric.verification,
  });
  return resolved.goalRepository.createProgressForActor(actor, {
    evaluatedAt,
    evaluationDate,
    evidenceHash,
    goalDefinitionId: definition.id,
    goalId: definition.goalId,
    goalVersion: definition.version,
    metricFacts: metric.metricFacts,
    milestonesCrossed,
    reason,
    result,
    sourceReferences: metric.sourceReferences,
    timeZone: profile.fields.timeZone,
  }, command.idempotencyKey);
}

export async function createGoalDefinition(
  actor: Actor,
  command: CreateGoalDefinitionCommand,
  dependencies?: GoalDependencies,
): Promise<Readonly<{ definition: GoalDefinition; progress: GoalProgressEvidence }>> {
  const resolved = await resolveDependencies(dependencies);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined ? undefined : { repository: dependencies.profileRepository },
  );
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required for goals." }]);
  const goal = await resolved.repositories.goals.findForActor(actor, command.goalId);
  if (goal === null) throw new ConflictError();
  if (goal.version !== command.expectedGoalRecordVersion) throw new ConflictError();
  const fields = goalFields(goal);
  if (!goalTypeMatches(command.configuration, fields.type)) {
    throw new InputValidationError([{ field: "configuration.kind", message: "The metric must match the goal type." }]);
  }
  validateCurrency(
    [fields.startingValue, fields.currentValue, fields.targetAmount, ...configurationMoney(command.configuration)],
    profile.fields.primaryCurrency,
  );
  await assertConfigurationScope(actor, command.configuration, resolved);
  const definitionBeforeCommand = await resolved.goalRepository.findLatestDefinitionForActor(
    actor,
    goal.id,
  );
  const definition = await resolved.goalRepository.createDefinitionVersionForActor(actor, {
    configuration: command.configuration,
    expectedDefinitionVersion: command.expectedDefinitionVersion,
    goalId: goal.id,
    reportedEvidence: {
      capturedAt: goal.updatedAt,
      currentValue: fields.currentValue,
      goalRecordVersion: goal.version,
      startingValue: fields.startingValue,
      targetAmount: fields.targetAmount,
    },
    targetDate: command.targetDate,
  }, command.idempotencyKey);
  if (definitionBeforeCommand?.id === definition.id) {
    const existingProgress = await resolved.goalRepository.findLatestProgressForActor(
      actor,
      definition.goalId,
      definition.version,
    );
    if (existingProgress !== null) return { definition, progress: existingProgress };
  }
  const progress = await evaluateDefinition(
    actor,
    definition,
    { goalId: goal.id, idempotencyKey: `${command.idempotencyKey}:baseline` },
    definition.version === 1 ? "baseline_established" : "material_version_created",
    profile,
    resolved,
  );
  return { definition, progress };
}

export async function evaluateGoal(
  actor: Actor,
  command: EvaluateGoalCommand,
  dependencies?: GoalDependencies,
): Promise<GoalProgressEvidence> {
  const resolved = await resolveDependencies(dependencies);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined ? undefined : { repository: dependencies.profileRepository },
  );
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required for goals." }]);
  const definition = await resolved.goalRepository.findLatestDefinitionForActor(actor, command.goalId);
  if (definition === null) throw new ConflictError("Activate goal tracking before evaluation.");
  return evaluateDefinition(actor, definition, command, "evaluation", profile, resolved);
}

function option(record: ManualRecord, label: string, amount: Money, metadata: string) {
  return { amount: serializeMoney(amount), id: record.id, label, metadata };
}

export async function loadGoalCenterView(
  actor: Actor,
  dependencies?: GoalDependencies,
): Promise<GoalCenterView> {
  const resolved = await resolveDependencies(dependencies);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined ? undefined : { repository: dependencies.profileRepository },
  );
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required for goals." }]);
  const [goals, accounts, cards, liabilities, savings, definitions, categories] = await Promise.all([
    resolved.repositories.goals.listAllForActor(actor, 50),
    resolved.repositories.accounts.listAllForActor(actor, 50),
    resolved.repositories.cards.listAllForActor(actor, 50),
    resolved.repositories.loans.listAllForActor(actor, 50),
    resolved.repositories.savings.listAllForActor(actor, 50),
    resolved.goalRepository.listLatestDefinitionsForActor(actor, 50),
    resolved.budgetRepository.listCategoriesForActor(actor),
  ]);
  const definitionsByGoal = new Map(definitions.map((definition) => [definition.goalId, definition]));
  const items = await Promise.all(goals.map(async (record) => {
    const fields = goalFields(record);
    const definition = definitionsByGoal.get(record.id) ?? null;
    const history = definition === null
      ? []
      : await resolved.goalRepository.listProgressForActor(actor, record.id, definition.version, 50);
    return {
      definition: definition === null ? null : toGoalDefinitionView(definition),
      history: history.map(toGoalProgressEvidenceView),
      latestProgress: history[0] === undefined ? null : toGoalProgressEvidenceView(history[0]),
      reported: {
        currentValue: serializeMoney(fields.currentValue),
        id: record.id,
        priority: fields.priority,
        startingValue: serializeMoney(fields.startingValue),
        targetAmount: serializeMoney(fields.targetAmount),
        targetDate: fields.targetDate,
        title: fields.title,
        type: fields.type,
        version: record.version,
      },
    };
  }));
  return {
    categories: categories.map((category) => ({
      id: category.categoryId,
      label: category.label,
      systemKey: category.systemKey,
    })),
    currency: profile.fields.primaryCurrency,
    goals: items.sort((left, right) => left.reported.priority - right.reported.priority),
    sources: {
      accounts: accounts.map((record) => {
        const fields = accountFields(record);
        return option(record, fields.name, fields.balance, fields.type);
      }),
      cards: cards.map((record) => {
        const fields = cardFields(record);
        return option(record, fields.name, fields.used, fields.issuer);
      }),
      liabilities: liabilities.map((record) => {
        const fields = loanFields(record);
        return option(record, fields.name, fields.remainingBalance, "loan");
      }),
      savings: savings.map((record) => {
        const fields = savingsFields(record);
        return option(record, fields.name, fields.balance, fields.availability);
      }),
    },
  };
}
