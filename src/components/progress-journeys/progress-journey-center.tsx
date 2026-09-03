"use client";

import { useState } from "react";

import { messages, userFacingErrorMessage } from "@/lib/i18n";
import type { ProgressDimension, ProgressEventKind, ProgressJourneyView, ProgressOutcome } from "@/lib/progress-journeys/progress-journey";

async function requestView(url: string, method: "POST" | "PUT", body: unknown): Promise<ProgressJourneyView> {
  const response = await fetch(url, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(userFacingErrorMessage(payload, messages.progress.failure));
  return payload as ProgressJourneyView;
}

const dimensionLabel: Readonly<Record<ProgressDimension, string>> = messages.progress.dimensions;
const outcomeLabel: Readonly<Record<ProgressOutcome, string>> = messages.progress.outcomes;
const eventKindLabel: Readonly<Record<ProgressEventKind, string>> = messages.progress.eventKinds;

function eventValue(dimension: ProgressDimension, value: number | null): string | null {
  if (value === null) return null;
  if (dimension === "goal_milestone") return `${value}%`;
  if (dimension === "goal_progress") return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
  return null;
}

export function ProgressJourneyCenter({ initialView }: Readonly<{ initialView: ProgressJourneyView }>) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const [celebrationsEnabled, setCelebrationsEnabled] = useState(view.preferences.celebrationsEnabled);
  const [streaksEnabled, setStreaksEnabled] = useState(view.preferences.streaksEnabled);
  const [progressNotificationsEnabled, setProgressNotificationsEnabled] = useState(view.preferences.progressNotificationsEnabled);
  const latestPositive = view.events.find((event) => event.outcome === "achieved" && (event.eventKind === "achievement" || event.eventKind === "recovery"));

  async function evaluate(origin: "backfill" | "live") {
    setBusy(origin); setFailure(""); setStatus("");
    try {
      setView(await requestView("/api/progress-journeys", "POST", { origin }));
      setStatus(origin === "backfill" ? messages.progress.status.backfilled : messages.progress.status.evaluated);
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.progress.failure); }
    finally { setBusy(null); }
  }

  async function savePreferences() {
    setBusy("preferences"); setFailure(""); setStatus("");
    try {
      const next = await requestView("/api/progress-journey-preferences", "PUT", {
        celebrationsEnabled,
        expectedVersion: view.preferences.version,
        progressNotificationsEnabled,
        streaksEnabled,
      });
      setView(next);
      setStatus(messages.progress.status.preferencesSaved);
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.progress.failure); }
    finally { setBusy(null); }
  }

  return (
    <div className="mt-10 space-y-8">
      {view.preferences.celebrationsEnabled && latestPositive !== undefined ? <section className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-950" aria-label={messages.progress.celebration.label}>
        <h2 className="text-xl font-semibold">{messages.progress.celebration.title}</h2>
        <p className="mt-2 leading-7">{messages.progress.celebration.description(dimensionLabel[latestPositive.dimension])}</p>
      </section> : null}
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="progress-evaluation-title">
        <h2 className="text-2xl font-semibold" id="progress-evaluation-title">{messages.progress.evaluation.title}</h2>
        <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">{messages.progress.evaluation.description}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="rounded-xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null} onClick={() => void evaluate("live")} type="button">{busy === "live" ? messages.progress.actions.evaluating : messages.progress.actions.evaluate}</button>
          <button className="rounded-xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:opacity-50" disabled={busy !== null} onClick={() => void evaluate("backfill")} type="button">{busy === "backfill" ? messages.progress.actions.backfilling : messages.progress.actions.backfill}</button>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="progress-dimensions-title">
        <h2 className="text-2xl font-semibold" id="progress-dimensions-title">{messages.progress.dimensionsTitle}</h2>
        {view.dimensions.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.progress.empty}</p> : <ul className="mt-5 grid gap-3 md:grid-cols-2">{view.dimensions.map((item) => <li className="rounded-2xl border border-[var(--border)] p-4" key={item.dimension}><strong>{dimensionLabel[item.dimension]}</strong><p className="mt-2">{outcomeLabel[item.currentOutcome]}</p><bdi className="mt-2 block text-xs text-[var(--muted)]" dir="ltr">{item.latestEvaluationDate}</bdi></li>)}</ul>}
      </section>

      {view.preferences.streaksEnabled ? <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="progress-streaks-title">
        <h2 className="text-2xl font-semibold" id="progress-streaks-title">{messages.progress.streaks.title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{messages.progress.streaks.description}</p>
        {view.streaks.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.progress.streaks.empty}</p> : <ul className="mt-5 grid gap-3 md:grid-cols-2">{view.streaks.map((streak) => <li className="rounded-2xl border border-[var(--border)] p-4" key={streak.dimension}><strong>{dimensionLabel[streak.dimension]}</strong><p className="mt-2">{streak.active ? messages.progress.streaks.active : messages.progress.streaks.inactive}</p><p className="mt-1 text-sm"><bdi dir="ltr">{streak.currentLength}</bdi> {streak.periodKind === "day" ? (streak.currentLength === 1 ? messages.progress.streaks.day : messages.progress.streaks.days) : (streak.currentLength === 1 ? messages.progress.streaks.month : messages.progress.streaks.months)} · {messages.progress.streaks.longest} <bdi dir="ltr">{streak.longestLength}</bdi></p></li>)}</ul>}
      </section> : null}

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="progress-history-title">
        <h2 className="text-2xl font-semibold" id="progress-history-title">{messages.progress.history.title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{messages.progress.history.description}</p>
        {view.events.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.progress.empty}</p> : <ol className="mt-5 space-y-3">{view.events.map((event) => {
          const value = eventValue(event.dimension, event.value);
          return <li className="rounded-2xl border border-[var(--border)] p-4" key={event.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{dimensionLabel[event.dimension]}</strong><p className="mt-1">{event.subjectLabel}</p></div><span className="rounded-full bg-[var(--background)] px-3 py-1 text-sm font-semibold">{eventKindLabel[event.eventKind]}</span></div>
            <p className="mt-3 text-sm">{outcomeLabel[event.outcome]}{value === null ? null : <> · <bdi dir="ltr">{value}</bdi></>}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">{event.origin === "backfill" ? messages.progress.history.backfill : messages.progress.history.live} · {messages.progress.history.sources(event.sourceReferences.length)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]"><bdi dir="ltr">{event.evaluationDate} · {event.ruleId} · {event.ruleVersion}</bdi></p>
          </li>;
        })}</ol>}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="progress-preferences-title">
        <h2 className="text-2xl font-semibold" id="progress-preferences-title">{messages.progress.preferences.title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{messages.progress.preferences.description}</p>
        <div className="mt-5 grid gap-3">
          <label className="flex items-start gap-3"><input checked={celebrationsEnabled} onChange={(event) => setCelebrationsEnabled(event.target.checked)} type="checkbox" /><span>{messages.progress.preferences.celebrations}</span></label>
          <label className="flex items-start gap-3"><input checked={streaksEnabled} onChange={(event) => setStreaksEnabled(event.target.checked)} type="checkbox" /><span>{messages.progress.preferences.streaks}</span></label>
          <label className="flex items-start gap-3"><input checked={progressNotificationsEnabled} onChange={(event) => setProgressNotificationsEnabled(event.target.checked)} type="checkbox" /><span>{messages.progress.preferences.notifications}</span></label>
        </div>
        <button className="mt-5 rounded-xl bg-[var(--ink)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null} onClick={() => void savePreferences()} type="button">{busy === "preferences" ? messages.progress.actions.saving : messages.progress.actions.savePreferences}</button>
      </section>

      <p className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--muted)]">{messages.progress.ethics}</p>
      <p className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--muted)]">{messages.progress.phase9}</p>
      <div aria-live="polite" className="min-h-6 text-sm font-semibold text-[var(--accent)]" role="status">{status}</div>
      {failure === "" ? null : <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{failure}</p>}
    </div>
  );
}
