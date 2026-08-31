import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  getBudgetRepository,
  type BudgetRepository,
} from "@/lib/budgets/budget-repository";
import { calendarMonth } from "@/lib/domain/financial-engine/financial-calendar";
import {
  calculatePurchaseSimulation,
  PURCHASE_BASELINE_HORIZON_DAYS,
  PURCHASE_EVALUATION_HORIZON_DAYS,
  SAFER_DATE_SEARCH_DAYS,
  type PurchaseCharge,
} from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { parseMajorMoney } from "@/lib/domain/money/money-input";
import type { Money } from "@/lib/domain/money/money";
import {
  InputValidationError,
  NotFoundError,
} from "@/lib/errors/application-error";
import {
  assessFinancialEngineSnapshotFreshness,
  type FinancialSnapshotFreshnessDependencies,
} from "@/lib/financial-engine/financial-engine-snapshot-freshness";
import {
  getFinancialEngineSnapshotRepository,
  type FinancialEngineSnapshotRepository,
} from "@/lib/financial-engine/financial-engine-snapshot-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";
import {
  toPurchaseSimulationEvaluationView,
  toSavedPurchaseSimulationView,
  type EvaluatePurchaseCommand,
  type PurchaseSimulationCenterView,
  type PurchaseSimulationEvaluation,
  type PurchaseSimulationParameters,
  type SavePurchaseSimulationCommand,
  type SavedPurchaseSimulation,
} from "@/lib/purchase-simulations/purchase-simulation";
import {
  getPurchaseSimulationRepository,
  type PurchaseSimulationPage,
  type PurchaseSimulationRepository,
} from "@/lib/purchase-simulations/purchase-simulation-repository";

export type PurchaseSimulationDependencies = Readonly<{
  budgetRepository?: BudgetRepository;
  engineRepository?: FinancialEngineSnapshotRepository;
  freshness?: FinancialSnapshotFreshnessDependencies;
  profileRepository?: UserProfileRepository;
  simulationRepository?: PurchaseSimulationRepository;
}>;

async function repositories(dependencies?: PurchaseSimulationDependencies) {
  return {
    budget:
      dependencies?.budgetRepository ?? (await getBudgetRepository()),
    engine:
      dependencies?.engineRepository ??
      (await getFinancialEngineSnapshotRepository()),
    simulation:
      dependencies?.simulationRepository ??
      (await getPurchaseSimulationRepository()),
  };
}

function positiveMoney(
  input: Readonly<{ amount: string; currency: string }>,
  currency: string,
  field: string,
): Money {
  let parsed: Money;
  try {
    parsed = parseMajorMoney(input);
  } catch {
    throw new InputValidationError([
      { field, message: "Use a valid exact money amount." },
    ]);
  }
  if (parsed.currency !== currency) {
    throw new InputValidationError([
      { field, message: `Use the profile currency ${currency}.` },
    ]);
  }
  if (parsed.amountMinor <= 0n) {
    throw new InputValidationError([
      { field, message: "The amount must be greater than zero." },
    ]);
  }
  return parsed;
}

function parameters(
  command: EvaluatePurchaseCommand | SavePurchaseSimulationCommand,
  currency: string,
): PurchaseSimulationParameters {
  if (
    (command.inputMode === "one_time" && command.installmentCount !== 1) ||
    (command.inputMode === "installments" && command.installmentCount < 2)
  ) {
    throw new InputValidationError([
      {
        field: "installmentCount",
        message: "The installment count does not match the payment mode.",
      },
    ]);
  }
  const charges: readonly PurchaseCharge[] = command.charges.map(
    (charge, index) => ({
      amount: positiveMoney(
        charge.amount,
        currency,
        `charges.${index}.amount`,
      ),
      kind: charge.kind,
      label: charge.label,
      provenance: charge.provenance,
    }),
  );
  return {
    charges,
    inputMode: command.inputMode,
    installmentCount: command.installmentCount,
    installmentFrequency: command.installmentFrequency,
    proposedDate: command.proposedDate,
    sourceSnapshotId: command.sourceSnapshotId,
    totalPurchasePrice: positiveMoney(
      command.totalPurchasePrice,
      currency,
      "totalPurchasePrice",
    ),
  };
}

export async function evaluatePurchaseSimulation(
  actor: Actor,
  command: EvaluatePurchaseCommand | SavePurchaseSimulationCommand,
  dependencies?: PurchaseSimulationDependencies,
): Promise<Readonly<{
  evaluation: PurchaseSimulationEvaluation;
  input: PurchaseSimulationParameters;
}>> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required." },
    ]);
  }
  const resolved = await repositories(dependencies);
  const snapshot = await resolved.engine.findForActor(
    actor,
    command.sourceSnapshotId,
  );
  if (snapshot === null) {
    throw new NotFoundError();
  }
  const input = parameters(command, profile.fields.primaryCurrency);
  let result;
  try {
    result = calculatePurchaseSimulation({
      baseline: snapshot.result,
      charges: input.charges,
      evaluationHorizonDays: PURCHASE_EVALUATION_HORIZON_DAYS,
      installmentCount: input.installmentCount,
      installmentFrequency: input.installmentFrequency,
      inputMode: input.inputMode,
      proposedDate: input.proposedDate,
      saferDateSearchDays: SAFER_DATE_SEARCH_DAYS,
      totalPurchasePrice: input.totalPurchasePrice,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InputValidationError([
        { field: "simulation", message: error.message },
      ]);
    }
    throw error;
  }
  const freshnessReasons = await assessFinancialEngineSnapshotFreshness(
    actor,
    profile,
    snapshot,
    dependencies?.freshness,
  );
  const budgetPeriod = await resolved.budget.findPeriodForActor(
    actor,
    calendarMonth(input.proposedDate),
  );
  return {
    evaluation: {
      budgetPeriodReference:
        budgetPeriod === null
          ? null
          : {
              calendarMonth: budgetPeriod.calendarMonth,
              id: budgetPeriod.id,
              version: budgetPeriod.version,
            },
      dataFreshness: freshnessReasons.length === 0 ? "FRESH" : "STALE",
      freshnessReasons,
      result,
      sourceSnapshot: {
        calculatedAt: snapshot.calculatedAt,
        engineVersion: snapshot.engineVersion,
        id: snapshot.id,
        inputHash: snapshot.inputHash,
        policyVersion: snapshot.policyVersion,
        sourceManifestId: snapshot.sourceManifestId,
      },
      timeZone: profile.fields.timeZone,
    },
    input,
  };
}

export async function savePurchaseSimulation(
  actor: Actor,
  command: SavePurchaseSimulationCommand,
  dependencies?: PurchaseSimulationDependencies,
): Promise<SavedPurchaseSimulation> {
  const evaluated = await evaluatePurchaseSimulation(
    actor,
    command,
    dependencies,
  );
  const repository =
    dependencies?.simulationRepository ??
    (await getPurchaseSimulationRepository());
  return repository.saveForActor(actor, evaluated.input, evaluated.evaluation, {
    idempotencyKey: command.idempotencyKey,
    name: command.name,
    note: command.note,
  });
}

export async function listPurchaseSimulations(
  actor: Actor,
  request: Readonly<{ cursor?: string | undefined; limit: number }>,
  dependencies?: PurchaseSimulationDependencies,
): Promise<PurchaseSimulationPage> {
  const repository =
    dependencies?.simulationRepository ??
    (await getPurchaseSimulationRepository());
  return repository.listForActor(actor, request);
}

export async function loadPurchaseSimulationCenter(
  actor: Actor,
  dependencies?: PurchaseSimulationDependencies,
): Promise<PurchaseSimulationCenterView> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required." },
    ]);
  }
  const resolved = await repositories(dependencies);
  const [baseline, savedPage] = await Promise.all([
    resolved.engine.findLatestForActorWithMinimumHorizon(
      actor,
      PURCHASE_BASELINE_HORIZON_DAYS,
    ),
    resolved.simulation.listForActor(actor, { limit: 10 }),
  ]);
  const freshnessReasons =
    baseline === null
      ? []
      : await assessFinancialEngineSnapshotFreshness(
          actor,
          profile,
          baseline,
          dependencies?.freshness,
        );
  return {
    baseline:
      baseline === null
        ? null
        : {
            calculatedAt: baseline.calculatedAt.toISOString(),
            dataFreshness:
              freshnessReasons.length === 0 ? "FRESH" : "STALE",
            evaluationDate: baseline.result.evaluationDate,
            freshnessReasons,
            horizonEndDate: baseline.result.horizonEndDate,
            id: baseline.id,
          },
    currency: profile.fields.primaryCurrency,
    requiredBaselineHorizonDays: PURCHASE_BASELINE_HORIZON_DAYS,
    saved: savedPage.simulations.map(toSavedPurchaseSimulationView),
    timeZone: profile.fields.timeZone,
  };
}

export async function evaluatePurchaseSimulationView(
  actor: Actor,
  command: EvaluatePurchaseCommand,
  dependencies?: PurchaseSimulationDependencies,
) {
  const evaluated = await evaluatePurchaseSimulation(actor, command, dependencies);
  return toPurchaseSimulationEvaluationView(evaluated.evaluation);
}
