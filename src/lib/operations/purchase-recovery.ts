/** Saved hypothetical evidence only: no financial mutation or risk reclassification. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { purchaseSimulationParametersDomainSchema, purchaseSimulationEvaluationDomainSchema } from "@/lib/purchase-simulations/purchase-simulation";
import { generateInstallmentSchedule } from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { fromStoredDomainValue, toStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId), sourceSnapshotId: z.instanceof(ObjectId),
  createdAt: z.date(), schemaVersion: z.literal(1), inputHash: hash, idempotencyKeyHash: hash,
  name: z.string().max(80).nullable(), note: z.string().max(500).nullable(),
  input: z.record(z.string(), z.unknown()), evaluation: z.record(z.string(), z.unknown()),
  auditTrail: z.array(z.object({ action: z.literal("saved"), actorUserId: z.instanceof(ObjectId), at: z.date(),
    changedFields: z.array(z.string()), revision: z.literal(1), source: z.literal("purchase_simulation") }).strict()).length(1),
}).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const fail = (): never => { throw new Error("Purchase simulation recovery requires review"); };
function sameCurrency(value: unknown, currency: string): void {
  if (Array.isArray(value)) { for (const item of value) sameCurrency(item, currency); return; }
  if (value === null || typeof value !== "object") return;
  if ("amountMinor" in value && "currency" in value) { if (value.currency !== currency) return fail(); return; }
  for (const item of Object.values(value)) sameCurrency(item, currency);
}
export function projectRecoveryPurchaseSimulation(document: Document): Document {
  try {
    assertRecoveryContent(document); const row = schema.parse(document);
    const input = purchaseSimulationParametersDomainSchema.parse(fromStoredDomainValue(row.input));
    const evaluation = purchaseSimulationEvaluationDomainSchema.parse(fromStoredDomainValue(row.evaluation));
    if (stable(row.input) !== stable(toStoredDomainValue(input)) || stable(row.evaluation) !== stable(toStoredDomainValue(evaluation))) return fail();
    const event = row.auditTrail[0]!;
    if (!event.actorUserId.equals(row.userId) || event.at.getTime() !== row.createdAt.getTime()
      || stable(event.changedFields) !== stable(["input", "evaluation", "name", "note"])) return fail();
    if (row.sourceSnapshotId.toHexString() !== input.sourceSnapshotId || evaluation.sourceSnapshot.id !== input.sourceSnapshotId) return fail();
    const result = evaluation.result; const currency = input.totalPurchasePrice.currency;
    sameCurrency(input, currency); sameCurrency(evaluation, currency);
    if (input.totalPurchasePrice.amountMinor <= 0n || input.charges.some(charge => charge.amount.amountMinor <= 0n || charge.label.trim().length === 0)
      || (input.inputMode === "one_time" && input.installmentCount !== 1)
      || (input.inputMode === "installments" && input.installmentCount < 2)) return fail();
    const total = input.charges.reduce((amount, charge) => amount + charge.amount.amountMinor, input.totalPurchasePrice.amountMinor);
    if (result.trueFinancedCost.amountMinor !== total || stable(result.totalPurchasePrice) !== stable(input.totalPurchasePrice)
      || stable(result.charges) !== stable(input.charges)) return fail();
    if (stable(result.installmentSchedule) !== stable(generateInstallmentSchedule(result.trueFinancedCost, input.proposedDate, input.installmentCount))) return fail();
    // These local evidence invariants do not reconstruct the historical baseline, classification or source hash.
    return document;
  } catch { return fail(); }
}
