import { Long, ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { inspectBudgetRecoveryLinks } from "@/lib/operations/budget-recovery-links";

function fixture() {
  const owner = new ObjectId(); const at = new Date("2026-09-27T00:00:00Z"); const id = new ObjectId();
  const transaction = { _id: id, userId: owner, createdAt: at, updatedAt: at, deletedAt: null, version: 1, schemaVersion: 2,
    source: { kind: "manual" }, auditTrail: [], fields: { accountId: new ObjectId().toHexString(), category: "food", confidenceBps: 10000,
      date: "2026-09-27", destinationAccountId: null, merchant: null, notes: null, recurring: false,
      refundOfTransactionId: null, type: "expense", amount: { amountMinor: Long.fromString("9007199254740993"), currency: "ILS" } } };
  const correction = { _id: new ObjectId(), userId: owner, actorUserId: owner, at,
    fromCategoryId: null, toCategoryId: "system:food", transactionId: id, reason: "Synthetic correction",
    idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64) };
  return { categories: [] as Document[], periods: [] as Document[], transactions: [transaction], corrections: [correction] };
}

it("resolves owner-safe transaction references and virtual system categories without authorizing release", () => {
  expect(inspectBudgetRecoveryLinks(fixture())).toEqual({ policy: "budget-recovery-links-v1", releaseAllowed: false,
    matched: 1, virtualCategories: 1, unresolved: { missing: 0, inactive: 0, historicalCorrections: 1 } });
});
it("keeps missing and inactive evidence unresolved", () => {
  const input = fixture(); input.corrections[0]!.toCategoryId = `custom:${new ObjectId().toHexString()}`;
  expect(inspectBudgetRecoveryLinks({ ...input, transactions: [] }).unresolved).toEqual({ missing: 2, inactive: 0, historicalCorrections: 1 });
  const transaction: Document = input.transactions[0]!; transaction.deletedAt = new Date();
  expect(inspectBudgetRecoveryLinks(input).unresolved).toEqual({ missing: 1, inactive: 1, historicalCorrections: 1 });
});
it("rejects cross-owner transactions, duplicate records and malformed unused evidence", () => {
  const input = fixture();
  expect(() => inspectBudgetRecoveryLinks({ ...input, transactions: [{ ...input.transactions[0]!, userId: new ObjectId() }] })).toThrow();
  expect(() => inspectBudgetRecoveryLinks({ ...input, corrections: [...input.corrections, ...input.corrections] })).toThrow();
  expect(() => inspectBudgetRecoveryLinks({ ...input, categories: [{ unexpected: true }] })).toThrow();
});

it("rejects distinct records claiming the same owner-scoped retry identity", () => {
  const input = fixture();
  expect(() => inspectBudgetRecoveryLinks({ ...input, corrections: [...input.corrections,
    { ...input.corrections[0]!, _id: new ObjectId() }] })).toThrow();
  const row = { ...input.transactions[0]!, idempotencyKeyHash: "e".repeat(64), idempotencyPayloadHash: "f".repeat(64) };
  expect(() => inspectBudgetRecoveryLinks({ ...input, transactions: [row, { ...row, _id: new ObjectId() }] })).toThrow();
});

it("checks period allocation history against custom category ownership", () => {
  const input = fixture(); const owner = input.corrections[0]!.userId; const id = new ObjectId(); const at = new Date();
  const settings = { hidden: false, label: "Synthetic category", rolloverPolicy: "reset", sortOrder: 1 };
  const categoryId = `custom:${id.toHexString()}`;
  const category = { _id: id, userId: owner, ...settings, categoryId, kind: "custom", systemKey: null,
    createdAt: at, updatedAt: at, version: 1, idempotencyKeyHash: "c".repeat(64), idempotencyPayloadHash: "d".repeat(64),
    auditTrail: [{ action: "created", actorUserId: owner, at, revision: 1, before: null, after: settings }] };
  const allocation = [{ categoryId, amount: { amountMinor: Long.ONE, currency: "ILS" } }];
  const period = { _id: new ObjectId(), userId: owner, allocations: allocation, carryIn: [], calendarMonth: "2026-09", currency: "ILS",
    closedAt: null, closingSnapshot: null, createdAt: at, updatedAt: at, status: "open", version: 1,
    auditTrail: [{ action: "created", actorUserId: owner, at, revision: 1, allocationsBefore: null, allocationsAfter: allocation }] };
  expect(inspectBudgetRecoveryLinks({ ...input, categories: [category], periods: [period] }).matched).toBe(3);
  expect(inspectBudgetRecoveryLinks({ ...input, periods: [period] }).unresolved.missing).toBe(2);
  const foreign = new ObjectId();
  expect(() => inspectBudgetRecoveryLinks({ ...input, periods: [period], categories: [{ ...category, userId: foreign,
    auditTrail: [{ ...category.auditTrail[0], actorUserId: foreign }] }] })).toThrow();
});
