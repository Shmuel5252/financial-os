import { describe, expect, it } from "vitest";

import {
  calculateGoalProgress,
  newlyCrossedMilestones,
} from "@/lib/domain/goals/goal-engine";
import { money } from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";

function date(value: string) {
  return calendarDateSchema.parse(value);
}

describe("Phase 6 deterministic Goal Engine", () => {
  it("calculates increasing and decreasing goals with exact direction-aware progress", () => {
    const savings = calculateGoalProgress({
      baselineValue: money(0n, "ILS"),
      currentValue: money(12_500n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-08-31"),
      previous: null,
      sustainedSuccessDays: 0,
      targetValue: money(20_000n, "ILS"),
      verification: "verified",
    });
    const debt = calculateGoalProgress({
      baselineValue: money(20_000n, "ILS"),
      currentValue: money(5_000n, "ILS"),
      direction: "decrease",
      evaluationDate: date("2026-08-31"),
      previous: null,
      sustainedSuccessDays: 0,
      targetValue: money(0n, "ILS"),
      verification: "verified",
    });

    expect(savings.normalizedProgressBasisPoints).toBe(6_250);
    expect(savings.remainingGap.amountMinor).toBe(7_500n);
    expect(debt.normalizedProgressBasisPoints).toBe(7_500);
    expect(debt.remainingGap.amountMinor).toBe(5_000n);
  });

  it("preserves the raw exceeded value while separating completion from normalized display", () => {
    const result = calculateGoalProgress({
      baselineValue: money(0n, "ILS"),
      currentValue: money(25_000n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-08-31"),
      previous: null,
      sustainedSuccessDays: 0,
      targetValue: money(20_000n, "ILS"),
      verification: "verified",
    });

    expect(result.currentValue.amountMinor).toBe(25_000n);
    expect(result.rawProgressBasisPoints).toBe("12500");
    expect(result.normalizedProgressBasisPoints).toBe(10_000);
    expect(result.status).toBe("completed");
  });

  it("requires a modeled sustained-success period for stability goals", () => {
    const pending = calculateGoalProgress({
      baselineValue: money(-5_000n, "ILS"),
      currentValue: money(100n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-08-01"),
      previous: null,
      sustainedSuccessDays: 30,
      targetValue: money(0n, "ILS"),
      verification: "verified",
    });
    const completed = calculateGoalProgress({
      baselineValue: money(-5_000n, "ILS"),
      currentValue: money(200n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-08-31"),
      previous: pending,
      sustainedSuccessDays: 30,
      targetValue: money(0n, "ILS"),
      verification: "verified",
    });

    expect(pending.status).toBe("target_reached_pending_confirmation");
    expect(pending.qualifiedSince).toBe("2026-08-01");
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBe("2026-08-31");
  });

  it("shows regression, preserves historical completion, and restarts sustained qualification", () => {
    const completed = calculateGoalProgress({
      baselineValue: money(-1_000n, "ILS"),
      currentValue: money(100n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-08-31"),
      previous: {
        baselineValue: money(-1_000n, "ILS"),
        completedAt: null,
        currentValue: money(0n, "ILS"),
        direction: "increase",
        maintainedNow: true,
        normalizedProgressBasisPoints: 10_000,
        qualifiedSince: "2026-08-01",
        rawProgressBasisPoints: "10000",
        remainingGap: money(0n, "ILS"),
        status: "target_reached_pending_confirmation",
        targetValue: money(0n, "ILS"),
        trend: "unchanged",
        verification: "verified",
      },
      sustainedSuccessDays: 30,
      targetValue: money(0n, "ILS"),
      verification: "verified",
    });
    const regressed = calculateGoalProgress({
      baselineValue: money(-1_000n, "ILS"),
      currentValue: money(-200n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-09-02"),
      previous: completed,
      sustainedSuccessDays: 30,
      targetValue: money(0n, "ILS"),
      verification: "verified",
    });
    const reopened = calculateGoalProgress({
      baselineValue: money(-1_000n, "ILS"),
      currentValue: money(50n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-09-05"),
      previous: regressed,
      sustainedSuccessDays: 30,
      targetValue: money(0n, "ILS"),
      verification: "verified",
    });

    expect(regressed.status).toBe("regressed");
    expect(regressed.completedAt).toBe("2026-08-31");
    expect(reopened.status).toBe("target_reached_pending_confirmation");
    expect(reopened.completedAt).toBe("2026-08-31");
    expect(reopened.qualifiedSince).toBe("2026-09-05");
  });

  it("keeps manual and insufficient measurements explicitly unverified", () => {
    for (const verification of ["manual_unverified", "insufficient_data"] as const) {
      const result = calculateGoalProgress({
        baselineValue: money(0n, "ILS"),
        currentValue: money(20_000n, "ILS"),
        direction: "increase",
        evaluationDate: date("2026-08-31"),
        previous: null,
        sustainedSuccessDays: 0,
        targetValue: money(10_000n, "ILS"),
        verification,
      });
      expect(result.status).toBe(verification);
      expect(result.completedAt).toBeNull();
      expect(result.maintainedNow).toBe(false);
    }
  });

  it("records each deterministic milestone only once", () => {
    expect(newlyCrossedMilestones(7_500, [2_500])).toEqual([5_000, 7_500]);
    expect(newlyCrossedMilestones(10_000, [2_500, 5_000, 7_500])).toEqual([10_000]);
    expect(newlyCrossedMilestones(5_000, [2_500, 5_000])).toEqual([]);
  });

  it("rejects mixed currencies and invalid sustained-success durations", () => {
    expect(() => calculateGoalProgress({
      baselineValue: money(0n, "ILS"),
      currentValue: money(1n, "USD"),
      direction: "increase",
      evaluationDate: date("2026-08-31"),
      previous: null,
      sustainedSuccessDays: 0,
      targetValue: money(2n, "ILS"),
      verification: "verified",
    })).toThrow(/one currency/);
    expect(() => calculateGoalProgress({
      baselineValue: money(0n, "ILS"),
      currentValue: money(1n, "ILS"),
      direction: "increase",
      evaluationDate: date("2026-08-31"),
      previous: null,
      sustainedSuccessDays: 367,
      targetValue: money(2n, "ILS"),
      verification: "verified",
    })).toThrow(/Sustained-success/);
  });
});
