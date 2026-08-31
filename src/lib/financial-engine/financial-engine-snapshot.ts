import { z } from "zod";

import {
  DEFAULT_HORIZON_DAYS,
  financialEngineResultSchema,
  type FinancialEngineResult,
} from "@/lib/domain/financial-engine/financial-engine";
import { utcInstantSchema } from "@/lib/domain/time/financial-time";
import type { SerializedDomainValue } from "@/lib/onboarding/manual-record";

export const createFinancialEngineSnapshotCommandSchema = z.object({
  asOf: utcInstantSchema.optional(),
  horizonDays: z.number().int().min(1).max(366).default(DEFAULT_HORIZON_DAYS),
  idempotencyKey: z.string().uuid(),
});

export const financialEngineSnapshotPageQuerySchema = z.object({
  cursor: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type FinancialEngineSnapshot = Readonly<{
  calculatedAt: Date;
  engineVersion: string;
  id: string;
  inputHash: string;
  kind: "engine_result";
  policyVersion: string;
  result: FinancialEngineResult;
  schemaVersion: 1;
  sourceManifestId: string;
}>;

export type FinancialEngineSnapshotView = Readonly<{
  calculatedAt: string;
  engineVersion: string;
  id: string;
  inputHash: string;
  kind: "engine_result";
  policyVersion: string;
  result: SerializedDomainValue;
  schemaVersion: 1;
  sourceManifestId: string;
}>;

export const storedFinancialEngineResultSchema = financialEngineResultSchema;

function serializeDomainValue(value: unknown): SerializedDomainValue {
  if (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "bigint" &&
    typeof value.currency === "string"
  ) {
    return {
      amountMinor: value.amountMinor.toString(),
      currency: value.currency,
    };
  }
  if (Array.isArray(value)) {
    return value.map(serializeDomainValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        serializeDomainValue(item),
      ]),
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  throw new RangeError("Unsupported financial engine result value.");
}

export function toFinancialEngineSnapshotView(
  snapshot: FinancialEngineSnapshot,
): FinancialEngineSnapshotView {
  return {
    calculatedAt: snapshot.calculatedAt.toISOString(),
    engineVersion: snapshot.engineVersion,
    id: snapshot.id,
    inputHash: snapshot.inputHash,
    kind: snapshot.kind,
    policyVersion: snapshot.policyVersion,
    result: serializeDomainValue(snapshot.result),
    schemaVersion: snapshot.schemaVersion,
    sourceManifestId: snapshot.sourceManifestId,
  };
}
