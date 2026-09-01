import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  calculateForecast,
  calculateForecastScenario,
  type ForecastRecurringEvidence,
  type ForecastScenarioAdjustment,
} from "@/lib/domain/forecasts/forecast-engine";
import { deserializeMoney } from "@/lib/domain/money/money";
import { parseMajorMoney } from "@/lib/domain/money/money-input";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
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
import {
  DEFAULT_FORECAST_HORIZON,
  FORECAST_HORIZONS,
} from "@/lib/domain/forecasts/forecast-engine";
import {
  toForecastScenarioView,
  toForecastSnapshotView,
  type CreateForecastCommand,
  type CreateForecastScenarioCommand,
  type ForecastCenterView,
  type ForecastScenario,
  type ForecastSnapshot,
} from "@/lib/forecasts/forecast";
import {
  getForecastRepository,
  type ForecastRepository,
} from "@/lib/forecasts/forecast-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";
import {
  runTransactionIntelligence,
  type TransactionIntelligenceDependencies,
} from "@/lib/transaction-intelligence/transaction-intelligence-service";
import type { TransactionIntelligenceReviewDecision } from "@/lib/transaction-intelligence/transaction-intelligence";
import { getTransactionIntelligenceRepository } from "@/lib/transaction-intelligence/transaction-intelligence-repository";

export type ForecastDependencies = Readonly<{
  engineRepository?: FinancialEngineSnapshotRepository;
  forecastRepository?: ForecastRepository;
  freshness?: FinancialSnapshotFreshnessDependencies;
  profileRepository?: UserProfileRepository;
  transactionIntelligence?: TransactionIntelligenceDependencies;
}>;

async function dependencies(input?: ForecastDependencies) {
  return {
    engine: input?.engineRepository ?? (await getFinancialEngineSnapshotRepository()),
    forecast: input?.forecastRepository ?? (await getForecastRepository()),
  };
}

function evidenceFromRun(
  run: Awaited<ReturnType<typeof runTransactionIntelligence>>,
  reviewStates: ReadonlyMap<string, TransactionIntelligenceReviewDecision>,
): readonly ForecastRecurringEvidence[] {
  return run.signals
    .filter((signal) =>
      (signal.kind === "recurring_candidate" || signal.kind === "subscription_candidate") &&
      signal.periodDays !== null,
    )
    .map((signal) => ({
      amount: deserializeMoney(signal.amount),
      evidence: signal.evidence.map((item) => ({
        amount: deserializeMoney(item.amount),
        date: calendarDateSchema.parse(item.date),
      })),
      periodDays: signal.periodDays!,
      reviewState: signal.currentDecision ?? reviewStates.get(signal.id) ?? null,
      sourceReference: signal.id,
      sourceVersion: [run.engineVersion, run.rulesetVersion, run.policyVersion].join("/"),
    }));
}

async function profileForActor(actor: Actor, input?: ForecastDependencies) {
  const profile = await loadProfile(
    actor,
    input?.profileRepository === undefined
      ? undefined : { repository: input.profileRepository },
  );
  if (profile === null) {
    throw new InputValidationError([{ field: "profile", message: "A profile is required." }]);
  }
  return profile;
}

export async function createOperationalForecast(
  actor: Actor,
  command: CreateForecastCommand,
  input?: ForecastDependencies,
): Promise<ForecastSnapshot> {
  const profile = await profileForActor(actor, input);
  const resolved = await dependencies(input);
  const baseline = await resolved.engine.findLatestForActorWithMinimumHorizon(
    actor,
    command.horizonDays,
  );
  if (baseline === null) {
    throw new InputValidationError([{
      field: "baseline",
      message: "Create a Financial Engine snapshot for the selected horizon first.",
    }]);
  }
  const freshnessReasons = await assessFinancialEngineSnapshotFreshness(
    actor,
    profile,
    baseline,
    input?.freshness,
  );
  const run = await runTransactionIntelligence(
    actor,
    command.idempotencyKey,
    input?.transactionIntelligence,
  );
  const intelligenceRepository = input?.transactionIntelligence?.repository ??
    (await getTransactionIntelligenceRepository());
  const reviewStates = await intelligenceRepository.latestReviewDecisionsForActor(actor);
  let result;
  try {
    result = calculateForecast({
      baseline: baseline.result,
      dataFreshness: freshnessReasons.length === 0 ? "FRESH" : "STALE",
      freshnessReasons,
      horizonDays: command.horizonDays,
      intelligenceEvidence: evidenceFromRun(run, reviewStates),
      sourceReferencePrefix: baseline.id,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InputValidationError([{ field: "forecast", message: error.message }]);
    }
    throw error;
  }
  return resolved.forecast.createForecastForActor(actor, result, {
    idempotencyKey: command.idempotencyKey,
    intelligenceRunId: run.id,
    sourceSnapshotId: baseline.id,
  });
}

function scenarioAdjustments(
  command: CreateForecastScenarioCommand,
  currency: string,
): readonly ForecastScenarioAdjustment[] {
  return command.adjustments.map((adjustment, index) => {
    let amount;
    try {
      amount = parseMajorMoney(adjustment.amount);
    } catch {
      throw new InputValidationError([{
        field: `adjustments.${index}.amount`,
        message: "Use a valid exact money amount.",
      }]);
    }
    if (amount.currency !== currency || amount.amountMinor <= 0n) {
      throw new InputValidationError([{
        field: `adjustments.${index}.amount`,
        message: `Use a positive amount in ${currency}.`,
      }]);
    }
    return {
      amount,
      calendarDate: adjustment.calendarDate,
      kind: adjustment.kind,
    };
  });
}

export async function createForecastScenario(
  actor: Actor,
  command: CreateForecastScenarioCommand,
  input?: ForecastDependencies,
): Promise<ForecastScenario> {
  const resolved = await dependencies(input);
  const forecast = await resolved.forecast.findForecastForActor(actor, command.forecastId);
  if (forecast === null) throw new NotFoundError();
  let result;
  try {
    result = calculateForecastScenario(
      forecast.result,
      scenarioAdjustments(command, forecast.result.currency),
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InputValidationError([{ field: "scenario", message: error.message }]);
    }
    throw error;
  }
  return resolved.forecast.createScenarioForActor(
    actor,
    forecast.id,
    result,
    {
      idempotencyKey: command.idempotencyKey,
      name: command.name,
      note: command.note,
    },
  );
}

export async function loadForecastCenter(
  actor: Actor,
  input?: ForecastDependencies,
): Promise<ForecastCenterView> {
  const profile = await profileForActor(actor, input);
  const resolved = await dependencies(input);
  const [forecasts, scenarios] = await Promise.all([
    resolved.forecast.listForecastsForActor(actor, 10),
    resolved.forecast.listScenariosForActor(actor, 20),
  ]);
  return {
    currency: profile.fields.primaryCurrency,
    defaultHorizonDays: DEFAULT_FORECAST_HORIZON,
    forecasts: forecasts.map(toForecastSnapshotView),
    scenarios: scenarios.map(toForecastScenarioView),
    supportedHorizons: FORECAST_HORIZONS,
  };
}
