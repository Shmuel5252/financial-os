import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { GoalCenter } from "@/components/goals/goal-center";
import type { GoalCenterView } from "@/lib/goals/goal";
import { messages } from "@/lib/i18n";

const amount = (amountMinor: string) => ({ amountMinor, currency: "ILS" });

const view: GoalCenterView = {
  categories: [{ id: "system:food", label: null, systemKey: "food" }],
  currency: "ILS",
  goals: [
    {
      definition: {
        configuration: {
          fundScope: {
            recordIds: ["507f1f77bcf86cd799439012"],
            source: "savings",
          },
          kind: "savings_target",
          targetAmount: amount("2000000"),
        },
        createdAt: "2026-08-01T09:00:00.000Z",
        goalId: "507f1f77bcf86cd799439011",
        id: "507f1f77bcf86cd799439013",
        reportedEvidence: {
          capturedAt: "2026-08-01T08:00:00.000Z",
          currentValue: amount("200000"),
          goalRecordVersion: 1,
          startingValue: amount("100000"),
          targetAmount: amount("2000000"),
        },
        targetDate: "2026-12-31",
        version: 2,
      },
      history: [
        {
          createdAt: "2026-08-31T09:00:00.000Z",
          engineVersion: "goal-engine/1.0.0",
          evaluatedAt: "2026-08-31T09:00:00.000Z",
          evaluationDate: "2026-08-31",
          goalDefinitionId: "507f1f77bcf86cd799439013",
          goalId: "507f1f77bcf86cd799439011",
          goalVersion: 2,
          id: "507f1f77bcf86cd799439014",
          metricFacts: [{ key: "fund:source", value: amount("1100000") }],
          milestonesCrossed: [2_500, 5_000],
          policyVersion: "goal-policy/2026-08-31",
          reason: "evaluation",
          result: {
            baselineValue: amount("200000"),
            completedAt: "2026-08-20",
            currentValue: amount("1100000"),
            direction: "increase",
            maintainedNow: false,
            normalizedProgressBasisPoints: 5_000,
            qualifiedSince: null,
            rawProgressBasisPoints: "5000",
            remainingGap: amount("900000"),
            status: "regressed",
            targetValue: amount("2000000"),
            trend: "regressing",
            verification: "verified",
          },
          sourceReferences: [
            { id: "507f1f77bcf86cd799439012", kind: "manual_record", version: 2 },
          ],
          timeZone: "Asia/Jerusalem",
        },
      ],
      latestProgress: null,
      reported: {
        currentValue: amount("200000"),
        id: "507f1f77bcf86cd799439011",
        priority: 1,
        startingValue: amount("100000"),
        targetAmount: amount("2000000"),
        targetDate: "2026-12-31",
        title: "קרן עתידית",
        type: "savings_target",
        version: 1,
      },
    },
  ],
  sources: {
    accounts: [],
    cards: [],
    liabilities: [],
    savings: [
      {
        amount: amount("1100000"),
        id: "507f1f77bcf86cd799439012",
        label: "חיסכון נזיל",
        metadata: "liquid",
      },
    ],
  },
};

describe("Phase 6 Hebrew/RTL goal presentation", () => {
  it("separates reported and verified evidence and isolates financial values as LTR", () => {
    const current = view.goals[0]!.history[0]!;
    const html = renderToStaticMarkup(
      <GoalCenter
        initialView={{
          ...view,
          goals: [{ ...view.goals[0]!, latestProgress: current }],
        }}
      />,
    );

    expect(html).toContain(messages.goalEngine.baseline.reported);
    expect(html).toContain(messages.goalEngine.baseline.verified);
    expect(html).toContain(messages.goalEngine.statuses.regressed);
    expect(html).toContain(messages.goalEngine.history.title);
    expect(html).toContain(messages.goalEngine.separation);
    expect(html).toContain("50.00%");
    expect(html).toContain("11,000.00 ILS".replace(",", ""));
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain(">Save<");
  });

  it("localizes system category keys instead of exposing internal identifiers", () => {
    const monthlyView: GoalCenterView = {
      ...view,
      goals: [{
        ...view.goals[0]!,
        definition: null,
        history: [],
        latestProgress: null,
        reported: { ...view.goals[0]!.reported, type: "monthly_spending" },
      }],
    };
    const html = renderToStaticMarkup(<GoalCenter initialView={monthlyView} />);

    expect(html).toContain(messages.budgets.systemCategories.food);
    expect(html).not.toContain(">food<");
  });
});
