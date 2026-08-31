import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PurchaseSimulator } from "@/components/purchase-simulations/purchase-simulator";
import { messages } from "@/lib/i18n";
import type { PurchaseSimulationCenterView } from "@/lib/purchase-simulations/purchase-simulation";

const view: PurchaseSimulationCenterView = {
  baseline: {
    calculatedAt: "2026-09-01T09:00:00.000Z",
    dataFreshness: "STALE",
    evaluationDate: "2026-09-01",
    freshnessReasons: ["source_changed"],
    horizonEndDate: "2027-03-29",
    id: "507f1f77bcf86cd799439011",
  },
  currency: "ILS",
  requiredBaselineHorizonDays: 210,
  saved: [],
  timeZone: "Asia/Jerusalem",
};

describe("Phase 7 Hebrew/RTL purchase simulation presentation", () => {
  it("discloses hypothetical separation, stale data, exact charges, and LTR values", () => {
    const html = renderToStaticMarkup(<PurchaseSimulator initialView={view} />);

    expect(html).toContain(messages.purchaseSimulation.form.totalPrice);
    expect(html).toContain(messages.purchaseSimulation.charges.warning);
    expect(html).toContain(messages.purchaseSimulation.freshness.stale);
    expect(html).toContain(messages.purchaseSimulation.freshness.source_changed);
    expect(html).toContain(messages.purchaseSimulation.separation);
    expect(html).toContain(messages.purchaseSimulation.saved.empty);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Asia/Jerusalem");
    expect(html).not.toContain("SAFE / CAUTION / UNSAFE");
  });
});
