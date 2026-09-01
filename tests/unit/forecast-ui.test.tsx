import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ForecastCenter } from "@/components/forecasts/forecast-center";
import {
  createForecastCommandSchema,
  createForecastScenarioCommandSchema,
  type ForecastCenterView,
} from "@/lib/forecasts/forecast";
import { messages } from "@/lib/i18n";

const center: ForecastCenterView = {
  currency: "ILS",
  defaultHorizonDays: 30,
  forecasts: [{
    calculatedAt: "2026-09-01T12:00:00.000Z",
    confidence: "MEDIUM",
    confidenceReasons: ["ESTIMATES_MIXED"],
    confidenceVersion: "forecast-confidence-v1",
    confirmedEndBalance: { amountMinor: "900000", currency: "ILS" },
    confirmedMinimumBalance: { amountMinor: "850000", currency: "ILS" },
    currency: "ILS",
    currentSafeToSpend: { amountMinor: "500000", currency: "ILS" },
    dataFreshness: "FRESH",
    duplicateEstimatesSuppressed: 1,
    engineVersion: "forecast-engine-v1",
    estimatedEventCount: 1,
    evaluationDate: "2026-09-01",
    events: [{
      amount: { amountMinor: "1250", currency: "ILS" },
      calendarDate: "2026-09-10",
      confidence: "MEDIUM",
      id: "estimate-1",
      provenance: {
        alias: "מקור-1",
        evidenceCount: 4,
        reviewed: false,
        sourceVersion: "phase10-v1",
      },
      source: "phase_10_recurrence",
      truthStatus: "estimated",
      type: "outflow",
    }],
    firstBelowSafetyMarginDate: null,
    firstBelowZeroDate: null,
    freshnessReasons: [],
    horizonDays: 30,
    horizonEndDate: "2026-09-30",
    id: "a".repeat(24),
    materialObligations: [],
    policyVersion: "operational-forecast-2026-09-01",
    projectedEndBalance: { amountMinor: "898750", currency: "ILS" },
    projectedMinimumBalance: { amountMinor: "848750", currency: "ILS" },
    projectedMinimumDate: "2026-09-20",
    schemaVersion: 1,
    sourceEngineVersion: "1.0.0",
    sourcePolicyVersion: "2026-08-31",
    timeline: [{
      amount: { amountMinor: "1250", currency: "ILS" },
      calendarDate: "2026-09-10",
      confirmedBalance: { amountMinor: "900000", currency: "ILS" },
      eventId: "estimate-1",
      projectedBalance: { amountMinor: "898750", currency: "ILS" },
      safetyMargin: { amountMinor: "100000", currency: "ILS" },
      truthStatus: "estimated",
      type: "outflow",
    }],
  }],
  scenarios: [],
  supportedHorizons: [7, 30, 60, 90],
};

describe("Phase 12 Hebrew/RTL forecast presentation", () => {
  it("renders Hebrew truth separation, categorical confidence, and LTR financial evidence", () => {
    const html = renderToStaticMarkup(<ForecastCenter initialView={center} />);
    expect(html).toContain(messages.forecasts.result.title);
    expect(html).toContain(messages.forecasts.confidence.description);
    expect(html).toContain(messages.forecasts.confidence.MEDIUM);
    expect(html).toContain(messages.forecasts.events.estimated);
    expect(html).toContain(messages.forecasts.scenario.separation);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("12.50 ILS");
    expect(html).not.toContain("sourceReference");
    expect(html).not.toContain("sourceSnapshotId");
    expect(html).not.toContain("intelligenceRunId");
    expect(html).not.toContain("userId");
  });

  it("renders the explicit side-effect-free empty state", () => {
    const html = renderToStaticMarkup(
      <ForecastCenter initialView={{ ...center, forecasts: [] }} />,
    );
    expect(html).toContain(messages.forecasts.empty);
    expect(html).toContain(messages.forecasts.actions.calculate);
  });

  it("rejects client ownership and unsupported operational horizons", () => {
    expect(createForecastCommandSchema.safeParse({
      horizonDays: 120,
      idempotencyKey: crypto.randomUUID(),
    }).success).toBe(false);
    expect(createForecastCommandSchema.safeParse({
      horizonDays: 30,
      idempotencyKey: crypto.randomUUID(),
      userId: "a".repeat(24),
    }).success).toBe(false);
    expect(createForecastScenarioCommandSchema.safeParse({
      adjustments: [{
        amount: { amount: "1", currency: "ILS" },
        calendarDate: "2026-09-10",
        kind: "additional_income",
      }],
      forecastId: "a".repeat(24),
      idempotencyKey: crypto.randomUUID(),
      name: "תרחיש",
      note: null,
      ownerId: "b".repeat(24),
    }).success).toBe(false);
  });
});
