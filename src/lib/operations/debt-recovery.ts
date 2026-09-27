/** Saved scenario evidence only. No historical recalculation or recovery release authority. */
import "server-only";
import { createHash } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { debtStrategyInputDomainSchema, debtStrategyComparisonDomainSchema, assertDebtStrategyVersions } from "@/lib/debt-strategies/debt-strategy";
import { fromStoredDomainValue, toStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { DEBT_STRATEGY_MAX_DEBTS } from "@/lib/domain/debt-strategies/debt-strategy-engine";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId), createdAt: z.date(), schemaVersion: z.literal(1),
  inputHash: hash, idempotencyKeyHash: hash, name: z.string().max(80).nullable(), note: z.string().max(500).nullable(),
  input: z.record(z.string(), z.unknown()), comparison: z.record(z.string(), z.unknown()),
  debtReferences: z.array(z.object({ id: z.instanceof(ObjectId), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).min(1).max(DEBT_STRATEGY_MAX_DEBTS),
  auditTrail: z.array(z.object({ action: z.literal("saved"), actorUserId: z.instanceof(ObjectId), at: z.date(),
    changedFields: z.array(z.string()), revision: z.literal(1), source: z.literal("debt_strategy") }).strict()).length(1),
}).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const fail = (): never => { throw new Error("Debt strategy recovery requires review"); };
function sameCurrency(value: unknown, currency: string): void {
  if (Array.isArray(value)) { for (const item of value) sameCurrency(item, currency); return; }
  if (value === null || typeof value !== "object") return;
  if ("amountMinor" in value && "currency" in value) { if (value.currency !== currency) return fail(); return; }
  for (const item of Object.values(value)) sameCurrency(item, currency);
}
export function projectRecoveryDebtStrategy(document: Document): Document {
  try {
    assertRecoveryContent(document); const row = schema.parse(document);
    const input = debtStrategyInputDomainSchema.parse(fromStoredDomainValue(row.input));
    const comparison = debtStrategyComparisonDomainSchema.parse(fromStoredDomainValue(row.comparison));
    assertDebtStrategyVersions(comparison);
    if (stable(toStoredDomainValue(input)) !== stable(row.input) || stable(toStoredDomainValue(comparison)) !== stable(row.comparison)) return fail();
    const event = row.auditTrail[0]!;
    if (!event.actorUserId.equals(row.userId) || event.at.getTime() !== row.createdAt.getTime()
      || stable(event.changedFields) !== stable(["input", "comparison", "name", "note"])) return fail();
    const references = row.debtReferences.map(debt => `${debt.id.toHexString()}:${debt.version}`).sort();
    if (new Set(row.debtReferences.map(debt => debt.id.toHexString())).size !== references.length
      || stable(references) !== stable(input.debts.map(debt => `${debt.id}:${debt.sourceVersion}`).sort())) return fail();
    sameCurrency(input, comparison.currency); sameCurrency(comparison, comparison.currency);
    if (input.evaluationDate !== comparison.evaluationDate || input.extraPaymentStartDate !== comparison.extraPaymentStartDate
      || stable(input.extraPayment) !== stable(comparison.extraPayment)) return fail();
    const digest = createHash("sha256").update(stable({ comparison, input, name: row.name, note: row.note }), "utf8").digest("hex");
    if (digest !== row.inputHash) return fail();
    // Hash integrity does not establish historical loan ownership/revisions or validate the underlying contract.
    return document;
  } catch { return fail(); }
}
