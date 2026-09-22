import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateGoalProgress } from "@/lib/domain/goals/goal-engine";
import { money } from "@/lib/domain/money/money";
import { GOAL_ENGINE_VERSION, GOAL_POLICY_VERSION } from "@/lib/goals/goal";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const names = ["goalDefinitions", "goalProgress", "goalCommandReceipts"] as const;
function fixtures(): Record<typeof names[number], Document> {
  const at = new Date("2026-09-22T00:00:00Z"); const owner = new ObjectId(); const goalId = new ObjectId(); const definitionId = new ObjectId();
  const high = money(9007199254740993n, "ILS"); const zero = money(0n, "ILS");
  return {
    goalDefinitions: { _id: definitionId, userId: owner, goalId, createdAt: at, definitionHash: "a".repeat(64), idempotencyKeyHash: "b".repeat(64),
      schemaVersion: 1, version: 1, targetDate: null, configuration: toStoredDomainValue({ kind: "custom", direction: "increase", metricLabel: "Synthetic", targetAmount: high }),
      reportedEvidence: toStoredDomainValue({ capturedAt: at, currentValue: zero, startingValue: zero, targetAmount: high, goalRecordVersion: 1 }) },
    goalProgress: { _id: new ObjectId(), userId: owner, goalId, goalDefinitionId: definitionId, goalVersion: 1, createdAt: at, evaluatedAt: at,
      evaluationDate: "2026-09-22", timeZone: "Asia/Jerusalem", engineVersion: GOAL_ENGINE_VERSION, policyVersion: GOAL_POLICY_VERSION,
      evidenceHash: "c".repeat(64), idempotencyKeyHash: "d".repeat(64), schemaVersion: 1, milestonesCrossed: [], reason: "baseline_established",
      sourceReferences: [{ id: goalId.toHexString(), kind: "goal_record", version: 1 }], metricFacts: toStoredDomainValue([{ key: "synthetic", value: zero }]),
      result: toStoredDomainValue(calculateGoalProgress({ baselineValue: zero, currentValue: zero, targetValue: high, direction: "increase", evaluationDate: "2026-09-22",
        previous: null, sustainedSuccessDays: 1, verification: "manual_unverified" })) },
    goalCommandReceipts: { _id: new ObjectId(), userId: owner, recordId: definitionId, createdAt: at, commandKind: "definition",
      idempotencyKeyHash: "e".repeat(64), payloadHash: "f".repeat(64), schemaVersion: 1 },
  };
}
describe.each(names)("%s recovery schema", name => {
  it("preserves the original BSON without promoting reported progress or replaying commands", () => {
    const row = fixtures()[name]; const before = BSON.serialize(row);
    expect(initialRecoverySchemas[name]?.project(row)).toEqual(row);
    expect(BSON.serialize(initialRecoverySchemas[name]!.project(row))).toEqual(before);
  });
  it("rejects unknown fields and malformed identity without exposing submitted content", () => {
    const row = fixtures()[name];
    expect(() => initialRecoverySchemas[name]?.project({ ...row, unexpected: "synthetic-private-marker" })).toThrow();
    expect(() => initialRecoverySchemas[name]?.project({ ...row, userId: "synthetic-private-marker" })).toThrow();
  });
});
describe("goal recovery nested evidence", () => {
  it("rejects unknown nested fields and mixed money rather than normalizing them", () => {
    const row = fixtures().goalDefinitions;
    expect(() => initialRecoverySchemas.goalDefinitions?.project({ ...row, configuration: { ...row.configuration, unexpected: true } })).toThrow();
    row.reportedEvidence.currentValue.currency = "USD";
    expect(() => initialRecoverySchemas.goalDefinitions?.project(row)).toThrow();
    const progress = fixtures().goalProgress;
    expect(() => initialRecoverySchemas.goalProgress?.project({ ...progress, result: { ...progress.result, unexpected: true } })).toThrow();
    expect(() => initialRecoverySchemas.goalProgress?.project({ ...progress, metricFacts: [{ ...progress.metricFacts[0], unexpected: true }] })).toThrow();
    expect(() => initialRecoverySchemas.goalProgress?.project({ ...progress, result: { ...progress.result,
      currentValue: { ...progress.result.currentValue, unexpected: true } } })).toThrow();
    progress.result.currentValue.amountMinor = Long.fromBigInt(1n, true);
    expect(() => initialRecoverySchemas.goalProgress?.project(progress)).toThrow();
  });
  it("rejects invalid date/timezone, duplicate milestones and malformed source evidence", () => {
    const row = fixtures().goalProgress; const project = (r: Document) => initialRecoverySchemas.goalProgress?.project(r);
    expect(() => project({ ...row, evaluationDate: "2026-02-30" })).toThrow();
    expect(() => project({ ...row, timeZone: "not-a-zone" })).toThrow();
    expect(() => project({ ...row, milestonesCrossed: [2500, 2500] })).toThrow();
    expect(() => project({ ...row, sourceReferences: [{ ...row.sourceReferences[0], unexpected: true }] })).toThrow();
    row.result.currentValue.amountMinor = 1;
    expect(() => project(row)).toThrow();
  });
});
