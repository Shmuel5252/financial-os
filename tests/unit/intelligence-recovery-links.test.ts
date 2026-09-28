import { ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { intelligenceRecoveryFixture, intelligenceDigest } from "../helpers/intelligence-recovery-fixture";
import { inspectIntelligenceRecoveryLinks as inspect } from "@/lib/operations/intelligence-recovery-links";

function fixture() {
  const { run, review } = intelligenceRecoveryFixture();
  const evidence = new Map<string, Document>();
  for (const signal of run.signals) for (const row of signal.evidence) evidence.set(row.transactionId.toHexString(), row);
  const transactions = [...evidence.values()].map(row => ({ _id: row.transactionId, userId: run.userId, schemaVersion: 2,
    version: 1, source: { kind: "manual" }, createdAt: run.createdAt, updatedAt: run.createdAt, deletedAt: null, auditTrail: [],
    fields: { accountId: new ObjectId().toHexString(), amount: row.amount, category: "other", confidenceBps: 10000,
      date: row.date, destinationAccountId: null, merchant: row.rawMerchant, notes: null, recurring: false, refundOfTransactionId: null, type: "expense" } }));
  return { runs: [run], reviews: [review], transactions, corrections: [] as Document[] };
}
it("keeps unversioned transaction references and historical inferences unresolved", () => {
  expect(inspect(fixture())).toEqual({ policy: "intelligence-recovery-links-v1", releaseAllowed: false, matched: 1,
    unresolved: { missing: 0, inactive: 0, unversioned: 2, sequenceGaps: 0, historicalRuns: 1 } });
});
it("reports missing and inactive sources and rejects cross-owner transaction/run links", () => {
  const input = fixture();
  expect(inspect({ ...input, transactions: [] }).unresolved.missing).toBe(2);
  input.transactions[0]!.deletedAt = input.runs[0]!.createdAt;
  expect(inspect(input).unresolved.inactive).toBe(1);
  expect(() => inspect({ ...input, transactions: input.transactions.map(row => ({ ...row, userId: new ObjectId() })) })).toThrow();
  const review = input.reviews[0]!; const foreign = new ObjectId();
  expect(() => inspect({ ...input, reviews: [{ ...review, userId: foreign, audit: { ...review.audit, actorId: foreign } }] })).toThrow();
  expect(inspect({ ...input, runs: [] }).unresolved.missing).toBe(1);
});
it("validates review transitions and preserves sequence gaps without fabricating decisions", () => {
  const input = fixture(); const first = input.reviews[0]!;
  const second = { ...first, _id: new ObjectId(), decision: "reopened", sequence: 2, idempotencyKeyHash: "c".repeat(64) };
  const third = { ...second, _id: new ObjectId(), decision: "confirmed", sequence: 3, idempotencyKeyHash: "d".repeat(64) };
  expect(inspect({ ...input, reviews: [third, first, second] }).matched).toBe(3);
  expect(inspect({ ...input, reviews: [third] }).unresolved.sequenceGaps).toBe(2);
  expect(() => inspect({ ...input, reviews: [{ ...first, decision: "reopened" }] })).toThrow();
  expect(() => inspect({ ...input, reviews: [first, { ...second, decision: "confirmed" }] })).toThrow();
  expect(() => inspect({ ...input, reviews: [{ ...first, signalId: "0".repeat(32) }] })).toThrow();
});
it("requires confirmed category review to link to the same owned transaction and category", () => {
  const input = fixture(); const run = input.runs[0]!; const review = input.reviews[0]!;
  const signal = run.signals[0]; signal.kind = "category_suggestion"; signal.suggestedCategoryId = "system:food";
  signal.explanationCode = "CATEGORY_CONFIRMED_HISTORY";
  signal.id = intelligenceDigest(`${signal.kind}|${signal.transactionId.toHexString()}|${signal.evidence.map((row: Document) => row.transactionId.toHexString()).sort().join(",")}`).slice(0, 32);
  review.signalId = signal.id; review.decision = "confirmed";
  const correction: Document = { _id: new ObjectId(), userId: run.userId, actorUserId: run.userId, at: run.createdAt,
    fromCategoryId: "system:other", toCategoryId: "system:food", transactionId: signal.transactionId, reason: "Synthetic correction",
    idempotencyKeyHash: "e".repeat(64), idempotencyPayloadHash: "f".repeat(64) };
  expect(() => inspect(input)).toThrow();
  review.categoryCorrectionId = correction._id;
  expect(inspect(input).unresolved.missing).toBe(1);
  input.corrections = [correction]; expect(inspect(input).matched).toBe(2);
  expect(() => inspect({ ...input, corrections: [{ ...correction, transactionId: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, corrections: [{ ...correction, toCategoryId: "system:other" }] })).toThrow();
  const foreign = new ObjectId();
  expect(() => inspect({ ...input, corrections: [{ ...correction, userId: foreign, actorUserId: foreign }] })).toThrow();
  expect(() => inspect({ ...input, runs: [], corrections: [{ ...correction, userId: foreign, actorUserId: foreign }] })).toThrow();
});
it("rejects duplicate identities, retry keys, sequences and malformed records", () => {
  const input = fixture(); const run = input.runs[0]!; const review = input.reviews[0]!;
  expect(() => inspect({ ...input, runs: [run, run] })).toThrow();
  expect(() => inspect({ ...input, runs: [run, { ...run, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, reviews: [review, { ...review, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, reviews: [review, { ...review, _id: new ObjectId(), idempotencyKeyHash: "c".repeat(64) }] })).toThrow();
  expect(() => inspect({ ...input, transactions: [...input.transactions, input.transactions[0]!] })).toThrow();
  expect(() => inspect({ ...input, runs: [{ ...run, unexpected: true }] })).toThrow();
});
