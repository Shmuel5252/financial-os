/** Schema-preserving operational/scenario evidence adapters. No recomputation or release authority. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { storedForecastResultSchema, storedForecastScenarioResultSchema } from "@/lib/forecasts/forecast";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const audit = z.object({ action: z.literal("calculated"), actorUserId: id, at: z.date(), changedFields: z.array(z.string()),
  revision: z.literal(1), source: z.enum(["forecast", "forecast_scenario"]) }).strict();
const common = { _id: id, userId: id, calculatedAt: z.date(), idempotencyKeyHash: hash, inputHash: hash,
  result: z.record(z.string(), z.unknown()), schemaVersion: z.literal(1), auditTrail: z.array(audit).length(1) };
const forecastSchema = z.object({ ...common, intelligenceRunId: id.nullable(), sourceSnapshotId: id }).strict();
const scenarioSchema = z.object({ ...common, forecastId: id, name: z.string().min(1).max(80), note: z.string().max(500).nullable() }).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const fail = (): never => { throw new Error("Forecast recovery requires review"); };

function checkCurrency(value: unknown, currency: string): void {
  if (Array.isArray(value)) { for (const item of value) checkCurrency(item, currency); return; }
  if (typeof value !== "object" || value === null) return;
  if ("amountMinor" in value && "currency" in value) {
    if (value.currency !== currency) return fail(); return;
  }
  for (const item of Object.values(value)) checkCurrency(item, currency);
}

function project(input: Document, scenario: boolean): Document {
  try {
    assertRecoveryContent(input);
    const row = scenario ? scenarioSchema.parse(input) : forecastSchema.parse(input);
    const event = row.auditTrail[0]!;
    const changedFields = scenario ? ["forecastId", "result", "name", "note"] : ["result", "sourceSnapshotId", "intelligenceRunId"];
    if (!event.actorUserId.equals(row.userId) || event.source !== (scenario ? "forecast_scenario" : "forecast")
      || event.at.getTime() !== row.calculatedAt.getTime() || stable(event.changedFields) !== stable(changedFields)) return fail();
    const decoded = fromStoredDomainValue(row.result);
    const result = scenario ? storedForecastScenarioResultSchema.parse(decoded) : storedForecastResultSchema.parse(decoded);
    // Existing domain parsing can strip unknown nested fields: raw BSON roundtrip must also agree.
    if (stable(toStoredDomainValue(result)) !== stable(row.result)) return fail();
    checkCurrency(result, result.currency);
    // Preserve stored inputHash; full input/source ownership and historic calculation closure remain separate.
    return input;
  } catch { return fail(); }
}
export function projectRecoveryForecast(input: Document): Document { return project(input, false); }
export function projectRecoveryForecastScenario(input: Document): Document { return project(input, true); }
