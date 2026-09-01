import { z } from "zod";

import {
  DEFAULT_FORECAST_HORIZON,
  FORECAST_HORIZONS,
  forecastResultSchema,
  forecastScenarioResultSchema,
  type ForecastEvent,
  type ForecastResult,
  type ForecastScenarioAdjustment,
  type ForecastScenarioResult,
} from "@/lib/domain/forecasts/forecast-engine";
import { moneyInputSchema } from "@/lib/domain/money/money-input";
import { serializeMoney, type SerializedMoney } from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

const forecastHorizonSchema = z.union(
  FORECAST_HORIZONS.map((value) => z.literal(value)) as [
    z.ZodLiteral<7>, z.ZodLiteral<30>, z.ZodLiteral<60>, z.ZodLiteral<90>,
  ],
);

export const createForecastCommandSchema = z.object({
  horizonDays: forecastHorizonSchema.default(DEFAULT_FORECAST_HORIZON),
  idempotencyKey: z.string().uuid(),
}).strict();

export const scenarioAdjustmentKindSchema = z.enum([
  "additional_expense",
  "additional_income",
  "card_payment",
  "expense_reduction",
  "loan_payment",
  "savings_transfer",
]);

export const createForecastScenarioCommandSchema = z.object({
  adjustments: z.array(z.object({
    amount: moneyInputSchema,
    calendarDate: calendarDateSchema,
    kind: scenarioAdjustmentKindSchema,
  }).strict()).min(1).max(20),
  forecastId: z.string().regex(/^[0-9a-f]{24}$/i),
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).nullable().default(null),
}).strict();

export type CreateForecastCommand = z.infer<typeof createForecastCommandSchema>;
export type CreateForecastScenarioCommand = z.infer<typeof createForecastScenarioCommandSchema>;

export type ForecastSnapshot = Readonly<{
  calculatedAt: Date;
  id: string;
  inputHash: string;
  intelligenceRunId: string | null;
  result: ForecastResult;
  schemaVersion: 1;
  sourceSnapshotId: string;
}>;

export type ForecastScenario = Readonly<{
  calculatedAt: Date;
  forecastId: string;
  id: string;
  inputHash: string;
  name: string;
  note: string | null;
  result: ForecastScenarioResult;
  schemaVersion: 1;
}>;

export type ForecastEventView = Readonly<{
  amount: SerializedMoney;
  calendarDate: string;
  confidence: ForecastEvent["confidence"];
  id: string;
  provenance: ForecastEvent["provenance"] & Readonly<{ alias: string }>;
  source: ForecastEvent["source"];
  truthStatus: ForecastEvent["truthStatus"];
  type: ForecastEvent["type"];
}>;

export type ForecastSnapshotView = Readonly<{
  calculatedAt: string;
  confidence: ForecastResult["confidence"];
  confidenceReasons: ForecastResult["confidenceReasons"];
  confidenceVersion: string;
  confirmedEndBalance: SerializedMoney;
  confirmedMinimumBalance: SerializedMoney;
  currency: string;
  currentSafeToSpend: SerializedMoney;
  dataFreshness: ForecastResult["dataFreshness"];
  duplicateEstimatesSuppressed: number;
  engineVersion: string;
  estimatedEventCount: number;
  evaluationDate: string;
  events: readonly ForecastEventView[];
  firstBelowSafetyMarginDate: string | null;
  firstBelowZeroDate: string | null;
  freshnessReasons: readonly string[];
  horizonDays: number;
  horizonEndDate: string;
  id: string;
  materialObligations: readonly Readonly<{
    amount: SerializedMoney;
    calendarDate: string;
    provenanceAlias: string;
  }>[];
  policyVersion: string;
  projectedEndBalance: SerializedMoney;
  projectedMinimumBalance: SerializedMoney;
  projectedMinimumDate: string;
  schemaVersion: 1;
  sourceEngineVersion: string;
  sourcePolicyVersion: string;
  timeline: readonly Readonly<{
    amount: SerializedMoney;
    calendarDate: string;
    confirmedBalance: SerializedMoney;
    eventId: string;
    projectedBalance: SerializedMoney;
    safetyMargin: SerializedMoney;
    truthStatus: ForecastEvent["truthStatus"];
    type: ForecastEvent["type"] | "margin_boundary";
  }>[];
}>;

export type ForecastScenarioView = Readonly<{
  calculatedAt: string;
  forecastId: string;
  id: string;
  name: string;
  note: string | null;
  result: Readonly<{
    adjustments: readonly Readonly<{
      amount: SerializedMoney;
      calendarDate: string;
      kind: ForecastScenarioAdjustment["kind"];
    }>[];
    baselineProjectedEndBalance: SerializedMoney;
    currency: string;
    engineVersion: string;
    firstBelowSafetyMarginDate: string | null;
    firstBelowZeroDate: string | null;
    horizonDays: number;
    horizonEndDate: string;
    policyVersion: string;
    projectedEndBalance: SerializedMoney;
    projectedEndDelta: SerializedMoney;
    projectedMinimumBalance: SerializedMoney;
    projectedMinimumDate: string;
  }>;
  schemaVersion: 1;
}>;

export type ForecastCenterView = Readonly<{
  currency: string;
  defaultHorizonDays: number;
  forecasts: readonly ForecastSnapshotView[];
  scenarios: readonly ForecastScenarioView[];
  supportedHorizons: readonly number[];
}>;

export const storedForecastResultSchema = forecastResultSchema;
export const storedForecastScenarioResultSchema = forecastScenarioResultSchema;

function aliasMap(events: readonly ForecastEvent[]) {
  const references = [...new Set(events.map((event) => event.sourceReference))];
  return new Map(references.map((reference, index) => [reference, `מקור-${index + 1}`]));
}

export function toForecastSnapshotView(snapshot: ForecastSnapshot): ForecastSnapshotView {
  const result = snapshot.result;
  const aliases = aliasMap(result.events);
  return {
    calculatedAt: snapshot.calculatedAt.toISOString(),
    confidence: result.confidence,
    confidenceReasons: result.confidenceReasons,
    confidenceVersion: result.confidenceVersion,
    confirmedEndBalance: serializeMoney(result.confirmedEndBalance),
    confirmedMinimumBalance: serializeMoney(result.confirmedMinimumBalance),
    currency: result.currency,
    currentSafeToSpend: serializeMoney(result.currentSafeToSpend),
    dataFreshness: result.dataFreshness,
    duplicateEstimatesSuppressed: result.duplicateEstimatesSuppressed,
    engineVersion: result.engineVersion,
    estimatedEventCount: result.estimatedEventCount,
    evaluationDate: result.evaluationDate,
    events: result.events.map((event) => ({
      amount: serializeMoney(event.amount),
      calendarDate: event.calendarDate,
      confidence: event.confidence,
      id: event.id,
      provenance: {
        ...event.provenance,
        alias: aliases.get(event.sourceReference) ?? "מקור",
      },
      source: event.source,
      truthStatus: event.truthStatus,
      type: event.type,
    })),
    firstBelowSafetyMarginDate: result.firstBelowSafetyMarginDate,
    firstBelowZeroDate: result.firstBelowZeroDate,
    freshnessReasons: result.freshnessReasons,
    horizonDays: result.horizonDays,
    horizonEndDate: result.horizonEndDate,
    id: snapshot.id,
    materialObligations: result.materialObligations.map((item) => ({
      amount: serializeMoney(item.amount),
      calendarDate: item.calendarDate,
      provenanceAlias: aliases.get(item.sourceReference) ?? "מקור",
    })),
    policyVersion: result.policyVersion,
    projectedEndBalance: serializeMoney(result.projectedEndBalance),
    projectedMinimumBalance: serializeMoney(result.projectedMinimumBalance),
    projectedMinimumDate: result.projectedMinimumDate,
    schemaVersion: snapshot.schemaVersion,
    sourceEngineVersion: result.sourceEngineVersion,
    sourcePolicyVersion: result.sourcePolicyVersion,
    timeline: result.timeline.map((point) => ({
      amount: serializeMoney(point.amount),
      calendarDate: point.calendarDate,
      confirmedBalance: serializeMoney(point.confirmedBalance),
      eventId: point.eventId,
      projectedBalance: serializeMoney(point.projectedBalance),
      safetyMargin: serializeMoney(point.safetyMargin),
      truthStatus: point.truthStatus,
      type: point.type,
    })),
  };
}

export function toForecastScenarioView(scenario: ForecastScenario): ForecastScenarioView {
  return {
    calculatedAt: scenario.calculatedAt.toISOString(),
    forecastId: scenario.forecastId,
    id: scenario.id,
    name: scenario.name,
    note: scenario.note,
    result: {
      adjustments: scenario.result.adjustments.map((item) => ({
        amount: serializeMoney(item.amount),
        calendarDate: item.calendarDate,
        kind: item.kind,
      })),
      baselineProjectedEndBalance: serializeMoney(scenario.result.baselineProjectedEndBalance),
      currency: scenario.result.currency,
      engineVersion: scenario.result.engineVersion,
      firstBelowSafetyMarginDate: scenario.result.firstBelowSafetyMarginDate,
      firstBelowZeroDate: scenario.result.firstBelowZeroDate,
      horizonDays: scenario.result.horizonDays,
      horizonEndDate: scenario.result.horizonEndDate,
      policyVersion: scenario.result.policyVersion,
      projectedEndBalance: serializeMoney(scenario.result.projectedEndBalance),
      projectedEndDelta: serializeMoney(scenario.result.projectedEndDelta),
      projectedMinimumBalance: serializeMoney(scenario.result.projectedMinimumBalance),
      projectedMinimumDate: scenario.result.projectedMinimumDate,
    },
    schemaVersion: scenario.schemaVersion,
  };
}

export function parseForecastCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseUntrusted(schema, input);
}
