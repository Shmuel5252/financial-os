import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  systemCategoryId,
  toBudgetAllocationView,
  toBudgetCalculationView,
  toBudgetScenarioView,
  validateBudgetMoneyCurrency,
  type BudgetActivity,
  type BudgetAllocation,
  type BudgetCategory,
  type BudgetCorrection,
  type BudgetPlannedOutflow,
  type BudgetScenarioResult,
  type BudgetScenarioView,
  type BudgetView,
  type RolloverPolicy,
} from "@/lib/budgets/budget";
import {
  budgetCorrectionState,
  effectiveTransactionCategory,
  sourceBudgetCategoryId,
} from "@/lib/budgets/category-projection";
import {
  getBudgetRepository,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import {
  calendarDateAtInstant,
  calendarMonth,
  lastCalendarDateOfMonth,
} from "@/lib/domain/financial-engine/financial-calendar";
import { expandRecurrence } from "@/lib/domain/financial-engine/financial-schedule";
import {
  addMoney,
  money,
  serializeMoney,
  subtractMoney,
  type Money,
} from "@/lib/domain/money/money";
import {
  calculateBudget,
  calculateBudgetScenario,
} from "@/lib/domain/budgets/budget-engine";
import {
  ConflictError,
  InputValidationError,
} from "@/lib/errors/application-error";
import {
  getFinancialEngineSnapshotRepository,
  type FinancialEngineSnapshotRepository,
} from "@/lib/financial-engine/financial-engine-snapshot-repository";
import type { ManualRecord } from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

const budgetSourceSections = [
  "expenses",
  "income",
  "loans",
  "recurring_transactions",
  "transactions",
] as const;

type BudgetSourceSection = (typeof budgetSourceSections)[number];

export type BudgetDependencies = Readonly<{
  budgetRepository?: BudgetRepository;
  engineRepository?: FinancialEngineSnapshotRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  sourceRepositories?: Readonly<
    Partial<Record<BudgetSourceSection, ManualRecordRepository>>
  >;
}>;

type TransactionFields = Readonly<{
  amount: Money;
  category: string;
  confidenceBps: number;
  date: string;
  merchant: string | null;
  refundOfTransactionId: string | null;
  type: "expense" | "income" | "refund" | "transfer";
}>;

type IncomeFields = Readonly<{
  amount: Money;
  certaintyBps: number;
  destination: "bank_account" | "cash" | "investments" | "savings";
  expectedDate: string;
  frequency:
    | "annual"
    | "biweekly"
    | "irregular"
    | "monthly"
    | "one_time"
    | "quarterly"
    | "weekly";
}>;

type ExpenseFields = Readonly<{
  amount: Money;
  category: string;
  frequency: "annual" | "irregular" | "monthly" | "quarterly" | "weekly";
  nextDueDate: string;
}>;

type RecurringTransactionFields = Readonly<{
  active: boolean;
  amount: Money;
  category: string;
  endDate: string | null;
  frequency: "annual" | "biweekly" | "monthly" | "quarterly" | "weekly";
  interval: number;
  nextOccurrenceDate: string;
  type: "expense" | "income";
}>;

type LoanFields = Readonly<{
  endDate: string | null;
  monthlyPayment: Money;
  nextPaymentDate: string;
  remainingBalance: Money;
}>;

type ActivityDetail = BudgetActivity &
  Readonly<{
    correctionCount: number;
    merchant: string | null;
    sourceCategoryId: string | null;
  }>;

function fields<T>(record: ManualRecord): T {
  return record.fields as T;
}

function zero(currency: string): Money {
  return money(0n, currency);
}

function sum(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => addMoney(total, value), zero(currency));
}

function monthStart(value: string): string {
  return `${value}-01`;
}

function previousMonth(value: string): string {
  const [yearText, monthText] = value.split("-");
  const date = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 2, 1),
  );
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function nextMonth(value: string): string {
  const [yearText, monthText] = value.split("-");
  const date = new Date(
    Date.UTC(Number(yearText), Number(monthText), 1),
  );
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

async function resolveDependencies(
  dependencies?: BudgetDependencies,
): Promise<Required<Pick<BudgetDependencies, "budgetRepository">> &
  BudgetDependencies> {
  return {
    ...dependencies,
    budgetRepository:
      dependencies?.budgetRepository ?? (await getBudgetRepository()),
  };
}

async function loadSources(
  actor: Actor,
  dependencies?: BudgetDependencies,
): Promise<Readonly<Record<BudgetSourceSection, readonly ManualRecord[]>>> {
  const entries = await Promise.all(
    budgetSourceSections.map(async (section) => {
      const repository =
        dependencies?.sourceRepositories?.[section] ??
        (await getManualRecordRepository(section));
      return [section, await repository.listAllForActor(actor)] as const;
    }),
  );
  return Object.fromEntries(entries) as Readonly<
    Record<BudgetSourceSection, readonly ManualRecord[]>
  >;
}

function recurrenceDates(
  startDate: string,
  frequency:
    | "annual"
    | "biweekly"
    | "irregular"
    | "monthly"
    | "one_time"
    | "quarterly"
    | "weekly",
  start: string,
  end: string,
  interval = 1,
  endDate: string | null = null,
): readonly string[] {
  return expandRecurrence(
    {
      endDate: endDate as never,
      frequency,
      interval,
      startDate: startDate as never,
    },
    start as never,
    end as never,
  );
}

function buildActivities(
  transactions: readonly ManualRecord[],
  corrections: readonly BudgetCorrection[],
  selectedMonth: string,
): readonly ActivityDetail[] {
  const byId = new Map(transactions.map((record) => [record.id, record]));
  const correctionMap = budgetCorrectionState(corrections);

  return transactions.flatMap((record) => {
    const transaction = fields<TransactionFields>(record);
    if (
      calendarMonth(transaction.date as never) !== selectedMonth ||
      (transaction.type !== "expense" && transaction.type !== "refund")
    ) {
      return [];
    }
    return [
      {
        amount: transaction.amount,
        categoryId: effectiveTransactionCategory(
          record,
          byId,
          correctionMap,
        ),
        correctionCount: correctionMap.get(record.id)?.length ?? 0,
        date: transaction.date,
        id: record.id,
        kind: transaction.type,
        merchant: transaction.merchant,
        sourceCategoryId: sourceBudgetCategoryId(transaction.category),
      } as const,
    ];
  });
}

function monthlyIncome(
  sources: Readonly<Record<BudgetSourceSection, readonly ManualRecord[]>>,
  selectedMonth: string,
  currency: string,
): Readonly<{ confirmed: Money; uncertain: Money }> {
  const start = monthStart(selectedMonth);
  const end = lastCalendarDateOfMonth(start as never);
  const confirmed: Money[] = [];
  const uncertain: Money[] = [];

  for (const record of sources.income) {
    const income = fields<IncomeFields>(record);
    if (income.destination !== "bank_account" && income.destination !== "cash") {
      continue;
    }
    const occurrences = recurrenceDates(
      income.expectedDate,
      income.frequency,
      start,
      end,
    );
    const target = income.certaintyBps === 10_000 ? confirmed : uncertain;
    occurrences.forEach(() => target.push(income.amount));
  }
  for (const record of sources.transactions) {
    const transaction = fields<TransactionFields>(record);
    if (
      transaction.type !== "income" ||
      calendarMonth(transaction.date as never) !== selectedMonth
    ) {
      continue;
    }
    (transaction.confidenceBps === 10_000 ? confirmed : uncertain).push(
      transaction.amount,
    );
  }
  for (const record of sources.recurring_transactions) {
    const recurring = fields<RecurringTransactionFields>(record);
    if (!recurring.active || recurring.type !== "income") {
      continue;
    }
    const occurrences = recurrenceDates(
      recurring.nextOccurrenceDate,
      recurring.frequency,
      start,
      end,
      recurring.interval,
      recurring.endDate,
    );
    occurrences.forEach(() => uncertain.push(recurring.amount));
  }

  return {
    confirmed: sum(confirmed, currency),
    uncertain: sum(uncertain, currency),
  };
}

function shouldForecastDate(
  date: string,
  selectedMonth: string,
  currentMonth: string,
  currentDate: string,
): boolean {
  if (selectedMonth < currentMonth) {
    return false;
  }
  return selectedMonth > currentMonth || date >= currentDate;
}

function plannedOutflows(
  sources: Readonly<Record<BudgetSourceSection, readonly ManualRecord[]>>,
  selectedMonth: string,
  currentMonth: string,
  currentDate: string,
): readonly BudgetPlannedOutflow[] {
  const start = monthStart(selectedMonth);
  const end = lastCalendarDateOfMonth(start as never);
  const result: BudgetPlannedOutflow[] = [];
  for (const record of sources.expenses) {
    const expense = fields<ExpenseFields>(record);
    for (const date of recurrenceDates(
      expense.nextDueDate,
      expense.frequency,
      start,
      end,
    )) {
      if (shouldForecastDate(date, selectedMonth, currentMonth, currentDate)) {
        result.push({
          amount: expense.amount,
          categoryId: sourceBudgetCategoryId(expense.category),
          date,
          id: `expense:${record.id}:${date}`,
        });
      }
    }
  }
  for (const record of sources.recurring_transactions) {
    const recurring = fields<RecurringTransactionFields>(record);
    if (!recurring.active || recurring.type !== "expense") {
      continue;
    }
    for (const date of recurrenceDates(
      recurring.nextOccurrenceDate,
      recurring.frequency,
      start,
      end,
      recurring.interval,
      recurring.endDate,
    )) {
      if (shouldForecastDate(date, selectedMonth, currentMonth, currentDate)) {
        result.push({
          amount: recurring.amount,
          categoryId: sourceBudgetCategoryId(recurring.category),
          date,
          id: `recurring:${record.id}:${date}`,
        });
      }
    }
  }
  for (const record of sources.loans) {
    const loan = fields<LoanFields>(record);
    let remaining = loan.remainingBalance.amountMinor;
    for (const date of recurrenceDates(
      loan.nextPaymentDate,
      "monthly",
      start,
      end,
      1,
      loan.endDate,
    )) {
      if (remaining <= 0n) {
        break;
      }
      const amountMinor =
        loan.monthlyPayment.amountMinor < remaining
          ? loan.monthlyPayment.amountMinor
          : remaining;
      remaining -= amountMinor;
      if (shouldForecastDate(date, selectedMonth, currentMonth, currentDate)) {
        result.push({
          amount: money(amountMinor, loan.monthlyPayment.currency),
          categoryId: systemCategoryId("debt_payment"),
          date,
          id: `loan:${record.id}:${date}`,
        });
      }
    }
  }
  return result;
}

async function carryForNewPeriod(
  actor: Actor,
  selectedMonth: string,
  repository: BudgetRepository,
): Promise<readonly BudgetAllocation[]> {
  const previous = await repository.findPeriodForActor(
    actor,
    previousMonth(selectedMonth),
  );
  if (previous === null) {
    return [];
  }
  if (previous.status !== "closed" || previous.closingSnapshot === null) {
    throw new ConflictError(
      "Close the preceding budget period before creating this month.",
    );
  }
  return previous.closingSnapshot.lines
    .filter((line) => line.carryOut.amountMinor !== 0n)
    .map((line) => ({ amount: line.carryOut, categoryId: line.categoryId }));
}

export async function loadBudgetView(
  actor: Actor,
  selectedMonth: string,
  dependencies?: BudgetDependencies,
): Promise<BudgetView> {
  const resolved = await resolveDependencies(dependencies);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required for budgeting." },
    ]);
  }
  const now = (dependencies?.now ?? (() => new Date()))();
  const currentDate = calendarDateAtInstant(
    now.toISOString(),
    profile.fields.timeZone,
  );
  const currentCalendarMonth = calendarMonth(currentDate);
  const [categories, period, sources, enginePage] = await Promise.all([
    resolved.budgetRepository.listCategoriesForActor(actor),
    resolved.budgetRepository.findPeriodForActor(actor, selectedMonth),
    loadSources(actor, dependencies),
    (dependencies?.engineRepository ??
      (await getFinancialEngineSnapshotRepository())).listForActor(actor, {
      limit: 1,
    }),
  ]);
  const corrections = await resolved.budgetRepository.listCorrectionsForActor(
    actor,
    sources.transactions.map((record) => record.id),
  );
  const activities = buildActivities(
    sources.transactions,
    corrections,
    selectedMonth,
  );
  const incomes = monthlyIncome(
    sources,
    selectedMonth,
    profile.fields.primaryCurrency,
  );
  const carryIn =
    period?.carryIn ??
    (await carryForNewPeriod(actor, selectedMonth, resolved.budgetRepository));
  const calculation = calculateBudget({
    activities,
    allocations: period?.allocations ?? [],
    calendarMonth: selectedMonth,
    carryIn,
    categories,
    confirmedIncome: incomes.confirmed,
    currency: profile.fields.primaryCurrency,
    plannedOutflows: plannedOutflows(
      sources,
      selectedMonth,
      currentCalendarMonth,
      currentDate,
    ),
    uncertainIncome: incomes.uncertain,
  });
  const latestEngine = enginePage.snapshots[0] ?? null;

  return {
    activities: activities.map((activity) => ({
      amount: serializeMoney(activity.amount),
      categoryId: activity.categoryId,
      correctionCount: activity.correctionCount,
      date: activity.date,
      id: activity.id,
      kind: activity.kind,
      merchant: activity.merchant,
      sourceCategoryId: activity.sourceCategoryId,
    })),
    calculation: toBudgetCalculationView(calculation),
    categories,
    coreForecast:
      latestEngine === null
        ? null
        : {
            calculatedAt: latestEngine.calculatedAt.toISOString(),
            confirmedEndingBalance: serializeMoney(
              latestEngine.result.futureConfirmedBalance,
            ),
            evaluationEndDate: latestEngine.result.horizonEndDate,
            safeToSpend: serializeMoney(latestEngine.result.safeToSpend),
            safetyMargin: serializeMoney(
              latestEngine.result.safetyMarginAtEvaluation,
            ),
            shortfall: serializeMoney(latestEngine.result.shortfall),
          },
    currentCalendarMonth,
    period: {
      allocations: (period?.allocations ?? []).map(toBudgetAllocationView),
      calendarMonth: selectedMonth,
      carryIn: carryIn.map(toBudgetAllocationView),
      closedAt: period?.closedAt?.toISOString() ?? null,
      closingSnapshot:
        period?.closingSnapshot === null || period?.closingSnapshot === undefined
          ? null
          : toBudgetCalculationView(period.closingSnapshot),
      currency: profile.fields.primaryCurrency,
      id: period?.id ?? null,
      status: period?.status ?? "open",
      version: period?.version ?? null,
    },
  };
}

export async function createBudgetCategory(
  actor: Actor,
  input: Readonly<{
    idempotencyKey: string;
    label: string;
    rolloverPolicy: RolloverPolicy;
  }>,
  dependencies?: BudgetDependencies,
): Promise<BudgetCategory> {
  const { budgetRepository } = await resolveDependencies(dependencies);
  return budgetRepository.createCustomCategoryForActor(
    actor,
    { label: input.label, rolloverPolicy: input.rolloverPolicy },
    input.idempotencyKey,
  );
}

export async function updateBudgetCategory(
  actor: Actor,
  input: Readonly<{
    categoryId: string;
    expectedVersion: number;
    hidden: boolean;
    label: string;
    rolloverPolicy: RolloverPolicy;
    sortOrder: number;
  }>,
  dependencies?: BudgetDependencies,
): Promise<BudgetCategory> {
  const { budgetRepository } = await resolveDependencies(dependencies);
  const category = await budgetRepository.findCategoryForActor(
    actor,
    input.categoryId,
  );
  if (category === null) {
    throw new ConflictError();
  }
  return budgetRepository.updateCategoryForActor(
    actor,
    input.categoryId,
    input.expectedVersion,
    input,
  );
}

export async function saveBudgetPeriod(
  actor: Actor,
  input: Readonly<{
    allocations: readonly BudgetAllocation[];
    calendarMonth: string;
    expectedVersion: number | null;
  }>,
  dependencies?: BudgetDependencies,
): Promise<BudgetView> {
  const resolved = await resolveDependencies(dependencies);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required for budgeting." },
    ]);
  }
  validateBudgetMoneyCurrency(
    input.allocations.map((allocation) => allocation.amount),
    profile.fields.primaryCurrency,
  );
  const categories = await resolved.budgetRepository.listCategoriesForActor(actor);
  const categoryIds = new Set(categories.map((category) => category.categoryId));
  if (input.allocations.some((allocation) => !categoryIds.has(allocation.categoryId))) {
    throw new InputValidationError([
      {
        field: "allocations.categoryId",
        message: "Every budget category must belong to the authenticated user.",
      },
    ]);
  }
  if (
    await resolved.budgetRepository.findPeriodForActor(
      actor,
      nextMonth(input.calendarMonth),
    )
  ) {
    throw new ConflictError(
      "A later period already exists; preserve its frozen rollover chain.",
    );
  }
  const existing = await resolved.budgetRepository.findPeriodForActor(
    actor,
    input.calendarMonth,
  );
  const carryIn =
    existing?.carryIn ??
    (await carryForNewPeriod(
      actor,
      input.calendarMonth,
      resolved.budgetRepository,
    ));
  await resolved.budgetRepository.savePeriodForActor(actor, {
    ...input,
    carryIn,
    currency: profile.fields.primaryCurrency,
  });
  return loadBudgetView(actor, input.calendarMonth, dependencies);
}

export async function closeBudgetPeriod(
  actor: Actor,
  input: Readonly<{ calendarMonth: string; expectedVersion: number }>,
  dependencies?: BudgetDependencies,
): Promise<BudgetView> {
  const resolved = await resolveDependencies(dependencies);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required for budgeting." },
    ]);
  }
  const currentDate = calendarDateAtInstant(
    (dependencies?.now ?? (() => new Date()))().toISOString(),
    profile.fields.timeZone,
  );
  if (input.calendarMonth >= calendarMonth(currentDate)) {
    throw new InputValidationError([
      {
        field: "calendarMonth",
        message: "Only completed calendar months may be closed.",
      },
    ]);
  }
  if (
    await resolved.budgetRepository.findPeriodForActor(
      actor,
      nextMonth(input.calendarMonth),
    )
  ) {
    throw new ConflictError(
      "A later budget period already exists and its rollover must remain stable.",
    );
  }
  const view = await loadBudgetView(actor, input.calendarMonth, dependencies);
  await resolved.budgetRepository.closePeriodForActor(
    actor,
    input.calendarMonth,
    input.expectedVersion,
    {
      allocated: money(
        BigInt(view.calculation.allocated.amountMinor),
        view.calculation.allocated.currency,
      ),
      calendarMonth: view.calculation.calendarMonth,
      categorizedForecastSpent: money(
        BigInt(view.calculation.categorizedForecastSpent.amountMinor),
        view.calculation.categorizedForecastSpent.currency,
      ),
      categorizedSpent: money(
        BigInt(view.calculation.categorizedSpent.amountMinor),
        view.calculation.categorizedSpent.currency,
      ),
      confirmedIncome: money(
        BigInt(view.calculation.confirmedIncome.amountMinor),
        view.calculation.confirmedIncome.currency,
      ),
      lines: view.calculation.lines.map((line) => ({
        allocation: money(BigInt(line.allocation.amountMinor), line.allocation.currency),
        carryIn: money(BigInt(line.carryIn.amountMinor), line.carryIn.currency),
        carryOut: money(BigInt(line.carryOut.amountMinor), line.carryOut.currency),
        categoryId: line.categoryId,
        forecastRemaining: money(BigInt(line.forecastRemaining.amountMinor), line.forecastRemaining.currency),
        forecastSpent: money(BigInt(line.forecastSpent.amountMinor), line.forecastSpent.currency),
        remaining: money(BigInt(line.remaining.amountMinor), line.remaining.currency),
        rolloverPolicy: line.rolloverPolicy,
        spent: money(BigInt(line.spent.amountMinor), line.spent.currency),
      })),
      totalForecastSpent: money(
        BigInt(view.calculation.totalForecastSpent.amountMinor),
        view.calculation.totalForecastSpent.currency,
      ),
      totalSpent: money(
        BigInt(view.calculation.totalSpent.amountMinor),
        view.calculation.totalSpent.currency,
      ),
      unallocated: money(
        BigInt(view.calculation.unallocated.amountMinor),
        view.calculation.unallocated.currency,
      ),
      uncategorizedForecastSpent: money(
        BigInt(view.calculation.uncategorizedForecastSpent.amountMinor),
        view.calculation.uncategorizedForecastSpent.currency,
      ),
      uncategorizedSpent: money(
        BigInt(view.calculation.uncategorizedSpent.amountMinor),
        view.calculation.uncategorizedSpent.currency,
      ),
      uncertainIncome: money(
        BigInt(view.calculation.uncertainIncome.amountMinor),
        view.calculation.uncertainIncome.currency,
      ),
    },
  );
  return loadBudgetView(actor, input.calendarMonth, dependencies);
}

export async function createBudgetCorrection(
  actor: Actor,
  input: Readonly<{
    idempotencyKey: string;
    reason: string;
    toCategoryId: string;
    transactionId: string;
  }>,
  dependencies?: BudgetDependencies,
): Promise<BudgetCorrection> {
  const resolved = await resolveDependencies(dependencies);
  const transactionRepository =
    dependencies?.sourceRepositories?.transactions ??
    (await getManualRecordRepository("transactions"));
  const transaction = await transactionRepository.findForActor(
    actor,
    input.transactionId,
  );
  if (transaction === null) {
    throw new InputValidationError([
      { field: "transactionId", message: "The transaction is unavailable." },
    ]);
  }
  const transactionFields = fields<TransactionFields>(transaction);
  if (
    transactionFields.type !== "expense" &&
    transactionFields.type !== "refund"
  ) {
    throw new InputValidationError([
      {
        field: "transactionId",
        message: "Only expenses and refunds may be budget-categorized.",
      },
    ]);
  }
  if (
    (await resolved.budgetRepository.findCategoryForActor(
      actor,
      input.toCategoryId,
    )) === null
  ) {
    throw new InputValidationError([
      {
        field: "toCategoryId",
        message: "The corrected category must belong to the authenticated user.",
      },
    ]);
  }
  const corrections = await resolved.budgetRepository.listCorrectionsForActor(
    actor,
    [
      transaction.id,
      ...(transactionFields.type === "refund" &&
      transactionFields.refundOfTransactionId !== null
        ? [transactionFields.refundOfTransactionId]
        : []),
    ],
  );
  const original =
    transactionFields.type === "refund" &&
    transactionFields.refundOfTransactionId !== null
      ? await transactionRepository.findForActor(
          actor,
          transactionFields.refundOfTransactionId,
        )
      : null;
  const records = new Map(
    [transaction, ...(original === null ? [] : [original])].map((record) => [
      record.id,
      record,
    ]),
  );
  const fromCategoryId = effectiveTransactionCategory(
    transaction,
    records,
    budgetCorrectionState(corrections),
  );
  if (fromCategoryId === input.toCategoryId) {
    throw new InputValidationError([
      { field: "toCategoryId", message: "Choose a different category." },
    ]);
  }
  return resolved.budgetRepository.createCorrectionForActor(
    actor,
    {
      fromCategoryId,
      reason: input.reason,
      toCategoryId: input.toCategoryId,
      transactionId: input.transactionId,
    },
    input.idempotencyKey,
  );
}

export async function runBudgetScenario(
  actor: Actor,
  input: Readonly<{
    additionalExpense: Money;
    additionalIncome: Money;
    expenseReduction: Money;
    investmentProceeds: Money;
    targetBalance: Money | null;
    uncertainIncome: Money;
  }>,
  dependencies?: BudgetDependencies,
): Promise<BudgetScenarioView> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required for scenarios." },
    ]);
  }
  const values = [
    input.additionalExpense,
    input.additionalIncome,
    input.expenseReduction,
    input.investmentProceeds,
    input.uncertainIncome,
    ...(input.targetBalance === null ? [] : [input.targetBalance]),
  ];
  validateBudgetMoneyCurrency(values, profile.fields.primaryCurrency);
  const engineRepository =
    dependencies?.engineRepository ??
    (await getFinancialEngineSnapshotRepository());
  const engineSnapshot = (await engineRepository.listForActor(actor, { limit: 1 }))
    .snapshots[0];
  if (engineSnapshot === undefined) {
    throw new InputValidationError([
      {
        field: "financialSnapshot",
        message: "Calculate the conservative financial snapshot first.",
      },
    ]);
  }
  const baseConfirmedPosition = subtractMoney(
    engineSnapshot.result.safeToSpend,
    engineSnapshot.result.shortfall,
  );
  const result: BudgetScenarioResult = calculateBudgetScenario({
    ...input,
    baseConfirmedPosition,
  });
  return toBudgetScenarioView(result);
}
