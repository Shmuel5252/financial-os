import "server-only";

import { createHash } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import {
  budgetCorrectionState,
  effectiveTransactionCategory,
} from "@/lib/budgets/category-projection";
import {
  getBudgetRepository,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import { createBudgetCorrection } from "@/lib/budgets/budget-service";
import { calculateTransactionIntelligence } from "@/lib/domain/transaction-intelligence/transaction-intelligence-engine";
import type { Money } from "@/lib/domain/money/money";
import {
  ConflictError,
  InputValidationError,
} from "@/lib/errors/application-error";
import type { ManualRecord } from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  TRANSACTION_INTELLIGENCE_ENGINE_VERSION,
  TRANSACTION_INTELLIGENCE_MAX_INPUTS,
  TRANSACTION_INTELLIGENCE_POLICY_VERSION,
  TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS,
  TRANSACTION_INTELLIGENCE_RULESET_VERSION,
  toTransactionIntelligenceRunView,
  type TransactionIntelligenceCalculation,
  type TransactionIntelligenceInput,
  type TransactionIntelligenceReviewDecision,
  type TransactionIntelligenceRunView,
} from "@/lib/transaction-intelligence/transaction-intelligence";
import {
  getTransactionIntelligenceRepository,
  type TransactionIntelligenceRepository,
} from "@/lib/transaction-intelligence/transaction-intelligence-repository";

type TransactionFields = Readonly<{
  accountId: string;
  amount: Money;
  category: string;
  date: string;
  merchant: string | null;
  type: "expense" | "income" | "refund" | "transfer";
}>;

export type TransactionIntelligenceDependencies = Readonly<{
  analyze?: (
    inputs: readonly TransactionIntelligenceInput[],
  ) => TransactionIntelligenceCalculation;
  budgetRepository?: BudgetRepository;
  repository?: TransactionIntelligenceRepository;
  transactionRepository?: ManualRecordRepository;
}>;

async function resolveDependencies(
  dependencies?: TransactionIntelligenceDependencies,
): Promise<Readonly<{
  analyze: (
    inputs: readonly TransactionIntelligenceInput[],
  ) => TransactionIntelligenceCalculation;
  budgetRepository: BudgetRepository;
  repository: TransactionIntelligenceRepository;
  transactionRepository: ManualRecordRepository;
}>> {
  return {
    analyze: dependencies?.analyze ?? calculateTransactionIntelligence,
    budgetRepository:
      dependencies?.budgetRepository ?? (await getBudgetRepository()),
    repository:
      dependencies?.repository ??
      (await getTransactionIntelligenceRepository()),
    transactionRepository:
      dependencies?.transactionRepository ??
      (await getManualRecordRepository("transactions")),
  };
}

function transactionFields(record: ManualRecord): TransactionFields {
  return record.fields as TransactionFields;
}

async function loadInputs(
  actor: Actor,
  transactionRepository: ManualRecordRepository,
  budgetRepository: BudgetRepository,
): Promise<readonly TransactionIntelligenceInput[]> {
  const transactions = await transactionRepository.listAllForActor(
    actor,
    TRANSACTION_INTELLIGENCE_MAX_INPUTS,
  );
  const corrections = await budgetRepository.listCorrectionsForActor(
    actor,
    transactions.map((record) => record.id),
  );
  const recordsById = new Map(
    transactions.map((record) => [record.id, record]),
  );
  const correctionMap = budgetCorrectionState(corrections);
  return transactions.map((record) => {
    const fields = transactionFields(record);
    return {
      accountId: fields.accountId,
      amount: fields.amount,
      confirmedCategoryId: effectiveTransactionCategory(
        record,
        recordsById,
        correctionMap,
      ),
      date: fields.date,
      id: record.id,
      merchant: fields.merchant,
      sourceKind: record.source.kind,
      type: fields.type,
      updatedAt: record.updatedAt.toISOString(),
      version: record.version,
    };
  });
}

export function hashTransactionIntelligenceInputs(
  inputs: readonly TransactionIntelligenceInput[],
): string {
  const canonical = [...inputs]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((input) => ({
      accountId: input.accountId,
      amountMinor: input.amount.amountMinor.toString(),
      categoryId: input.confirmedCategoryId,
      currency: input.amount.currency,
      date: input.date,
      id: input.id,
      merchant: input.merchant,
      sourceKind: input.sourceKind,
      type: input.type,
      updatedAt: input.updatedAt,
      version: input.version,
    }));
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export async function runTransactionIntelligence(
  actor: Actor,
  idempotencyKey: string,
  dependencies?: TransactionIntelligenceDependencies,
): Promise<TransactionIntelligenceRunView> {
  const resolved = await resolveDependencies(dependencies);
  const inputs = await loadInputs(
    actor,
    resolved.transactionRepository,
    resolved.budgetRepository,
  );
  const inputHash = hashTransactionIntelligenceInputs(inputs);
  const calculation = resolved.analyze(inputs);
  const run = await resolved.repository.createRunForActor(
    actor,
    calculation,
    {
      engineVersion: TRANSACTION_INTELLIGENCE_ENGINE_VERSION,
      inputHash,
      policyVersion: TRANSACTION_INTELLIGENCE_POLICY_VERSION,
      reviewThresholdBps: TRANSACTION_INTELLIGENCE_REVIEW_THRESHOLD_BPS,
      rulesetVersion: TRANSACTION_INTELLIGENCE_RULESET_VERSION,
    },
    idempotencyKey,
  );
  const reviews = await resolved.repository.listReviewsForActor(actor, run.id);
  return toTransactionIntelligenceRunView(run, reviews);
}

export async function loadLatestTransactionIntelligence(
  actor: Actor,
  dependencies?: TransactionIntelligenceDependencies,
): Promise<TransactionIntelligenceRunView | null> {
  const repository =
    dependencies?.repository ?? (await getTransactionIntelligenceRepository());
  const run = await repository.latestRunForActor(actor);
  if (run === null) return null;
  const reviews = await repository.listReviewsForActor(actor, run.id);
  return toTransactionIntelligenceRunView(run, reviews);
}

function validateTransition(
  current: TransactionIntelligenceReviewDecision | null,
  next: TransactionIntelligenceReviewDecision,
): void {
  if (next === "reopened") {
    if (current !== "dismissed") {
      throw new ConflictError("Only a dismissed signal may be reopened.");
    }
    return;
  }
  if (current !== null && current !== "reopened") {
    throw new ConflictError("The signal was already reviewed.");
  }
}

export async function reviewTransactionIntelligenceSignal(
  actor: Actor,
  input: Readonly<{
    decision: TransactionIntelligenceReviewDecision;
    expectedDecision: TransactionIntelligenceReviewDecision | null;
    idempotencyKey: string;
    runId: string;
    signalId: string;
  }>,
  dependencies?: TransactionIntelligenceDependencies,
): Promise<TransactionIntelligenceRunView> {
  const resolved = await resolveDependencies(dependencies);
  const idempotent = await resolved.repository.findReviewByIdempotencyForActor(
    actor,
    input.idempotencyKey,
  );
  if (idempotent !== null) {
    if (
      idempotent.runId !== input.runId ||
      idempotent.signalId !== input.signalId ||
      idempotent.decision !== input.decision
    ) {
      throw new ConflictError(
        "The review idempotency key was already used for another decision.",
      );
    }
    const existingRun = await resolved.repository.findRunForActor(
      actor,
      input.runId,
    );
    if (existingRun === null) throw new ConflictError();
    return toTransactionIntelligenceRunView(
      existingRun,
      await resolved.repository.listReviewsForActor(actor, existingRun.id),
    );
  }

  const run = await resolved.repository.findRunForActor(actor, input.runId);
  const signal = run?.signals.find((item) => item.id === input.signalId);
  if (run === null || signal === undefined) {
    throw new InputValidationError([
      { field: "signalId", message: "The signal is unavailable." },
    ]);
  }
  const reviews = await resolved.repository.listReviewsForActor(actor, run.id);
  const signalReviews = reviews.filter(
    (review) => review.signalId === input.signalId,
  );
  const current = signalReviews.at(-1)?.decision ?? null;
  if (current !== input.expectedDecision) {
    throw new ConflictError("The signal review changed; reload first.");
  }
  validateTransition(current, input.decision);

  let categoryCorrectionId: string | null = null;
  if (
    input.decision === "confirmed" &&
    signal.kind === "category_suggestion"
  ) {
    if (signal.suggestedCategoryId === null) {
      throw new InputValidationError([
        { field: "signalId", message: "The category suggestion is invalid." },
      ]);
    }
    const correction = await createBudgetCorrection(
      actor,
      {
        idempotencyKey: input.idempotencyKey,
        reason: "אישור מפורש להצעת הסיווג של Financial OS",
        toCategoryId: signal.suggestedCategoryId,
        transactionId: signal.transactionId,
      },
      {
        budgetRepository: resolved.budgetRepository,
        sourceRepositories: {
          transactions: resolved.transactionRepository,
        },
      },
    );
    categoryCorrectionId = correction.id;
  }

  await resolved.repository.createReviewForActor(
    actor,
    {
      categoryCorrectionId,
      decision: input.decision,
      runId: input.runId,
      sequence: signalReviews.length + 1,
      signalId: input.signalId,
    },
    input.idempotencyKey,
  );
  return toTransactionIntelligenceRunView(
    run,
    await resolved.repository.listReviewsForActor(actor, run.id),
  );
}
