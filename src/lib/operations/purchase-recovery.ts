/** Saved hypothetical evidence only: no financial mutation or risk reclassification. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { purchaseSimulationParametersDomainSchema, purchaseSimulationEvaluationDomainSchema } from "@/lib/purchase-simulations/purchase-simulation";
import { generateInstallmentSchedule } from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { fromStoredDomainValue, toStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { projectRecoveryFinancialSnapshot } from "@/lib/operations/financial-snapshot-recovery";
import { projectRecoveryBudgetPeriod } from "@/lib/operations/budget-period-recovery";

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

/** Direct metadata/owner checks; no historical risk recomputation or transitive release proof. */
export function inspectPurchaseRecoveryLinks(simulations: readonly Document[], snapshots: readonly Document[], periods: readonly Document[]) {
  try {
    const index = (rows: readonly Document[], project: (row: Document) => Document) => {
      const result = new Map<string, Document>();
      for (const input of rows) {
        const row = project(input); const id = row._id.toHexString();
        if (result.has(id)) return fail(); result.set(id, row);
      }
      return result;
    };
    const saved = index(simulations, projectRecoveryPurchaseSimulation);
    const engines = index(snapshots, projectRecoveryFinancialSnapshot);
    const budgets = index(periods, projectRecoveryBudgetPeriod);
    const retries = new Set<string>(); let matched = 0;
    const unresolved = { missing: 0, changed: 0, historicalEvaluations: saved.size };
    for (const row of saved.values()) {
      const key = `${row.userId.toHexString()}:${row.idempotencyKeyHash}`;
      if (retries.has(key)) return fail(); retries.add(key);
      const target = engines.get(row.sourceSnapshotId.toHexString());
      const reference = row.evaluation.sourceSnapshot;
      if (!target) unresolved.missing++;
      else {
        if (target.kind !== "engine_result" || !target.userId.equals(row.userId)) return fail();
        if (target.inputHash !== reference.inputHash || target.engineVersion !== reference.engineVersion
          || target.policyVersion !== reference.policyVersion || target.calculatedAt.getTime() !== reference.calculatedAt.getTime()
          || target.sourceManifestId.toHexString() !== reference.sourceManifestId
          || target.result.currency !== row.input.totalPurchasePrice.currency) unresolved.changed++;
        else matched++;
      }
      const period = row.evaluation.budgetPeriodReference;
      if (period !== null) {
        const budget = budgets.get(period.id.toLowerCase());
        if (!budget) unresolved.missing++;
        else {
          if (!budget.userId.equals(row.userId)) return fail();
          if (budget.calendarMonth !== period.calendarMonth || budget.version !== period.version) unresolved.changed++;
          else matched++;
        }
      }
    }
    return { policy: "purchase-recovery-links-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
