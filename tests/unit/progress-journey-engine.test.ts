import { describe, expect, it } from "vitest";

import {
  PROHIBITED_PROGRESS_DIMENSIONS,
  eventKindForOutcome,
  progressEventDraft,
  progressObservationFingerprint,
  progressObservationStableKey,
  projectProgressJourney,
} from "@/lib/domain/progress-journeys/progress-journey-engine";
import {
  PROGRESS_JOURNEY_ENGINE_VERSION,
  PROGRESS_JOURNEY_POLICY_VERSION,
  PROGRESS_JOURNEY_RULE_VERSION,
  type ProgressJourneyEvent,
  type ProgressObservation,
} from "@/lib/progress-journeys/progress-journey";

function observation(overrides: Partial<ProgressObservation> = {}): ProgressObservation {
  return {
    dimension: "within_budget",
    evaluationDate: "2026-01-31",
    origin: "live",
    outcome: "achieved",
    period: { kind: "month", value: "2026-01" },
    ruleId: "closed-budget-without-deficit",
    seriesKey: "personal-budget",
    sourceReferences: [{ kind: "budget_period", sourceId: "source-a", version: "1" }],
    subjectKey: "2026-01",
    subjectLabel: "ינואר 2026",
    value: null,
    ...overrides,
  };
}

function event(id: string, value: string, outcome: ProgressJourneyEvent["outcome"], overrides: Partial<ProgressJourneyEvent> = {}): ProgressJourneyEvent {
  const input = observation({ evaluationDate: `${value}-28`, outcome, period: { kind: "month", value }, subjectKey: value });
  return {
    ...progressEventDraft(input, null),
    createdAt: new Date(`${value}-28T12:00:00.000Z`),
    id,
    supersedesId: null,
    ...overrides,
  };
}

describe("Phase 17 deterministic progress journey", () => {
  it("uses stable logical identity and versions evidence changes without identifiers in public rules", () => {
    const first = observation();
    const same = { ...first, sourceReferences: [...first.sourceReferences] };
    const corrected = { ...first, sourceReferences: [{ ...first.sourceReferences[0]!, version: "2" }] };
    expect(progressObservationStableKey(first)).toBe(progressObservationStableKey(corrected));
    expect(progressObservationFingerprint(first)).toBe(progressObservationFingerprint(same));
    expect(progressObservationFingerprint(first)).toBe(progressObservationFingerprint({ ...first, origin: "backfill" }));
    expect(progressObservationFingerprint(first)).not.toBe(progressObservationFingerprint(corrected));
    expect(progressEventDraft(first, null)).toMatchObject({
      engineVersion: PROGRESS_JOURNEY_ENGINE_VERSION,
      eventKind: "achievement",
      policyVersion: PROGRESS_JOURNEY_POLICY_VERSION,
      ruleVersion: PROGRESS_JOURNEY_RULE_VERSION,
    });
  });

  it("records regression and recovery without forcing progress to be monotonic", () => {
    expect(eventKindForOutcome("not_achieved", "achieved")).toBe("regression");
    expect(eventKindForOutcome("not_achieved", "in_progress")).toBe("regression");
    expect(eventKindForOutcome("achieved", "not_achieved")).toBe("recovery");
    expect(eventKindForOutcome("unknown", "achieved")).toBe("insufficient_evidence");
  });

  it("creates, continues, breaks, and recovers a calendar streak while preserving the historical maximum", () => {
    const projection = projectProgressJourney([
      event("jan", "2026-01", "achieved"),
      event("feb", "2026-02", "achieved"),
      event("mar", "2026-03", "not_achieved"),
      event("apr", "2026-04", "achieved", { eventKind: "recovery" }),
    ], true);
    expect(projection.streaks).toEqual([expect.objectContaining({ active: true, currentLength: 1, dimension: "within_budget", longestLength: 2, periodKind: "month" })]);
  });

  it("counts profile-calendar dates across an Israel DST boundary without elapsed-hour arithmetic", () => {
    const days = ["2026-03-27", "2026-03-28", "2026-03-29"].map((value, index) => event(`dst-${index}`, value.slice(0, 7), "achieved", {
      createdAt: new Date(`${value}T12:00:00.000Z`), dimension: "safety_margin", evaluationDate: value,
      period: { kind: "day", value }, stableKey: `dst-${index}`,
    }));
    expect(projectProgressJourney(days, true).streaks.find((item) => item.dimension === "safety_margin")).toMatchObject({ currentLength: 3, longestLength: 3, periodKind: "day" });
  });

  it("treats missing evidence as unknown, not a hidden success or regression", () => {
    const projection = projectProgressJourney([
      event("jan", "2026-01", "achieved"),
      event("feb", "2026-02", "unknown", { eventKind: "insufficient_evidence" }),
    ], true);
    expect(projection.dimensions).toEqual([expect.objectContaining({ currentOutcome: "unknown" })]);
    expect(projection.streaks[0]).toMatchObject({ active: false, currentLength: 0, longestLength: 1 });
  });

  it("uses the newest immutable correction for current projection and can hide streak presentation only", () => {
    const original = event("original", "2026-01", "achieved");
    const correction = event("correction", "2026-01", "not_achieved", {
      createdAt: new Date("2026-02-02T12:00:00.000Z"), eventKind: "correction", stableKey: original.stableKey, supersedesId: original.id,
    });
    expect(projectProgressJourney([original, correction], true).dimensions[0]?.currentOutcome).toBe("not_achieved");
    expect(projectProgressJourney([original, correction], false).streaks).toEqual([]);
    expect([original, correction]).toHaveLength(2);
  });

  it("has no rule surface for risky engagement loops or a universal score", () => {
    expect(PROHIBITED_PROGRESS_DIMENSIONS).toEqual(expect.arrayContaining(["spending", "borrowing", "investing", "trading", "app_checking"]));
    expect(PROHIBITED_PROGRESS_DIMENSIONS).not.toContain("within_budget");
  });
});
