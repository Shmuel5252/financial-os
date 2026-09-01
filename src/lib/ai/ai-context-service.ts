import "server-only";

import type { Actor } from "@/lib/auth/actor";
import type {
  AiEvidenceFact,
  AiEvidenceLabel,
  AiFocus,
  AiPreparedContext,
  AiProviderContext,
  AiSourceReference,
} from "@/lib/ai/ai";
import { loadBudgetView } from "@/lib/budgets/budget-service";
import type { BudgetView } from "@/lib/budgets/budget";
import {
  AI_MINIMIZATION_VERSION,
  AI_REDACTION_VERSION,
  assertSafeAiProviderContext,
  sanitizeAiUserText,
} from "@/lib/domain/ai/ai-safety";
import type { Money, SerializedMoney } from "@/lib/domain/money/money";
import { InputValidationError } from "@/lib/errors/application-error";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import {
  getFinancialEngineSnapshotRepository,
} from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { loadGoalCenterView } from "@/lib/goals/goal-service";
import type { GoalCenterView } from "@/lib/goals/goal";
import type { SavedPurchaseSimulation } from "@/lib/purchase-simulations/purchase-simulation";
import {
  getPurchaseSimulationRepository,
} from "@/lib/purchase-simulations/purchase-simulation-repository";

export type AiContextDependencies = Readonly<{
  loadBudget?: (actor: Actor, calendarMonth: string) => Promise<BudgetView>;
  loadGoals?: (actor: Actor) => Promise<GoalCenterView>;
  loadLatestEngine?: (actor: Actor) => Promise<FinancialEngineSnapshot | null>;
  loadLatestPurchase?: (actor: Actor) => Promise<SavedPurchaseSimulation | null>;
}>;

function moneyEvidence(
  ref: string,
  label: AiEvidenceLabel,
  value: Money | SerializedMoney,
): AiEvidenceFact {
  return {
    label,
    ref,
    value: {
      amountMinor: value.amountMinor.toString(),
      currency: value.currency,
      kind: "money",
    },
  };
}

function statusEvidence(
  ref: string,
  label: AiEvidenceLabel,
  value: string,
): AiEvidenceFact {
  return { label, ref, value: { kind: "status", value } };
}

function dateEvidence(
  ref: string,
  label: AiEvidenceLabel,
  value: string,
): AiEvidenceFact {
  return { label, ref, value: { kind: "calendar_date", value } };
}

function basisPointsEvidence(
  ref: string,
  label: AiEvidenceLabel,
  value: number,
): AiEvidenceFact {
  return { label, ref, value: { kind: "basis_points", value: value.toString() } };
}

async function defaultLatestEngine(actor: Actor): Promise<FinancialEngineSnapshot | null> {
  return (await getFinancialEngineSnapshotRepository()).findLatestForActorWithMinimumHorizon(
    actor,
    1,
  );
}

async function defaultLatestPurchase(actor: Actor): Promise<SavedPurchaseSimulation | null> {
  const page = await (await getPurchaseSimulationRepository()).listForActor(actor, { limit: 1 });
  return page.simulations[0] ?? null;
}

function requireEngine(snapshot: FinancialEngineSnapshot | null): FinancialEngineSnapshot {
  if (snapshot === null) {
    throw new InputValidationError([
      { field: "focus", message: "A Financial Engine snapshot is required for this explanation." },
    ]);
  }
  return snapshot;
}

function engineContext(snapshot: FinancialEngineSnapshot): Readonly<{
  evidence: readonly AiEvidenceFact[];
  references: readonly AiSourceReference[];
}> {
  const result = snapshot.result;
  return {
    evidence: [
      moneyEvidence("engine.safe_to_spend", "engine.safe_to_spend", result.safeToSpend),
      moneyEvidence("engine.available_cash", "engine.available_cash", result.availableCash),
      moneyEvidence("engine.future_balance", "engine.future_balance", result.futureConfirmedBalance),
      moneyEvidence("engine.minimum_balance", "engine.minimum_balance", result.minimumConfirmedBalance),
      moneyEvidence("engine.safety_margin", "engine.safety_margin", result.safetyMarginAtEvaluation),
      moneyEvidence("engine.shortfall", "engine.shortfall", result.shortfall),
      dateEvidence("engine.horizon_end", "engine.horizon_end", result.horizonEndDate),
    ],
    references: [
      {
        alias: "engine.current",
        kind: "financial_engine_snapshot",
        sourceId: snapshot.id,
        version: `${snapshot.engineVersion}/${snapshot.policyVersion}`,
      },
    ],
  };
}

function purchaseContext(simulation: SavedPurchaseSimulation): Readonly<{
  evidence: readonly AiEvidenceFact[];
  references: readonly AiSourceReference[];
}> {
  const result = simulation.evaluation.result;
  const evidence: AiEvidenceFact[] = [
    moneyEvidence("purchase.total_price", "purchase.total_price", result.totalPurchasePrice),
    moneyEvidence("purchase.financed_cost", "purchase.financed_cost", result.trueFinancedCost),
    moneyEvidence("purchase.minimum_balance", "purchase.minimum_balance", result.minimumConfirmedBalance),
    moneyEvidence("purchase.safety_margin", "purchase.safety_margin", result.safetyMarginAtMinimumCapacity),
    statusEvidence("purchase.classification", "purchase.classification", result.riskClassification),
    statusEvidence("purchase.freshness", "purchase.freshness", simulation.evaluation.dataFreshness),
    dateEvidence("purchase.proposed_date", "purchase.proposed_date", simulation.input.proposedDate),
  ];
  if (result.saferDate !== null) {
    evidence.push(dateEvidence("purchase.safer_date", "purchase.safer_date", result.saferDate));
  }
  return {
    evidence,
    references: [
      {
        alias: "purchase.latest_saved",
        kind: "purchase_simulation",
        sourceId: simulation.id,
        version: `${result.engineVersion}/${result.policyVersion}`,
      },
    ],
  };
}

function goalContext(view: GoalCenterView): Readonly<{
  evidence: readonly AiEvidenceFact[];
  references: readonly AiSourceReference[];
}> {
  const goal = view.goals.find((candidate) => candidate.latestProgress !== null);
  const progress = goal?.latestProgress ?? null;
  if (goal === undefined || progress === null) {
    throw new InputValidationError([
      { field: "focus", message: "Verified goal progress is required for this explanation." },
    ]);
  }
  return {
    evidence: [
      moneyEvidence("goal.current", "goal.current", progress.result.currentValue),
      moneyEvidence("goal.target", "goal.target", progress.result.targetValue),
      moneyEvidence("goal.remaining_gap", "goal.remaining_gap", progress.result.remainingGap),
      basisPointsEvidence("goal.progress", "goal.progress", progress.result.normalizedProgressBasisPoints),
      statusEvidence("goal.status", "goal.status", progress.result.status),
      dateEvidence("goal.evaluation_date", "goal.evaluation_date", progress.evaluationDate),
    ],
    references: [
      {
        alias: "goal.current_progress",
        kind: "goal_progress",
        sourceId: progress.id,
        version: `${progress.engineVersion}/${progress.policyVersion}/goal-${progress.goalVersion}`,
      },
    ],
  };
}

function budgetContext(view: BudgetView): Readonly<{
  evidence: readonly AiEvidenceFact[];
  references: readonly AiSourceReference[];
}> {
  const calculation = view.calculation;
  if (view.period.id === null || view.period.version === null) {
    throw new InputValidationError([
      { field: "focus", message: "A saved monthly budget is required for this explanation." },
    ]);
  }
  return {
    evidence: [
      dateEvidence("budget.month", "budget.month", `${calculation.calendarMonth}-01`),
      moneyEvidence("budget.confirmed_income", "budget.confirmed_income", calculation.confirmedIncome),
      moneyEvidence("budget.allocated", "budget.allocated", calculation.allocated),
      moneyEvidence("budget.unallocated", "budget.unallocated", calculation.unallocated),
      moneyEvidence("budget.spending", "budget.spending", calculation.totalSpent),
      moneyEvidence("budget.forecast_spending", "budget.forecast_spending", calculation.totalForecastSpent),
      moneyEvidence("budget.uncertain_income", "budget.uncertain_income", calculation.uncertainIncome),
    ],
    references: [
      {
        alias: "budget.current_period",
        kind: "budget_period",
        sourceId: view.period.id,
        version: `budget-period/${view.period.version}`,
      },
    ],
  };
}

export function toAiProviderContext(context: AiPreparedContext): AiProviderContext {
  const providerContext: AiProviderContext = {
    ...context,
    sourceReferences: context.sourceReferences.map((reference) => ({
      alias: reference.alias,
      kind: reference.kind,
      version: reference.version,
    })),
  };
  assertSafeAiProviderContext(providerContext);
  return providerContext;
}

export async function buildAiPreparedContext(
  actor: Actor,
  focus: AiFocus,
  question: string,
  recentHistory: readonly string[],
  dependencies?: AiContextDependencies,
): Promise<AiPreparedContext> {
  const sanitizedQuestion = sanitizeAiUserText(question);
  const sanitizedHistory = recentHistory.slice(-2).map(sanitizeAiUserText);
  const redactionCategories = new Set([
    ...sanitizedQuestion.categories,
    ...sanitizedHistory.flatMap((entry) => entry.categories),
  ]);

  const loadLatestEngine = dependencies?.loadLatestEngine ?? defaultLatestEngine;
  let selected: Readonly<{
    evidence: readonly AiEvidenceFact[];
    references: readonly AiSourceReference[];
  }>;

  if (focus === "safe_to_spend") {
    selected = engineContext(requireEngine(await loadLatestEngine(actor)));
  } else if (focus === "purchase") {
    const simulation = await (dependencies?.loadLatestPurchase ?? defaultLatestPurchase)(actor);
    if (simulation === null) {
      throw new InputValidationError([
        { field: "focus", message: "A saved purchase simulation is required for this explanation." },
      ]);
    }
    selected = purchaseContext(simulation);
  } else if (focus === "goal") {
    selected = goalContext(await (dependencies?.loadGoals ?? loadGoalCenterView)(actor));
  } else {
    const engine = requireEngine(await loadLatestEngine(actor));
    selected = budgetContext(
      await (dependencies?.loadBudget ?? loadBudgetView)(actor, engine.result.monthly.calendarMonth),
    );
  }

  const prepared: AiPreparedContext = {
    evidence: selected.evidence,
    focus,
    minimizationVersion: `${AI_MINIMIZATION_VERSION};${AI_REDACTION_VERSION}`,
    redactionCategories: [...redactionCategories].sort(),
    sourceReferences: selected.references,
    untrustedRecentHistory: sanitizedHistory.map((entry) => entry.text),
    untrustedUserText: sanitizedQuestion.text,
  };
  toAiProviderContext(prepared);
  return prepared;
}
