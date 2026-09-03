import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProgressJourneyCenter } from "@/components/progress-journeys/progress-journey-center";
import type { ProgressJourneyView } from "@/lib/progress-journeys/progress-journey";

const view: ProgressJourneyView = {
  dimensions: [{ currentOutcome: "not_achieved", dimension: "within_budget", latestEvaluationDate: "2026-08-31" }],
  events: [{
    createdAt: "2026-09-01T10:00:00.000Z", dimension: "goal_milestone", engineVersion: "progress-journey-engine-v1",
    evaluationDate: "2026-08-31", eventKind: "achievement", id: "event-a", origin: "backfill", outcome: "achieved",
    period: { kind: "milestone", value: "1:25" }, policyVersion: "phase-17-progress-policy-v1", ruleId: "goal-engine-milestone",
    ruleVersion: "progress-rules-v1", sourceReferences: [{ kind: "goal_progress", version: "1/goal-engine-v1" }],
    subjectLabel: "קרן חירום", supersedesId: null, value: 25,
  }],
  phase9ProviderEvidenceAvailable: false,
  preferences: { celebrationsEnabled: false, progressNotificationsEnabled: false, streaksEnabled: true, updatedAt: null, version: null },
  scope: "personal",
  streaks: [{ active: false, currentLength: 0, dimension: "within_budget", longestLength: 2, periodKind: "month" }],
};

describe("Phase 17 Hebrew/RTL progress UI", () => {
  it("uses natural Hebrew, textual regression, history provenance, and LTR isolation", () => {
    const markup = renderToStaticMarkup(<div dir="rtl" lang="he"><ProgressJourneyCenter initialView={view} /></div>);
    expect(markup).toContain("מסע ההתקדמות");
    expect(markup).toContain("התנאי אינו מתקיים כעת");
    expect(markup).toContain("ראיית עבר");
    expect(markup).toContain("25%");
    expect(markup).toContain('dir="ltr"');
    expect(markup).not.toContain("confetti");
    expect(markup).not.toContain("leaderboard");
    expect(markup).not.toContain("התקדמות מאומתת נרשמה");
  });

  it("removes streak presentation when disabled without removing deterministic dimensions or history", () => {
    const markup = renderToStaticMarkup(<ProgressJourneyCenter initialView={{ ...view, preferences: { ...view.preferences, streaksEnabled: false }, streaks: [] }} />);
    expect(markup).not.toContain('id="progress-streaks-title"');
    expect(markup).toContain("עמידה בתקציב הסגור");
    expect(markup).toContain("היסטוריית ראיות");
  });
});
