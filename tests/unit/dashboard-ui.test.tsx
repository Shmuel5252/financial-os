import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TimelinePanel } from "@/components/dashboard/timeline-panel";

describe("Phase 4 dashboard Hebrew/RTL presentation", () => {
  it("renders Hebrew timeline controls and isolates dates and money as LTR", () => {
    const event = {
      amount: { amountMinor: "12345", currency: "ILS" },
      calendarDate: "2026-09-01",
      confirmedBalance: { amountMinor: "87655", currency: "ILS" },
      eventId: "event-1",
      expectedBalance: { amountMinor: "87655", currency: "ILS" },
      kind: "obligation" as const,
      safeCapacity: { amountMinor: "77655", currency: "ILS" },
      safetyMargin: { amountMinor: "10000", currency: "ILS" },
      source: "recurring_expense" as const,
    };
    const html = renderToStaticMarkup(
      <TimelinePanel
        timeline={{
          fourteenDays: { events: [event], truncated: false },
          sevenDays: { events: [event], truncated: false },
          thirtyDays: { events: [event], truncated: false },
        }}
      />,
    );

    expect(html).toContain("מה צפוי לקרות?");
    expect(html).toContain("התחייבות");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain("recurring_expense");
  });
});
