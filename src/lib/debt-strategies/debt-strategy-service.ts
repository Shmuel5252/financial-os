import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  toDebtStrategyComparisonView,
  type DebtStrategyCenterView,
  type EvaluateDebtStrategyCommand,
  type SaveDebtStrategyCommand,
  type SavedDebtStrategy,
} from "@/lib/debt-strategies/debt-strategy";
import {
  getDebtStrategyRepository,
  type DebtStrategyRepository,
} from "@/lib/debt-strategies/debt-strategy-repository";
import { calendarDateAtInstant } from "@/lib/domain/financial-engine/financial-calendar";
import { calculateDebtStrategies, type DebtStrategyDebt, type DebtStrategyInput } from "@/lib/domain/debt-strategies/debt-strategy-engine";
import { parseMajorMoney } from "@/lib/domain/money/money-input";
import { serializeMoney, type Money } from "@/lib/domain/money/money";
import { InputValidationError, NotFoundError } from "@/lib/errors/application-error";
import { getManualRecordRepository, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { manualSectionDomainSchemas } from "@/lib/onboarding/manual-record";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

export type DebtStrategyDependencies = Readonly<{
  loanRepository?: ManualRecordRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  strategyRepository?: DebtStrategyRepository;
}>;

type AnyCommand = EvaluateDebtStrategyCommand | SaveDebtStrategyCommand;

function exactMoney(
  input: Readonly<{ amount: string; currency: string }>,
  expectedCurrency: string,
  field: string,
  allowZero: boolean,
): Money {
  let value: Money;
  try {
    value = parseMajorMoney(input);
  } catch {
    throw new InputValidationError([{ field, message: "Use a valid exact money amount." }]);
  }
  if (value.currency !== expectedCurrency) {
    throw new InputValidationError([{ field, message: `Use the selected debt currency ${expectedCurrency}.` }]);
  }
  if (allowZero ? value.amountMinor < 0n : value.amountMinor <= 0n) {
    throw new InputValidationError([{ field, message: allowZero ? "The amount cannot be negative." : "The amount must be greater than zero." }]);
  }
  return value;
}

async function buildInput(
  actor: Actor,
  command: AnyCommand,
  dependencies?: DebtStrategyDependencies,
): Promise<Readonly<{ input: DebtStrategyInput; timeZone: string }>> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined ? undefined : { repository: dependencies.profileRepository },
  );
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required." }]);
  const loanRepository = dependencies?.loanRepository ?? await getManualRecordRepository("loans");
  const ownedLoans = await loanRepository.listAllForActor(actor, 1_000);
  const byId = new Map(ownedLoans.map((record) => [record.id, record]));
  const firstRecord = byId.get(command.debtTerms[0]!.loanId);
  if (firstRecord === undefined) throw new NotFoundError();
  const firstFields = manualSectionDomainSchemas.loans.parse(firstRecord.fields);
  const currency = firstFields.remainingBalance.currency;
  const debts: DebtStrategyDebt[] = command.debtTerms.map((term, termIndex) => {
    const record = byId.get(term.loanId);
    if (record === undefined) throw new NotFoundError();
    const fields = manualSectionDomainSchemas.loans.parse(record.fields);
    if (fields.remainingBalance.currency !== currency) {
      throw new InputValidationError([{ field: `debtTerms.${termIndex}.loanId`, message: "Debt strategies cannot combine currencies." }]);
    }
    const minimumPayment = term.minimumPayment.kind === "fixed"
      ? { ...term.minimumPayment, amount: exactMoney(term.minimumPayment.amount, currency, `debtTerms.${termIndex}.minimumPayment.amount`, false) }
      : term.minimumPayment.kind === "formula"
        ? { ...term.minimumPayment, floor: exactMoney(term.minimumPayment.floor, currency, `debtTerms.${termIndex}.minimumPayment.floor`, true) }
        : term.minimumPayment;
    const prepayment = term.prepayment.kind === "fixed_fee"
      ? { ...term.prepayment, amount: exactMoney(term.prepayment.amount, currency, `debtTerms.${termIndex}.prepayment.amount`, true) }
      : term.prepayment;
    return {
      allocationOrder: term.allocationOrder,
      balance: fields.remainingBalance,
      fees: term.fees.map((fee, feeIndex) => ({
        ...fee,
        amount: exactMoney(fee.amount, currency, `debtTerms.${termIndex}.fees.${feeIndex}.amount`, true),
      })),
      feesKnown: term.feesKnown,
      feesProvenance: term.feesProvenance,
      firstPaymentDate: term.firstPaymentDate,
      id: record.id,
      interest: term.interest,
      label: fields.name,
      minimumPayment,
      prepayment,
      sourceVersion: record.version,
    };
  });
  const evaluationDate = calendarDateAtInstant((dependencies?.now ?? (() => new Date()))().toISOString(), profile.fields.timeZone);
  return {
    input: {
      customPriority: command.customPriority,
      debts,
      evaluationDate,
      extraPayment: exactMoney(command.extraPayment, currency, "extraPayment", true),
      extraPaymentStartDate: command.extraPaymentStartDate,
    },
    timeZone: profile.fields.timeZone,
  };
}

export async function evaluateDebtStrategy(
  actor: Actor,
  command: AnyCommand,
  dependencies?: DebtStrategyDependencies,
) {
  const built = await buildInput(actor, command, dependencies);
  try {
    return { comparison: calculateDebtStrategies(built.input), input: built.input, timeZone: built.timeZone };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InputValidationError([{ field: "debtStrategy", message: error.message }]);
    }
    throw error;
  }
}

export async function saveDebtStrategy(
  actor: Actor,
  command: SaveDebtStrategyCommand,
  dependencies?: DebtStrategyDependencies,
): Promise<SavedDebtStrategy> {
  const evaluated = await evaluateDebtStrategy(actor, command, dependencies);
  const repository = dependencies?.strategyRepository ?? await getDebtStrategyRepository();
  return repository.saveForActor(actor, evaluated.input, evaluated.comparison, {
    idempotencyKey: command.idempotencyKey,
    name: command.name,
    note: command.note,
  });
}

export async function listDebtStrategies(
  actor: Actor,
  request: Readonly<{ cursor?: string | undefined; limit: number }>,
  dependencies?: DebtStrategyDependencies,
) {
  const repository = dependencies?.strategyRepository ?? await getDebtStrategyRepository();
  return repository.listForActor(actor, request);
}

export async function loadDebtStrategyCenter(
  actor: Actor,
  dependencies?: DebtStrategyDependencies,
): Promise<DebtStrategyCenterView> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined ? undefined : { repository: dependencies.profileRepository },
  );
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required." }]);
  const loanRepository = dependencies?.loanRepository ?? await getManualRecordRepository("loans");
  const strategyRepository = dependencies?.strategyRepository ?? await getDebtStrategyRepository();
  const [records, saved] = await Promise.all([
    loanRepository.listAllForActor(actor, 1_000),
    strategyRepository.listForActor(actor, { limit: 10 }),
  ]);
  const evaluationDate = calendarDateAtInstant((dependencies?.now ?? (() => new Date()))().toISOString(), profile.fields.timeZone);
  return {
    currency: profile.fields.primaryCurrency,
    evaluationDate,
    loans: records.map((record) => {
      const fields = manualSectionDomainSchemas.loans.parse(record.fields);
      return {
        id: record.id,
        label: fields.name,
        monthlyPayment: serializeMoney(fields.monthlyPayment),
        nextPaymentDate: fields.nextPaymentDate,
        remainingBalance: serializeMoney(fields.remainingBalance),
        reportedAnnualInterestRateBps: fields.annualInterestRateBps,
        version: record.version,
      };
    }),
    saved: saved.scenarios.map((scenario) => ({
      comparison: toDebtStrategyComparisonView(scenario.comparison),
      createdAt: scenario.createdAt.toISOString(),
      id: scenario.id,
      name: scenario.name,
      note: scenario.note,
    })),
    timeZone: profile.fields.timeZone,
  };
}

export async function evaluateDebtStrategyView(actor: Actor, command: EvaluateDebtStrategyCommand, dependencies?: DebtStrategyDependencies) {
  const evaluated = await evaluateDebtStrategy(actor, command, dependencies);
  return toDebtStrategyComparisonView(evaluated.comparison);
}
