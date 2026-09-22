/** Strict stored budget evidence projection, not a historical recomputation or release decision. */
import "server-only";
import { Long, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { budgetCalculationSchema, budgetCategoryIdSchema, calendarMonthSchema } from "@/lib/budgets/budget";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const storedMoney = z.object({ amountMinor: z.instanceof(Long).refine(value => !value.unsigned), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const allocation = z.object({ amount: storedMoney, categoryId: budgetCategoryIdSchema }).strict();
const allocations = z.array(allocation).max(100);
const schema = z.object({ _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId),
  allocations, carryIn: allocations, calendarMonth: calendarMonthSchema, currency: z.string().regex(/^[A-Z]{3}$/),
  closedAt: z.date().nullable(), closingSnapshot: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(), updatedAt: z.date(), status: z.enum(["open", "closed"]), version: revision,
  auditTrail: z.array(z.object({ action: z.enum(["created", "updated", "closed"]), actorUserId: z.instanceof(ObjectId),
    allocationsAfter: allocations, allocationsBefore: allocations.nullable(), at: z.date(), revision }).strict()).min(1),
}).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const fail = (): never => { throw new Error("Budget period recovery requires review"); };

export function projectRecoveryBudgetPeriod(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = schema.parse(input);
    const checkAllocations = (items: z.infer<typeof allocations>, nonnegative: boolean) => {
      if (new Set(items.map(item => item.categoryId)).size !== items.length
        || items.some(item => item.amount.currency !== row.currency || (nonnegative && item.amount.amountMinor.toBigInt() < 0n))) return fail();
    };
    checkAllocations(row.allocations, true); checkAllocations(row.carryIn, false);
    if (row.auditTrail.length !== row.version) return fail();
    for (const [index, event] of row.auditTrail.entries()) {
      if (!event.actorUserId.equals(row.userId) || event.revision !== index + 1) return fail();
      checkAllocations(event.allocationsAfter, true);
      if (index === 0) {
        if (event.action !== "created" || event.allocationsBefore !== null) return fail();
      } else {
        if (event.action === "created" || event.allocationsBefore === null) return fail();
        checkAllocations(event.allocationsBefore, true);
        if (stable(event.allocationsBefore) !== stable(row.auditTrail[index - 1]!.allocationsAfter)) return fail();
      }
      if (event.action === "closed" && (index !== row.auditTrail.length - 1 || row.status !== "closed"
        || stable(event.allocationsBefore) !== stable(event.allocationsAfter))) return fail();
    }
    const last = row.auditTrail[row.auditTrail.length - 1]!;
    if (stable(last.allocationsAfter) !== stable(row.allocations)) return fail();
    if (row.status === "open") {
      if (row.closedAt !== null || row.closingSnapshot !== null) return fail();
    } else {
      if (row.closedAt === null || row.closingSnapshot === null || last.action !== "closed") return fail();
      const snapshot = budgetCalculationSchema.parse(fromStoredDomainValue(row.closingSnapshot));
      // Roundtrip comparison also rejects nested fields that the existing domain schema would strip.
      if (stable(toStoredDomainValue(snapshot)) !== stable(row.closingSnapshot) || snapshot.calendarMonth !== row.calendarMonth) return fail();
      const amounts = [...Object.values(snapshot).filter(value => typeof value === "object" && value !== null && "currency" in value),
        ...snapshot.lines.flatMap(line => Object.values(line).filter(value => typeof value === "object" && value !== null && "currency" in value))];
      if (amounts.some(value => (value as { currency: string }).currency !== row.currency)
        || new Set(snapshot.lines.map(line => line.categoryId)).size !== snapshot.lines.length) return fail();
    }
    // Category/source closure and independent evidence consistency remain quarantine release prerequisites.
    return input;
  } catch { return fail(); }
}
