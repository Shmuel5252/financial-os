import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { money } from "@/lib/domain/money/money";
import type { ProgressJourneyDependencies } from "@/lib/progress-journeys/progress-journey-service";
import { collectProgressObservationsForActor } from "@/lib/progress-journeys/progress-journey-service";

const actor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
const goalId = new ObjectId().toHexString();

function dependencies(): ProgressJourneyDependencies {
  const goalProgress = [25, 50, 75, 100].map((milestone, index) => ({
    engineVersion: "goal-engine-v1",
    evaluatedAt: new Date(`2026-0${index + 1}-28T10:00:00.000Z`),
    evaluationDate: `2026-0${index + 1}-28`,
    goalId,
    goalVersion: 1,
    id: new ObjectId().toHexString(),
    milestonesCrossed: [milestone * 100],
    policyVersion: "goal-policy-v1",
    result: { normalizedProgressBasisPoints: milestone * 100, status: "active", verification: "verified" },
  }));
  const closedBudget = (month: string, remaining: bigint) => ({
    calendarMonth: month,
    closedAt: new Date(`${month}-28T10:00:00.000Z`),
    closingSnapshot: { lines: [{ remaining: money(remaining, "ILS") }], unallocated: money(remaining, "ILS") },
    id: new ObjectId().toHexString(),
    status: "closed",
    version: 1,
  });
  const report = {
    createdAt: new Date("2026-03-31T10:00:00.000Z"), id: new ObjectId().toHexString(), reportVersion: 1,
    report: { engineVersion: "financial-report-v1", period: { kind: "month", value: "2026-03" }, periodEnd: "2026-03-31", policyVersion: "phase-16-report-policy-v1", scope: { kind: "personal" }, sections: { cashFlow: [] }, sourceFingerprint: "a".repeat(64) },
  };
  return {
    budgetRepository: { listPeriodsForActor: async () => [closedBudget("2026-01", 1n), closedBudget("2026-02", -1n), closedBudget("2026-03", 1n)] } as never,
    engineRepository: { listForActor: async () => ({ nextCursor: null, snapshots: [] }) } as never,
    engineFreshnessAssessor: async () => [],
    goalRepository: { listAllProgressForActor: async () => goalProgress } as never,
    goalsRepository: { listAllForActor: async () => [{ fields: { currentValue: money(10_000n, "ILS"), priority: 1, startingValue: money(0n, "ILS"), targetAmount: money(10_000n, "ILS"), targetDate: null, title: "קרן חירום", type: "emergency_fund" }, id: goalId }] } as never,
    profileLoader: async () => ({ fields: { timeZone: "Asia/Jerusalem" } } as never),
    reportRepository: { listForActor: async () => [report] } as never,
    repository: {} as never,
  };
}

describe("Phase 17 authorized source projection", () => {
  it("consumes Goal Engine's exact 25/50/75/100 milestones without inventing another goal formula", async () => {
    const observations = await collectProgressObservationsForActor(actor, "backfill", dependencies());
    expect(observations.filter((item) => item.dimension === "goal_milestone").map((item) => item.value)).toEqual([25, 50, 75, 100]);
    expect(observations.filter((item) => item.dimension === "goal_milestone").every((item) => item.ruleId === "goal-engine-milestone" && item.sourceReferences[0]?.kind === "goal_progress")).toBe(true);
  });

  it("preserves budget regression/recovery periods and marks insufficient report evidence unknown", async () => {
    const observations = await collectProgressObservationsForActor(actor, "backfill", dependencies());
    expect(observations.filter((item) => item.dimension === "within_budget").map((item) => item.outcome)).toEqual(["achieved", "not_achieved", "achieved"]);
    expect(observations.find((item) => item.dimension === "positive_cash_flow")?.outcome).toBe("unknown");
    expect(observations.find((item) => item.dimension === "regular_review")?.outcome).toBe("achieved");
  });

  it("uses only the latest eligible evidence for live evaluation and never fabricates provider evidence", async () => {
    const observations = await collectProgressObservationsForActor(actor, "live", dependencies());
    expect(observations.filter((item) => item.dimension === "goal_milestone").map((item) => item.value)).toEqual([100]);
    expect(observations.filter((item) => item.dimension === "within_budget")).toHaveLength(1);
    expect(JSON.stringify(observations)).not.toContain("open_banking");
    expect(JSON.stringify(observations)).not.toContain("anthropic");
  });

  it("degrades stale live engine evidence to unknown instead of celebrating it", async () => {
    const input = dependencies();
    const stale = {
      ...input,
      engineFreshnessAssessor: async () => ["source_changed"],
      engineRepository: { listForActor: async () => ({ nextCursor: null, snapshots: [{
        calculatedAt: new Date("2026-09-02T10:00:00.000Z"), engineVersion: "financial-engine-v1", id: new ObjectId().toHexString(), inputHash: "b".repeat(64), policyVersion: "phase-3-policy-v1",
        result: {
          availableCash: money(1_000n, "ILS"), evaluationDate: "2026-09-02", minimumConfirmedBalance: money(1_000n, "ILS"), safetyMarginAtEvaluation: money(500n, "ILS"), timeline: [],
        },
      }] }) } as never,
    };
    const observations = await collectProgressObservationsForActor(actor, "live", stale);
    expect(observations.filter((item) => item.dimension === "no_overdraft" || item.dimension === "safety_margin").map((item) => item.outcome)).toEqual(["unknown", "unknown"]);
  });
});
