import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { budgetCategoryIdSchema, rolloverPolicySchema, systemBudgetCategoryKeys } from "@/lib/budgets/budget";
import { stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const settings = z.object({ hidden: z.boolean(), label: z.string().min(1).max(80).nullable(),
  rolloverPolicy: rolloverPolicySchema, sortOrder: z.number().int().min(0).max(10000) }).strict();
const category = z.object({ _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId),
  ...settings.shape, categoryId: budgetCategoryIdSchema, kind: z.enum(["custom", "system"]),
  systemKey: z.enum(systemBudgetCategoryKeys).nullable(), createdAt: z.date(), updatedAt: z.date(), version: revision,
  idempotencyKeyHash: hash.optional(), idempotencyPayloadHash: hash.optional(),
  auditTrail: z.array(z.object({ action: z.enum(["created", "updated"]), actorUserId: z.instanceof(ObjectId),
    at: z.date(), revision, before: settings.nullable(), after: settings }).strict()).min(1),
}).strict();
const correction = z.object({ _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId), actorUserId: z.instanceof(ObjectId),
  at: z.date(), fromCategoryId: budgetCategoryIdSchema.nullable(), toCategoryId: budgetCategoryIdSchema,
  transactionId: z.instanceof(ObjectId), reason: z.string().min(3).max(300),
  idempotencyKeyHash: hash, idempotencyPayloadHash: hash }).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const fail = (): never => { throw new Error("Budget category recovery requires review"); };

export function projectRecoveryBudgetCategory(input: Document): Document {
  try {
    assertRecoveryContent(input);
    // budget-category-v2: before the writer fix, category updates also persisted the command's expectedVersion.
    // Every such write leaves it at exactly version - 1; anything else still fails. It is dropped, never restored.
    const { expectedVersion, ...clean } = input;
    if (expectedVersion !== undefined && expectedVersion !== clean.version - 1) return fail();
    const row = category.parse(clean);
    if ((row.idempotencyKeyHash === undefined) !== (row.idempotencyPayloadHash === undefined)
      || row.auditTrail.length !== row.version) return fail();
    if (row.kind === "custom") {
      if (row.systemKey !== null || row.categoryId !== `custom:${row._id.toHexString()}`
        || row.idempotencyKeyHash === undefined || row.idempotencyPayloadHash === undefined) return fail();
    } else if (row.systemKey === null || row.categoryId !== `system:${row.systemKey}`) return fail();
    for (const [index, event] of row.auditTrail.entries()) {
      if (!event.actorUserId.equals(row.userId) || event.revision !== index + 1) return fail();
      if (index === 0) {
        // System defaults are virtual; their first persisted event is an update.
        if (row.kind === "custom" ? event.action !== "created" || event.before !== null
          : event.action !== "updated" || event.before === null) return fail();
      } else if (event.action !== "updated" || stable(event.before) !== stable(row.auditTrail[index - 1]!.after)) return fail();
    }
    const current = { hidden: row.hidden, label: row.label, rolloverPolicy: row.rolloverPolicy, sortOrder: row.sortOrder };
    if (stable(current) !== stable(row.auditTrail[row.auditTrail.length - 1]!.after)) return fail();
    return clean;
  } catch { return fail(); }
}

export function projectRecoveryBudgetCorrection(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = correction.parse(input);
    if (!row.actorUserId.equals(row.userId)) return fail();
    // Transaction/category closure and original request-hash verification are separate gates.
    return input;
  } catch { return fail(); }
}
