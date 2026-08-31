"use client";

import { useState } from "react";

import type {
  DashboardEventView,
  DashboardTimelineWindowView,
} from "@/lib/dashboard/dashboard";
import { appLocale, messages } from "@/lib/i18n";

type WindowKey = "fourteenDays" | "sevenDays" | "thirtyDays";

const windows: readonly Readonly<{ key: WindowKey; label: string }>[] = [
  { key: "sevenDays", label: messages.dashboard.timeline.sevenDays },
  { key: "fourteenDays", label: messages.dashboard.timeline.fourteenDays },
  { key: "thirtyDays", label: messages.dashboard.timeline.thirtyDays },
];

function formatMoney(amount: DashboardEventView["amount"]): string {
  const digits =
    new Intl.NumberFormat(appLocale.intlLocale, {
      currency: amount.currency,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = amount.amountMinor.startsWith("-");
  const unsigned = negative ? amount.amountMinor.slice(1) : amount.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  const major =
    digits === 0
      ? padded
      : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return `${negative ? "-" : ""}${major} ${amount.currency}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(appLocale.intlLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12)));
}

export function TimelinePanel({
  timeline,
}: Readonly<{
  timeline: Readonly<Record<WindowKey, DashboardTimelineWindowView>>;
}>) {
  const [selected, setSelected] = useState<WindowKey>("thirtyDays");
  const window = timeline[selected];
  const events = window.events;

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
      <h2 className="text-2xl font-semibold">
        {messages.dashboard.timeline.title}
      </h2>
      <div aria-label={messages.dashboard.timeline.title} className="mt-5 flex flex-wrap gap-2" role="tablist">
        {windows.map((window) => (
          <button
            aria-controls="dashboard-timeline-panel"
            aria-selected={selected === window.key}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              selected === window.key
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
            key={window.key}
            id={`dashboard-timeline-tab-${window.key}`}
            onClick={() => setSelected(window.key)}
            role="tab"
            type="button"
          >
            {window.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`dashboard-timeline-tab-${selected}`}
        aria-live="polite"
        className="mt-6"
        id="dashboard-timeline-panel"
        role="tabpanel"
      >
        {events.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {messages.dashboard.timeline.empty}
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => (
              <li
                className="grid gap-3 rounded-2xl bg-[var(--background)] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                key={event.eventId}
              >
                <div>
                  <p className="font-semibold">
                    {messages.dashboard.eventKinds[event.kind]}
                    {" · "}
                    {messages.dashboard.eventSources[event.source]}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    <bdi dir="ltr">{formatDate(event.calendarDate)}</bdi>
                    {" · "}
                    {messages.dashboard.timeline.balanceAfter}{" "}
                    <bdi dir="ltr">{formatMoney(event.confirmedBalance)}</bdi>
                  </p>
                </div>
                <bdi
                  className={`break-all font-semibold ${
                    event.kind === "obligation"
                      ? "text-rose-800"
                      : event.kind === "uncertain_income"
                        ? "text-amber-800"
                        : "text-[var(--accent)]"
                  }`}
                  dir="ltr"
                >
                  {event.kind === "obligation" ? "−" : "+"}
                  {formatMoney(event.amount)}
                </bdi>
              </li>
            ))}
          </ol>
        )}
        {window.truncated ? (
          <p className="mt-4 text-sm text-amber-800">
            {messages.dashboard.timeline.truncated}
          </p>
        ) : null}
      </div>
    </section>
  );
}
