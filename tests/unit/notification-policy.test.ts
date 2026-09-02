import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_POLICY_VERSION,
  evaluateNotificationFacts,
  isInQuietHours,
  nextQuietHoursEnd,
  type NotificationSourceFact,
} from "@/lib/domain/notifications/notification-policy";

function forecast(input: Partial<Extract<NotificationSourceFact, { kind: "forecast" }>> = {}): Extract<NotificationSourceFact, { kind: "forecast" }> {
  return {
    dataFreshness: "FRESH",
    kind: "forecast",
    materialObligationCount: 0,
    sourceReference: "forecast-evidence",
    sourceVersion: "forecast/1",
    timeline: [{ calendarDate: "2026-09-03", confirmedBalanceMinor: 10_000n, safetyMarginMinor: 10_000n }],
    ...input,
  };
}

describe("Phase 15 deterministic notification policy", () => {
  it("treats equality with the Safety Margin as safe and zero below a positive margin as warning", () => {
    expect(evaluateNotificationFacts([forecast()])).toEqual([]);
    const warning = evaluateNotificationFacts([forecast({
      timeline: [{ calendarDate: "2026-09-03", confirmedBalanceMinor: 0n, safetyMarginMinor: 1n }],
    })]);
    expect(warning.map((item) => [item.trigger, item.severity, item.allowQuietHoursBypass])).toEqual([
      ["forecast_below_safety_margin", "WARNING", false],
    ]);
  });

  it("creates one policy-approved critical bypass only for an objective confirmed shortfall", () => {
    const result = evaluateNotificationFacts([forecast({
      materialObligationCount: 2,
      timeline: [{ calendarDate: "2026-09-05", confirmedBalanceMinor: -1n, safetyMarginMinor: 0n }],
    })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      allowQuietHoursBypass: true,
      policyVersion: NOTIFICATION_POLICY_VERSION,
      severity: "CRITICAL",
      trigger: "forecast_confirmed_shortfall",
    });
  });

  it("emits distinct warning evidence for a material obligation at a margin crossing", () => {
    expect(evaluateNotificationFacts([forecast({
      materialObligationCount: 1,
      timeline: [{ calendarDate: "2026-09-04", confirmedBalanceMinor: 99n, safetyMarginMinor: 100n }],
    })]).map((item) => item.trigger)).toEqual([
      "forecast_below_safety_margin",
      "material_obligation_risk",
    ]);
  });

  it("derives budget, goal, and stale-data candidates without AI authority", () => {
    const result = evaluateNotificationFacts([
      forecast({ dataFreshness: "STALE" }),
      { kind: "budget", sourceReference: "budget", sourceVersion: "1", unallocatedMinor: -1n },
      { kind: "goal_progress", milestonesCrossed: [5_000, 2_500], sourceReference: "goal", sourceVersion: "1", status: "completed" },
    ]);
    expect(result.map((item) => [item.trigger, item.severity])).toEqual([
      ["stale_financial_data", "INFO"],
      ["budget_deficit", "WARNING"],
      ["goal_milestone", "INFO"],
    ]);
  });

  it("is reproducible, changes identity on material evidence change, and never creates Phase 9 events", () => {
    const first = evaluateNotificationFacts([forecast({
      timeline: [{ calendarDate: "2026-09-04", confirmedBalanceMinor: 9n, safetyMarginMinor: 10n }],
    })]);
    const retry = evaluateNotificationFacts([forecast({
      timeline: [{ calendarDate: "2026-09-04", confirmedBalanceMinor: 9n, safetyMarginMinor: 10n }],
    })]);
    const changed = evaluateNotificationFacts([forecast({
      timeline: [{ calendarDate: "2026-09-05", confirmedBalanceMinor: 9n, safetyMarginMinor: 10n }],
    })]);
    expect(first).toEqual(retry);
    expect(changed[0]?.deduplicationKey).not.toBe(first[0]?.deduplicationKey);
    expect(JSON.stringify(first)).not.toMatch(/bank|consent|webhook|open.?banking/i);
  });

  it("uses profile-timezone quiet hours and resolves the next boundary across DST", () => {
    const quiet = { enabled: true, endHour: 8, startHour: 22 };
    const beforeSpringForward = new Date("2026-03-08T06:30:00.000Z"); // 01:30 America/New_York
    expect(isInQuietHours(beforeSpringForward, "America/New_York", quiet)).toBe(true);
    expect(nextQuietHoursEnd(beforeSpringForward, "America/New_York", quiet)?.toISOString()).toBe("2026-03-08T12:00:00.000Z");
    expect(isInQuietHours(new Date("2026-03-08T12:00:00.000Z"), "America/New_York", quiet)).toBe(false);
    expect(isInQuietHours(beforeSpringForward, "America/New_York", { ...quiet, enabled: false })).toBe(false);
    expect(isInQuietHours(beforeSpringForward, "America/New_York", { enabled: true, endHour: 8, startHour: 8 })).toBe(false);
  });
});
