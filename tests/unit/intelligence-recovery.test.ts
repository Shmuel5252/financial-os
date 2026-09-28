import { BSON, ObjectId } from "mongodb";
import { expect, it } from "vitest";
import { intelligenceRecoveryFixture, intelligenceDigest } from "../helpers/intelligence-recovery-fixture";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const runProject = (row: ReturnType<typeof intelligenceRecoveryFixture>["run"]) => initialRecoverySchemas.transactionIntelligenceRuns?.project(row);
const reviewProject = (row: ReturnType<typeof intelligenceRecoveryFixture>["review"]) => initialRecoverySchemas.transactionIntelligenceReviews?.project(row);
it("preserves exact stored signal/evidence BSON and immutable user review", () => {
  const { run, review } = intelligenceRecoveryFixture();
  expect(runProject(run)).toEqual(run); expect(reviewProject(review)).toEqual(review);
  expect(BSON.serialize(runProject(run)!)).toEqual(BSON.serialize(run));
  expect(BSON.serialize(reviewProject(review)!)).toEqual(BSON.serialize(review));
});
it("rejects foreign audit, unknown nested fields and numeric rather than int64 money", () => {
  const { run, review } = intelligenceRecoveryFixture();
  expect(() => runProject({ ...run, userId: new ObjectId() })).toThrow();
  expect(() => reviewProject({ ...review, userId: new ObjectId() })).toThrow();
  run.signals[0].evidence[0].unexpected = true; expect(() => runProject(run)).toThrow(); delete run.signals[0].evidence[0].unexpected;
  run.signals[0].amount.amountMinor = 7; expect(() => runProject(run)).toThrow();
});
it("rejects unknown engine policy, broken signal identity and request integrity", () => {
  const { run } = intelligenceRecoveryFixture();
  expect(() => runProject({ ...run, engineVersion: "unsupported" })).toThrow();
  expect(() => runProject({ ...run, reviewThresholdBps: 0 })).toThrow();
  expect(() => runProject({ ...run, idempotencyPayloadHash: "0".repeat(64) })).toThrow();
  run.signals[0].id = "0".repeat(32); expect(() => runProject(run)).toThrow();
});
it("preserves original request hashes when accepted identifier spelling was normalized in BSON", () => {
  const { review } = intelligenceRecoveryFixture();
  review.runId = new ObjectId("abcdefabcdefabcdefabcdef");
  review.idempotencyPayloadHash = intelligenceDigest(JSON.stringify({ categoryCorrectionId: null, decision: review.decision,
    runId: "AbCdEfABCdefabcdefABCDEF", signalId: review.signalId }));
  expect(reviewProject(review)).toEqual(review);
  expect(() => reviewProject({ ...review, idempotencyPayloadHash: "malformed" })).toThrow();
});
it("keeps confirmed, dismissed and reopened reviews as evidence, without applying corrections", () => {
  const { review } = intelligenceRecoveryFixture();
  for (const decision of ["confirmed", "dismissed", "reopened"] as const) {
    const categoryCorrectionId = decision === "confirmed" ? new ObjectId() : null;
    const input = { categoryCorrectionId: categoryCorrectionId?.toHexString() ?? null, decision, runId: review.runId.toHexString(), signalId: review.signalId };
    const row = { ...review, decision, categoryCorrectionId, idempotencyPayloadHash: intelligenceDigest(JSON.stringify(input)) };
    expect(reviewProject(row)).toEqual(row);
  }
  expect(() => reviewProject({ ...review, sequence: 0 })).toThrow();
  expect(() => reviewProject({ ...review, unexpected: true })).toThrow();
});
