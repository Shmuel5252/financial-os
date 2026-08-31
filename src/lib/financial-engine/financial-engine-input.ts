import {
  addCalendarDays,
  billingDateOnOrAfter,
  calendarDateAtInstant,
  calendarMonth,
  firstCalendarDateOfMonth,
  lastCalendarDateOfMonth,
} from "@/lib/domain/financial-engine/financial-calendar";
import {
  DEFAULT_HORIZON_DAYS,
  type FinancialEngineEvent,
  type FinancialEngineInput,
  type MonthlyConfirmedIncome,
  type SafetyMarginPolicy,
} from "@/lib/domain/financial-engine/financial-engine";
import { expandRecurrence } from "@/lib/domain/financial-engine/financial-schedule";
import { addMoney, money, type Money } from "@/lib/domain/money/money";
import type { CalendarDate } from "@/lib/domain/time/financial-time";
import {
  manualSectionDomainSchemas,
  type ManualRecord,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import type { UserProfile } from "@/lib/profiles/profile";

export const financialEngineSourceSections = [
  "accounts",
  "transactions",
  "recurring_transactions",
  "income",
  "expenses",
  "cards",
  "loans",
  "savings",
  "safety_margin",
] as const satisfies readonly ManualSection[];

export type FinancialEngineSourceSection =
  (typeof financialEngineSourceSections)[number];

export type FinancialEngineSourceRecords = Readonly<
  Record<FinancialEngineSourceSection, readonly ManualRecord[]>
>;

type AccountFields = ReturnType<
  (typeof manualSectionDomainSchemas)["accounts"]["parse"]
>;
type CardFields = ReturnType<
  (typeof manualSectionDomainSchemas)["cards"]["parse"]
>;
type ExpenseFields = ReturnType<
  (typeof manualSectionDomainSchemas)["expenses"]["parse"]
>;
type IncomeFields = ReturnType<
  (typeof manualSectionDomainSchemas)["income"]["parse"]
>;
type LoanFields = ReturnType<
  (typeof manualSectionDomainSchemas)["loans"]["parse"]
>;
type RecurringTransactionFields = ReturnType<
  (typeof manualSectionDomainSchemas)["recurring_transactions"]["parse"]
>;
type SafetyMarginFields = ReturnType<
  (typeof manualSectionDomainSchemas)["safety_margin"]["parse"]
>;
type TransactionFields = ReturnType<
  (typeof manualSectionDomainSchemas)["transactions"]["parse"]
>;

type ParsedRecord<T> = Readonly<{ fields: T; id: string }>;

function parseRecords<T>(
  records: readonly ManualRecord[],
  schema: Readonly<{ parse: (value: unknown) => T }>,
): readonly ParsedRecord<T>[] {
  return records.map((record) => ({
    fields: schema.parse(record.fields),
    id: record.id,
  }));
}

function zero(currency: string): Money {
  return money(0n, currency);
}

function sumMoney(
  values: readonly Money[],
  currency: string,
): Money {
  return values.reduce(
    (total, value) => addMoney(total, value),
    zero(currency),
  );
}

function isAvailableAccount(account: AccountFields): boolean {
  return account.type === "bank" || account.type === "cash";
}

function recurringDates(
  startDate: CalendarDate,
  frequency:
    | "annual"
    | "biweekly"
    | "irregular"
    | "monthly"
    | "one_time"
    | "quarterly"
    | "weekly",
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
  interval = 1,
  endDate: CalendarDate | null = null,
): readonly CalendarDate[] {
  return expandRecurrence(
    { endDate, frequency, interval, startDate },
    horizonStart,
    horizonEnd,
  );
}

function incomeEvents(
  incomes: readonly ParsedRecord<IncomeFields>[],
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
): readonly FinancialEngineEvent[] {
  return incomes.flatMap(({ fields, id }) => {
    if (fields.destination !== "bank_account" && fields.destination !== "cash") {
      return [];
    }

    const kind =
      fields.certaintyBps === 10_000
        ? ("confirmed_income" as const)
        : ("uncertain_income" as const);

    return recurringDates(
      fields.expectedDate,
      fields.frequency,
      horizonStart,
      horizonEnd,
    ).map((calendarDate) => ({
      amount: fields.amount,
      calendarDate,
      id: `income:${id}:${calendarDate}`,
      kind,
      occurredAt: null,
      source: "income_source" as const,
    }));
  });
}

function expenseEvents(
  expenses: readonly ParsedRecord<ExpenseFields>[],
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
): readonly FinancialEngineEvent[] {
  return expenses.flatMap(({ fields, id }) =>
    recurringDates(
      fields.nextDueDate,
      fields.frequency,
      horizonStart,
      horizonEnd,
    ).map((calendarDate) => ({
      amount: fields.amount,
      calendarDate,
      id: `expense:${id}:${calendarDate}`,
      kind: "obligation" as const,
      occurredAt: null,
      source: "recurring_expense" as const,
    })),
  );
}

function recurringTransactionEvents(
  recurringTransactions: readonly ParsedRecord<RecurringTransactionFields>[],
  accountsById: ReadonlyMap<string, AccountFields>,
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
): readonly FinancialEngineEvent[] {
  return recurringTransactions.flatMap(({ fields, id }) => {
    if (!fields.active) {
      return [];
    }

    const account = accountsById.get(fields.accountId);
    if (account === undefined || !isAvailableAccount(account)) {
      return [];
    }

    return recurringDates(
      fields.nextOccurrenceDate,
      fields.frequency,
      horizonStart,
      horizonEnd,
      fields.interval,
      fields.endDate,
    ).map((calendarDate) => ({
      amount: fields.amount,
      calendarDate,
      id: `recurring-transaction:${id}:${calendarDate}`,
      // Recurring income has no explicit certainty field in the Phase 2 schema.
      // It therefore remains expected-only under the approved policy.
      kind:
        fields.type === "expense"
          ? ("obligation" as const)
          : ("uncertain_income" as const),
      occurredAt: null,
      source: "recurring_transaction" as const,
    }));
  });
}

function cardEvents(
  cards: readonly ParsedRecord<CardFields>[],
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
): readonly FinancialEngineEvent[] {
  return cards.flatMap(({ fields, id }) => {
    if (fields.used.amountMinor === 0n) {
      return [];
    }

    const calendarDate = billingDateOnOrAfter(
      horizonStart,
      fields.billingDay,
    );
    return calendarDate <= horizonEnd
      ? [
          {
            amount: fields.used,
            calendarDate,
            id: `card:${id}:${calendarDate}`,
            kind: "obligation" as const,
            occurredAt: null,
            source: "credit_card" as const,
          },
        ]
      : [];
  });
}

function loanEvents(
  loans: readonly ParsedRecord<LoanFields>[],
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
): readonly FinancialEngineEvent[] {
  return loans.flatMap(({ fields, id }) => {
    let remainingMinor = fields.remainingBalance.amountMinor;

    return recurringDates(
      fields.nextPaymentDate,
      "monthly",
      horizonStart,
      horizonEnd,
      1,
      fields.endDate,
    ).flatMap((calendarDate) => {
      if (remainingMinor === 0n) {
        return [];
      }

      const paymentMinor =
        fields.monthlyPayment.amountMinor < remainingMinor
          ? fields.monthlyPayment.amountMinor
          : remainingMinor;
      remainingMinor -= paymentMinor;

      return [
        {
          amount: money(paymentMinor, fields.monthlyPayment.currency),
          calendarDate,
          id: `loan:${id}:${calendarDate}`,
          kind: "obligation" as const,
          occurredAt: null,
          source: "loan" as const,
        },
      ];
    });
  });
}

function safetyMargin(
  margins: readonly ParsedRecord<SafetyMarginFields>[],
  currency: string,
): SafetyMarginPolicy {
  if (margins.length > 1) {
    throw new RangeError("Only one active safety margin may be calculated.");
  }

  const configured = margins[0]?.fields;
  return configured ?? { amount: zero(currency), kind: "fixed" };
}

function monthlyConfirmedIncomeBasis(
  confirmedEvents: readonly FinancialEngineEvent[],
  transactions: readonly ParsedRecord<TransactionFields>[],
  evaluationDate: CalendarDate,
  horizonEndDate: CalendarDate,
  currency: string,
): readonly MonthlyConfirmedIncome[] {
  const evaluationMonthStart = firstCalendarDateOfMonth(evaluationDate);
  const lastApplicableDate = lastCalendarDateOfMonth(horizonEndDate);
  const monthTotals = new Map<string, Money>();
  let monthStart = evaluationMonthStart;

  while (monthStart <= lastApplicableDate) {
    monthTotals.set(calendarMonth(monthStart), zero(currency));
    monthStart = addCalendarDays(lastCalendarDateOfMonth(monthStart), 1);
  }

  for (const event of confirmedEvents) {
    const month = calendarMonth(event.calendarDate);
    const current = monthTotals.get(month);
    if (current !== undefined) {
      monthTotals.set(month, addMoney(current, event.amount));
    }
  }

  for (const { fields } of transactions) {
    if (
      fields.type !== "income" ||
      fields.confidenceBps !== 10_000 ||
      fields.date < evaluationMonthStart ||
      fields.date > evaluationDate
    ) {
      continue;
    }

    const month = calendarMonth(fields.date);
    const current = monthTotals.get(month);
    if (current !== undefined) {
      monthTotals.set(month, addMoney(current, fields.amount));
    }
  }

  return [...monthTotals.entries()].map(([month, amount]) => ({
    amount,
    calendarMonth: month,
  }));
}

export function buildFinancialEngineInput(
  profile: UserProfile,
  sourceRecords: FinancialEngineSourceRecords,
  asOf: string,
  horizonDays = DEFAULT_HORIZON_DAYS,
): FinancialEngineInput {
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) {
    throw new RangeError("Horizon days must be between 1 and 366.");
  }

  const currency = profile.fields.primaryCurrency;
  const evaluationDate = calendarDateAtInstant(asOf, profile.fields.timeZone);
  const horizonEndDate = addCalendarDays(evaluationDate, horizonDays - 1);
  const basisStart = firstCalendarDateOfMonth(evaluationDate);
  const basisEnd = lastCalendarDateOfMonth(horizonEndDate);
  const accounts = parseRecords(
    sourceRecords.accounts,
    manualSectionDomainSchemas.accounts,
  );
  const cards = parseRecords(
    sourceRecords.cards,
    manualSectionDomainSchemas.cards,
  );
  const expenses = parseRecords(
    sourceRecords.expenses,
    manualSectionDomainSchemas.expenses,
  );
  const incomes = parseRecords(
    sourceRecords.income,
    manualSectionDomainSchemas.income,
  );
  const loans = parseRecords(
    sourceRecords.loans,
    manualSectionDomainSchemas.loans,
  );
  const recurringTransactions = parseRecords(
    sourceRecords.recurring_transactions,
    manualSectionDomainSchemas.recurring_transactions,
  );
  const margins = parseRecords(
    sourceRecords.safety_margin,
    manualSectionDomainSchemas.safety_margin,
  );
  const savings = parseRecords(
    sourceRecords.savings,
    manualSectionDomainSchemas.savings,
  );
  const transactions = parseRecords(
    sourceRecords.transactions,
    manualSectionDomainSchemas.transactions,
  );
  const accountsById = new Map(
    accounts.map(({ fields, id }) => [id, fields] as const),
  );
  const availableAccounts = accounts.filter(({ fields }) =>
    isAvailableAccount(fields),
  );
  const bankAccounts = accounts.filter(({ fields }) => fields.type === "bank");
  const accountSavings = accounts.filter(
    ({ fields }) => fields.type === "savings",
  );
  const actualTransactions = transactions.filter(
    ({ fields }) =>
      calendarMonth(fields.date) === calendarMonth(evaluationDate) &&
      fields.date <= evaluationDate,
  );
  const allIncomeEvents = incomeEvents(incomes, basisStart, basisEnd);
  const events: readonly FinancialEngineEvent[] = [
    ...allIncomeEvents.filter(
      (event) =>
        event.calendarDate >= evaluationDate &&
        event.calendarDate <= horizonEndDate,
    ),
    ...expenseEvents(expenses, evaluationDate, horizonEndDate),
    ...recurringTransactionEvents(
      recurringTransactions,
      accountsById,
      evaluationDate,
      horizonEndDate,
    ),
    ...cardEvents(cards, evaluationDate, horizonEndDate),
    ...loanEvents(loans, evaluationDate, horizonEndDate),
  ];

  return {
    accountBalance: sumMoney(
      bankAccounts.map(({ fields }) => fields.balance),
      currency,
    ),
    actualMonthlyExpenses: sumMoney(
      actualTransactions
        .filter(({ fields }) => fields.type === "expense")
        .map(({ fields }) => fields.amount),
      currency,
    ),
    actualMonthlyIncome: sumMoney(
      actualTransactions
        .filter(({ fields }) => fields.type === "income")
        .map(({ fields }) => fields.amount),
      currency,
    ),
    asOf,
    availableCash: sumMoney(
      availableAccounts.map(({ fields }) => fields.balance),
      currency,
    ),
    creditLimit: sumMoney(
      cards.map(({ fields }) => fields.limit),
      currency,
    ),
    creditUsed: sumMoney(
      cards.map(({ fields }) => fields.used),
      currency,
    ),
    currency,
    debtBalance: sumMoney(
      loans.map(({ fields }) => fields.remainingBalance),
      currency,
    ),
    events,
    horizonDays,
    monthlyConfirmedIncomeBasis: monthlyConfirmedIncomeBasis(
      allIncomeEvents.filter((event) => event.kind === "confirmed_income"),
      transactions,
      evaluationDate,
      horizonEndDate,
      currency,
    ),
    safetyMargin: safetyMargin(margins, currency),
    savingsBalance: sumMoney(
      (savings.length > 0 ? savings : accountSavings).map(
        ({ fields }) => fields.balance,
      ),
      currency,
    ),
    timeZone: profile.fields.timeZone,
  };
}
