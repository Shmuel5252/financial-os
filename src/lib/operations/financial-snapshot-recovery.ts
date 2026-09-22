/** Both stored financialSnapshots variants; preserves evidence, never recomputes/reclassifies it. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { storedFinancialSnapshotSourceSchema } from "@/lib/financial-snapshots/financial-snapshot";
import { storedFinancialEngineResultSchema } from "@/lib/financial-engine/financial-engine-snapshot";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const common = { _id: id, userId: id, idempotencyKeyHash: hash, schemaVersion: z.literal(1) };
const audit = z.object({ actorUserId: id, at: z.date(), changedFields: z.array(z.string()), revision: z.literal(1) });
const manifest = z.object({ ...common, kind: z.literal("source_manifest"), capturedAt: z.date(), primaryCurrency: z.string().regex(/^[A-Z]{3}$/),
  sources: z.array(storedFinancialSnapshotSourceSchema), auditTrail: z.array(audit.extend({ action: z.literal("created"), source: z.literal("manual") }).strict()).length(1) }).strict();
const engine = z.object({ ...common, kind: z.literal("engine_result"), calculatedAt: z.date(), engineVersion: z.string().min(1),
  policyVersion: z.string().min(1), inputHash: hash, sourceManifestId: id, result: z.record(z.string(), z.unknown()),
  auditTrail: z.array(audit.extend({ action: z.literal("calculated"), source: z.literal("financial_engine") }).strict()).length(1) }).strict();
const schema = z.discriminatedUnion("kind", [manifest, engine]);
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const fail = (): never => { throw new Error("Financial snapshot recovery requires review"); };
function checkCurrency(value: unknown, currency: string): void {
  if (Array.isArray(value)) { for (const item of value) checkCurrency(item, currency); return; }
  if (typeof value !== "object" || value === null) return;
  if ("amountMinor" in value && "currency" in value) { if (value.currency !== currency) return fail(); return; }
  for (const item of Object.values(value)) checkCurrency(item, currency);
}
export function projectRecoveryFinancialSnapshot(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = schema.parse(input);
    if (stable(row) !== stable(input)) return fail();
    const event = row.auditTrail[0]!;
    if (!event.actorUserId.equals(row.userId)) return fail();
    if (row.kind === "source_manifest") {
      if (event.at.getTime() !== row.capturedAt.getTime() || stable(event.changedFields) !== stable(["primaryCurrency", "sources"])
        || new Set(row.sources.map(source => source.section)).size !== row.sources.length) return fail();
      for (const source of row.sources) {
        if (new Set(source.records.map(record => record.id.toLowerCase())).size !== source.records.length
          || source.records.some(record => !Number.isSafeInteger(record.version))) return fail();
      }
    } else {
      if (event.at.getTime() !== row.calculatedAt.getTime() || stable(event.changedFields) !== stable(["inputHash", "result", "sourceManifestId"])) return fail();
      const result = storedFinancialEngineResultSchema.parse(fromStoredDomainValue(row.result));
      if (stable(toStoredDomainValue(result)) !== stable(row.result) || row.engineVersion !== result.engineVersion || row.policyVersion !== result.policyVersion) return fail();
      checkCurrency(result, result.currency);
    }
    // Schema fidelity is not inputHash reconstruction, cross-record closure or permission to release.
    return input;
  } catch { return fail(); }
}
