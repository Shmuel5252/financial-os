import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotificationCenter } from "@/components/notifications/notification-center";
import { messages } from "@/lib/i18n";
import type { NotificationCenterView } from "@/lib/notifications/notification";

const view: NotificationCenterView = {
  emailCapabilityReady: false,
  notifications: [{
    createdAt: "2026-09-02T09:00:00.000Z",
    email: { acceptedAt: null, attempts: 0, deliveredAt: null, notBeforeAt: "2026-09-03T05:00:00.000Z", state: "deferred" },
    id: "a".repeat(24),
    inAppState: "unread",
    messageKey: "forecast_below_safety_margin",
    policyVersion: "notification-policy-v1",
    severity: "WARNING",
    sourceKind: "forecast",
    targetPath: "/forecasts",
    trigger: "forecast_below_safety_margin",
    updatedAt: "2026-09-02T09:00:00.000Z",
    version: 1,
  }],
  phase9ProviderTriggersAvailable: false,
  preferences: {
    emailEnabled: false,
    inAppEnabled: true,
    quietHours: { enabled: true, endHour: 8, startHour: 22 },
    updatedAt: null,
    version: null,
  },
};

describe("Phase 15 Hebrew/RTL notification UI", () => {
  it("renders consent, privacy, quiet-hours, truthful lifecycle, and LTR timestamps", () => {
    const html = renderToStaticMarkup(<NotificationCenter initialView={view} />);
    expect(html).toContain(messages.notifications.email.optIn);
    expect(html).toContain(messages.notifications.email.privacy);
    expect(html).toContain(messages.notifications.emailStates.deferred);
    expect(html).toContain(messages.notifications.messages.forecast_below_safety_margin.title);
    expect(html).toContain(messages.notifications.phase9);
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain("sourceReference");
    expect(html).not.toContain("providerMessageId");
  });

  it("keeps new user-facing labels in natural Hebrew", () => {
    expect(messages.navigation.notifications).toMatch(/[\u0590-\u05FF]/);
    expect(messages.notifications.title).toMatch(/[\u0590-\u05FF]/);
    expect(messages.notifications.emailStates.sent).toContain("ספק");
    expect(messages.notifications.emailStates.delivered).toContain("נמסרה");
  });
});
