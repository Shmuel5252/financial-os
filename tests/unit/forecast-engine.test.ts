import { describe, expect, it } from "vitest";

import {
  calculateFinancialEngine,
  type FinancialEngineInput,
} from "@/lib/domain/financial-engine/financial-engine";
import {
  calculateForecast,
  calculateForecastScenario,
  FORECAST_CONFIDENCE_VERSION,
  FORECAST_ENGINE_VERSION,
  FORECAST_HORIZONS,
  FORECAST_POLICY_VERSION,
  type ForecastRecurringEvidence,
} from "@/lib/domain/forecasts/forecast-engine";
import { money } from "@/lib/domain/money/money";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";

const date = (value: string) => calendarDateSchema.parse(value);

function baseline(
  overrides: Partial<FinancialEngineInput> = {},
) {
  return calculateFinancialEngine({
    accountBalance: money(10_000n, "ILS"),
    actualMonthlyExpenses: money(0n, "ILS"),
    actualMonthlyIncome: money(0n, "ILS"),
    asOf: "2026-06-01T10:00:00.000Z",
    availableCash: money(10_000n, "ILS"),
    creditLimit: money(0n, "ILS"),
    creditUsed: money(0n, "ILS"),
    currency: "ILS",
    debtBalance: money(0n, "ILS"),
    events: [],
    horizonDays: 90,
    monthlyConfirmedIncomeBasis: [
      { amount: money(10_000n, "ILS"), calendarMonth: "2026-06" },
      { amount: money(10_000n, "ILS"), calendarMonth: "2026-07" },
      { amount: money(10_000n, "ILS"), calendarMonth: "2026-08" },
    ],
    safetyMargin: { amount: money(2_000n, "ILS"), kind: "fixed" },
    savingsBalance: money(0n, "ILS"),
    timeZone: "Asia/Jerusalem",
    ...overrides,
  });
}

function recurring(
  overrides: Partial<ForecastRecurringEvidence> = {},
): ForecastRecurringEvidence {
  const evidence = [
    "2026-01-02", "2026-02-01", "2026-03-03",
    "2026-04-02", "2026-05-02",
  ].map((calendarDate) => ({
    amount: money(1_000n, "ILS"),
    date: date(calendarDate),
  }));
  return {
    amount: money(1_000n, "ILS"),
    evidence,
    periodDays: 30,
    reviewState: "confirmed",
    sourceReference: "signal-a",
    sourceVersion: "phase10-v1",
    ...overrides,
  };
}

function forecast(
  input: Readonly<{
    baselineResult?: ReturnType<typeof baseline>;
    dataFreshness?: "FRESH" | "STALE";
    evidence?: readonly ForecastRecurringEvidence[];
    horizonDays?: 7 | 30 | 60 | 90;
  }> = {},
) {
  return calculateForecast({
    baseline: input.baselineResult ?? baseline(),
    dataFreshness: input.dataFreshness ?? "FRESH",
    freshnessReasons: input.dataFreshness === "STALE" ? ["source_changed"] : [],
    horizonDays: input.horizonDays ?? 30,
    intelligenceEvidence: input.evidence ?? [recurring()],
    sourceReferencePrefix: "snapshot-a",
  });
}

describe("Phase 12 deterministic forecast engine", () => {
  it("supports only the approved 7/30/60/90 calendar-day horizons", () => {
    expect(FORECAST_HORIZONS).toEqual([7, 30, 60, 90]);
    for (const horizonDays of FORECAST_HORIZONS) {
      const result = forecast({ horizonDays });
      expect(result.horizonDays).toBe(horizonDays);
      expect(result.horizonEndDate).toBe(
        horizonDays === 7 ? "2026-06-07" :
          horizonDays === 30 ? "2026-06-30" :
            horizonDays === 60 ? "2026-07-30" : "2026-08-29",
      );
    }
    expect(() => calculateForecast({
      baseline: baseline(),
      dataFreshness: "FRESH",
      freshnessReasons: [],
      horizonDays: 120 as 90,
      intelligenceEvidence: [],
      sourceReferencePrefix: "snapshot-a",
    })).toThrow("unsupported");
  });

  it("uses the profile timezone calendar boundary inherited from Phase 3", () => {
    const result = forecast({
      baselineResult: baseline({ asOf: "2026-03-27T22:30:00.000Z" }),
      evidence: [],
      horizonDays: 7,
    });
    expect(result.evaluationDate).toBe("2026-03-28");
    expect(result.horizonEndDate).toBe("2026-04-03");
  });

  it("keeps confirmed and estimated balances and events explicit", () => {
    const result = forecast({
      baselineResult: baseline({
        events: [
          { amount: money(2_000n, "ILS"), calendarDate: date("2026-06-05"), id: "salary", kind: "confirmed_income", occurredAt: null, source: "income_source" },
          { amount: money(3_000n, "ILS"), calendarDate: date("2026-06-10"), id: "rent", kind: "obligation", occurredAt: null, source: "recurring_expense" },
          { amount: money(9_000n, "ILS"), calendarDate: date("2026-06-15"), id: "possible", kind: "uncertain_income", occurredAt: null, source: "income_source" },
        ],
      }),
    });
    expect(result.events.map((event) => [event.truthStatus, event.type])).toContainEqual(["confirmed", "income"]);
    expect(result.events.map((event) => [event.truthStatus, event.type])).toContainEqual(["confirmed", "outflow"]);
    expect(result.events.map((event) => [event.truthStatus, event.type])).toContainEqual(["estimated", "income"]);
    expect(result.confirmedEndBalance.amountMinor).toBe(9_000n);
    expect(result.projectedEndBalance.amountMinor).toBe(17_000n);
    expect(result.currentSafeToSpend.amountMinor).toBe(7_000n);
    expect(result.engineVersion).toBe(FORECAST_ENGINE_VERSION);
    expect(result.policyVersion).toBe(FORECAST_POLICY_VERSION);
    expect(result.confidenceVersion).toBe(FORECAST_CONFIDENCE_VERSION);
    expect(FORECAST_CONFIDENCE_VERSION).toBe("forecast-confidence-v1");
  });

  it("assigns HIGH, MEDIUM, and LOW from exact documented evidence boundaries", () => {
    expect(forecast().confidence).toBe("HIGH");
    expect(forecast({
      evidence: [recurring({
        evidence: recurring().evidence.slice(0, 4),
        reviewState: null,
      })],
    }).confidence).toBe("MEDIUM");
    expect(forecast({
      evidence: [recurring({ evidence: recurring().evidence.slice(0, 2) })],
    }).confidence).toBe("LOW");
    expect(forecast({ evidence: [] }).confidenceReasons).toContain("INSUFFICIENT_PREDICTIVE_EVIDENCE");
    expect(forecast({ dataFreshness: "STALE" }).confidenceReasons).toEqual(["SOURCE_STALE"]);
  });

  it("degrades stale, unstable timing, and unstable amount evidence", () => {
    const stale = recurring({
      evidence: recurring().evidence.map((item) => ({ ...item, date: date(item.date.replace("2026", "2025")) })),
    });
    const timing = recurring({
      evidence: ["2026-01-01", "2026-02-20", "2026-03-22"].map((item) => ({ amount: money(1_000n, "ILS"), date: date(item) })),
    });
    const amounts = recurring({
      evidence: recurring().evidence.map((item, index) => ({ ...item, amount: money(index === 4 ? 2_000n : 1_000n, "ILS") })),
    });
    expect(forecast({ evidence: [stale] }).confidence).toBe("LOW");
    expect(forecast({ evidence: [timing] }).confidence).toBe("LOW");
    expect(forecast({ evidence: [amounts] }).confidence).toBe("LOW");
  });

  it("respects dismissed Phase 10 review evidence", () => {
    const result = forecast({ evidence: [recurring({ reviewState: "dismissed" })] });
    expect(result.events.some((event) => event.source === "phase_10_recurrence")).toBe(false);
    expect(result.confidence).toBe("LOW");
  });

  it("prevents same-date/direction/currency/amount duplicate events", () => {
    const result = forecast({
      baselineResult: baseline({
        events: [{
          amount: money(1_000n, "ILS"),
          calendarDate: date("2026-07-01"),
          id: "known-subscription",
          kind: "obligation",
          occurredAt: null,
          source: "recurring_expense",
        }],
      }),
      evidence: [recurring()],
      horizonDays: 60,
    });
    expect(result.duplicateEstimatesSuppressed).toBe(1);
    expect(result.events.filter((event) => event.calendarDate === "2026-07-01" && event.amount.amountMinor === 1_000n)).toHaveLength(1);
  });

  it("finds projected minimum, Safety Margin crossing, zero crossing, and material obligations", () => {
    const result = forecast({
      baselineResult: baseline({
        availableCash: money(8_000n, "ILS"),
        events: [
          { amount: money(6_500n, "ILS"), calendarDate: date("2026-06-10"), id: "rent", kind: "obligation", occurredAt: null, source: "recurring_expense" },
          { amount: money(2_000n, "ILS"), calendarDate: date("2026-06-12"), id: "loan", kind: "obligation", occurredAt: null, source: "loan" },
        ],
      }),
      evidence: [],
    });
    expect(result.projectedMinimumBalance.amountMinor).toBe(-500n);
    expect(result.projectedMinimumDate).toBe("2026-06-12");
    expect(result.firstBelowSafetyMarginDate).toBe("2026-06-10");
    expect(result.firstBelowZeroDate).toBe("2026-06-12");
    expect(result.materialObligations).toHaveLength(2);
  });

  it("treats equality with margin and zero as non-crossings", () => {
    const atMargin = forecast({
      baselineResult: baseline({
        availableCash: money(3_000n, "ILS"),
        events: [{ amount: money(1_000n, "ILS"), calendarDate: date("2026-06-02"), id: "bill", kind: "obligation", occurredAt: null, source: "recurring_expense" }],
      }), evidence: [],
    });
    expect(atMargin.firstBelowSafetyMarginDate).toBeNull();
    expect(atMargin.firstBelowZeroDate).toBeNull();
    const atZero = forecast({
      baselineResult: baseline({
        availableCash: money(1_000n, "ILS"),
        safetyMargin: { amount: money(0n, "ILS"), kind: "fixed" },
        events: [{ amount: money(1_000n, "ILS"), calendarDate: date("2026-06-02"), id: "bill", kind: "obligation", occurredAt: null, source: "recurring_expense" }],
      }), evidence: [],
    });
    expect(atZero.firstBelowZeroDate).toBeNull();
    expect(atZero.firstBelowSafetyMarginDate).toBeNull();
  });

  it("rejects implicit FX and preserves exact bigint arithmetic", () => {
    expect(() => forecast({ evidence: [recurring({ amount: money(1_000n, "USD") })] })).toThrow("currency differs");
    const exact = forecast({
      baselineResult: baseline({ availableCash: money(9_007_199_254_740_993n, "ILS") }),
      evidence: [],
    });
    expect(exact.projectedEndBalance.amountMinor).toBe(9_007_199_254_740_993n);
  });

  it("calculates scenarios separately without mutating operational truth", () => {
    const operational = forecast({ evidence: [] });
    const before = operational.projectedEndBalance.amountMinor;
    const scenario = calculateForecastScenario(operational, [
      { amount: money(2_000n, "ILS"), calendarDate: date("2026-06-10"), kind: "additional_income" },
      { amount: money(500n, "ILS"), calendarDate: date("2026-06-11"), kind: "savings_transfer" },
    ]);
    expect(scenario.projectedEndBalance.amountMinor).toBe(before + 1_500n);
    expect(scenario.projectedEndDelta.amountMinor).toBe(1_500n);
    expect(operational.projectedEndBalance.amountMinor).toBe(before);
    expect(() => calculateForecastScenario(operational, [{
      amount: money(1n, "USD"), calendarDate: date("2026-06-10"), kind: "additional_income",
    }])).toThrow("currency differs");
  });

  it("is reproducible for identical versioned inputs", () => {
    expect(forecast()).toEqual(forecast());
  });
});
