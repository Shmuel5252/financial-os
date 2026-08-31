import { describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { loadDashboard } from "@/lib/dashboard/dashboard-service";
import {
  calculateFinancialEngine,
  type FinancialEngineInput,
} from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";
import {
  financialEngineSourceSections,
} from "@/lib/financial-engine/financial-engine-input";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import type { FinancialEngineSnapshotRepository } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import type { FinancialSnapshot } from "@/lib/financial-snapshots/financial-snapshot";
import type { FinancialSnapshotRepository } from "@/lib/financial-snapshots/financial-snapshot-repository";
import type {
  ManualFields,
  ManualRecord,
  ManualSection,
} from "@/lib/onboarding/manual-record";
import type { ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import type { UserProfile } from "@/lib/profiles/profile";

const actor: Actor = { kind: "user", userId: "a".repeat(24) };

function profile(updatedAt = "2026-08-31T09:00:00.000Z"): UserProfile {
  return {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    fields: {
      countryCode: "IL",
      displayName: "בדיקה",
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
    },
    id: "b".repeat(24),
    onboarding: {
      completedAt: new Date("2026-08-10T00:00:00.000Z"),
      completedSteps: [],
      currentStep: "review",
      status: "complete",
    },
    updatedAt: new Date(updatedAt),
    version: 1,
  };
}

function engineInput(availableCashMinor: bigint): FinancialEngineInput {
  return {
    accountBalance: money(availableCashMinor, "ILS"),
    actualMonthlyExpenses: money(20_000n, "ILS"),
    actualMonthlyIncome: money(80_000n, "ILS"),
    asOf: "2026-08-31T09:00:00.000Z",
    availableCash: money(availableCashMinor, "ILS"),
    creditLimit: money(100_000n, "ILS"),
    creditUsed: money(95_000n, "ILS"),
    currency: "ILS",
    debtBalance: money(15_000n, "ILS"),
    events: [
      {
        amount: money(70_000n, "ILS"),
        calendarDate: "2026-08-31",
        id: "bill",
        kind: "obligation",
        occurredAt: null,
        source: "recurring_expense",
      },
      {
        amount: money(50_000n, "ILS"),
        calendarDate: "2026-09-01",
        id: "possible",
        kind: "uncertain_income",
        occurredAt: null,
        source: "income_source",
      },
    ],
    horizonDays: 30,
    monthlyConfirmedIncomeBasis: [],
    safetyMargin: { amount: money(0n, "ILS"), kind: "fixed" },
    savingsBalance: money(40_000n, "ILS"),
    timeZone: "Asia/Jerusalem",
  };
}

function snapshot(id: string, availableCashMinor: bigint): FinancialEngineSnapshot {
  return {
    calculatedAt: new Date("2026-08-31T10:00:00.000Z"),
    engineVersion: "1.0.0",
    id,
    inputHash: "c".repeat(64),
    kind: "engine_result",
    policyVersion: "2026-08-31",
    result: calculateFinancialEngine(engineInput(availableCashMinor)),
    schemaVersion: 1,
    sourceManifestId: "d".repeat(24),
  };
}

function manifest(): FinancialSnapshot {
  return {
    capturedAt: new Date("2026-08-31T10:00:00.000Z"),
    id: "d".repeat(24),
    kind: "source_manifest",
    primaryCurrency: "ILS",
    schemaVersion: 1,
    sources: financialEngineSourceSections.map((section) => ({
      records: [],
      section,
    })),
  };
}

function manualRecord(
  section: ManualSection,
  fields: unknown,
  id: string,
): ManualRecord {
  return {
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    fields: fields as ManualFields,
    id,
    section,
    source: { kind: "manual" },
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    version: 1,
  };
}

function manualRepository(
  records: readonly ManualRecord[],
): ManualRecordRepository {
  return {
    listAllForActor: async () => records,
  } as unknown as ManualRecordRepository;
}

function dependencies(options?: Readonly<{
  currentProfile?: UserProfile;
  currentRecords?: Readonly<Partial<Record<ManualSection, readonly ManualRecord[]>>>;
  snapshots?: readonly FinancialEngineSnapshot[];
}>) {
  const goal = manualRecord(
    "goals",
    {
      currentValue: money(10_000n, "ILS"),
      priority: 1,
      startingValue: money(0n, "ILS"),
      targetAmount: money(50_000n, "ILS"),
      targetDate: "2026-12-31",
      title: "קרן חירום",
      type: "emergency_fund",
    },
    "e".repeat(24),
  );
  const records = options?.currentRecords ?? {};
  const sourceRepositories = Object.fromEntries(
    [...financialEngineSourceSections, "goals" as const].map((section) => [
      section,
      manualRepository(
        records[section] ?? (section === "goals" ? [goal] : []),
      ),
    ]),
  ) as unknown as Readonly<Record<ManualSection, ManualRecordRepository>>;
  const engineRepository = {
    listForActor: async () => ({
      nextCursor: null,
      snapshots: options?.snapshots ?? [
        snapshot("1".repeat(24), 100_000n),
        snapshot("2".repeat(24), 90_000n),
      ],
    }),
  } as unknown as FinancialEngineSnapshotRepository;
  const manifestRepository = {
    findForActor: async () => manifest(),
  } as unknown as FinancialSnapshotRepository;
  const profileRepository = {
    findForActor: async () => options?.currentProfile ?? profile(),
  } as unknown as UserProfileRepository;

  return {
    engineRepository,
    manifestRepository,
    now: () => new Date("2026-08-31T12:00:00.000Z"),
    profileRepository,
    sourceRepositories,
  };
}

describe("Phase 4 dashboard query service", () => {
  it("builds a reconciled dashboard view without recalculating financial truth in the UI", async () => {
    const view = await loadDashboard(actor, dependencies());

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") {
      throw new Error("Expected a ready dashboard.");
    }
    expect(view.stale).toBe(false);
    expect(view.safeToSpend.amountMinor).toBe("30000");
    expect(view.change).toEqual({
      amount: { amountMinor: "10000", currency: "ILS" },
      direction: "up",
    });
    expect(view.limitingPoint).toMatchObject({
      calendarDate: "2026-08-31",
      kind: "obligation",
    });
    expect(view.alerts).toEqual([
      "high_credit_utilization",
      "uncertain_income",
    ]);
    expect(view.timeline.sevenDays.events.map((event) => event.eventId)).toEqual([
      "bill",
      "possible",
    ]);
    expect(view.timeline.fourteenDays).toEqual(view.timeline.sevenDays);
    expect(view.timeline.thirtyDays.truncated).toBe(false);
    expect(view.goals[0]).toMatchObject({
      currentValue: { amountMinor: "10000", currency: "ILS" },
      targetAmount: { amountMinor: "50000", currency: "ILS" },
      title: "קרן חירום",
    });
  });

  it("marks source, profile, and calendar drift explicitly", async () => {
    const changedAccount = manualRecord(
      "accounts",
      { balance: money(1n, "ILS"), name: "Changed", type: "bank" },
      "f".repeat(24),
    );
    const view = await loadDashboard(
      actor,
      {
        ...dependencies({
          currentProfile: profile("2026-08-31T11:00:00.000Z"),
          currentRecords: { accounts: [changedAccount] },
        }),
        now: () => new Date("2026-09-01T12:00:00.000Z"),
      },
    );

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") {
      throw new Error("Expected a ready dashboard.");
    }
    expect(view.stale).toBe(true);
    expect(view.freshnessReasons).toEqual([
      "source_changed",
      "profile_changed",
      "new_calendar_day",
    ]);
  });

  it("returns an honest empty state when no engine snapshot exists", async () => {
    const view = await loadDashboard(
      actor,
      dependencies({ snapshots: [] }),
    );

    expect(view).toMatchObject({ kind: "empty" });
    expect(view.goals).toHaveLength(1);
    expect(view.goalsTruncated).toBe(false);
  });

  it("bounds client-facing timelines and goals while disclosing truncation", async () => {
    const largeResult = calculateFinancialEngine({
      ...engineInput(1_000_000n),
      events: Array.from({ length: 101 }, (_, index) => ({
        amount: money(1n, "ILS"),
        calendarDate: "2026-09-01",
        id: `event-${index.toString().padStart(3, "0")}`,
        kind: "obligation" as const,
        occurredAt: null,
        source: "recurring_expense" as const,
      })),
    });
    const largeSnapshot: FinancialEngineSnapshot = {
      ...snapshot("3".repeat(24), 1_000_000n),
      result: largeResult,
    };
    const goals = Array.from({ length: 21 }, (_, index) =>
      manualRecord(
        "goals",
        {
          currentValue: money(0n, "ILS"),
          priority: (index % 5) + 1,
          startingValue: money(0n, "ILS"),
          targetAmount: money(1_000n, "ILS"),
          targetDate: null,
          title: `Goal ${index}`,
          type: "custom",
        },
        index.toString(16).padStart(24, "0"),
      ),
    );
    const view = await loadDashboard(
      actor,
      dependencies({
        currentRecords: { goals },
        snapshots: [largeSnapshot],
      }),
    );

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") {
      throw new Error("Expected a ready dashboard.");
    }
    expect(view.timeline.thirtyDays.events).toHaveLength(100);
    expect(view.timeline.thirtyDays.truncated).toBe(true);
    expect(view.goals).toHaveLength(20);
    expect(view.goalsTruncated).toBe(true);
  });
});
