"use client";

import { useMemo, useState } from "react";

import type { SerializedMoney } from "@/lib/domain/money/money";
import type {
  ForecastCenterView,
  ForecastScenarioView,
  ForecastSnapshotView,
} from "@/lib/forecasts/forecast";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";

function moneyMajor(value: SerializedMoney): string {
  const digits = new Intl.NumberFormat(appLocale.intlLocale, {
    currency: value.currency, style: "currency",
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = value.amountMinor.startsWith("-");
  const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`}`;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return <bdi className="break-all tabular-nums" dir="ltr">{moneyMajor(value)} {value.currency}</bdi>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(userFacingErrorMessage(payload, messages.forecasts.failure));
  return payload as T;
}

function ForecastResult({ forecast }: Readonly<{ forecast: ForecastSnapshotView }>) {
  return (
    <div className="space-y-7">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{messages.forecasts.result.title}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]"><bdi dir="ltr">{forecast.evaluationDate} — {forecast.horizonEndDate}</bdi></p>
          </div>
          <p className="rounded-full bg-[var(--background)] px-4 py-2 font-semibold">
            {messages.forecasts.confidence.title}: {messages.forecasts.confidence[forecast.confidence]}
          </p>
        </div>
        {forecast.dataFreshness === "STALE" ? (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="status">
            <p className="font-semibold">{messages.forecasts.freshness.STALE}</p>
            <p className="mt-1 text-sm">{messages.forecasts.freshness.warning}</p>
          </div>
        ) : <p className="mt-4 text-sm font-semibold text-emerald-700">{messages.forecasts.freshness.FRESH}</p>}
        <p className="mt-4 text-sm text-[var(--muted)]">{messages.forecasts.confidence.description}</p>
        <ul className="mt-2 list-disc ps-6 text-sm text-[var(--muted)]">
          {forecast.confidenceReasons.map((reason) => <li key={reason}>{messages.forecasts.confidence.reasons[reason]}</li>)}
        </ul>
        <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div><dt>{messages.forecasts.result.currentSafeToSpend}</dt><dd className="mt-1 text-xl font-semibold"><MoneyValue value={forecast.currentSafeToSpend} /></dd></div>
          <div><dt>{messages.forecasts.result.confirmedEnd}</dt><dd className="mt-1 text-xl font-semibold"><MoneyValue value={forecast.confirmedEndBalance} /></dd></div>
          <div><dt>{messages.forecasts.result.projectedEnd}</dt><dd className="mt-1 text-xl font-semibold"><MoneyValue value={forecast.projectedEndBalance} /></dd></div>
          <div><dt>{messages.forecasts.result.minimum}</dt><dd className="mt-1 text-xl font-semibold"><MoneyValue value={forecast.projectedMinimumBalance} /> · <bdi dir="ltr">{forecast.projectedMinimumDate}</bdi></dd></div>
          <div><dt>{messages.forecasts.result.firstBelowMargin}</dt><dd className="mt-1"><bdi dir="ltr">{forecast.firstBelowSafetyMarginDate ?? "—"}</bdi></dd></div>
          <div><dt>{messages.forecasts.result.firstBelowZero}</dt><dd className="mt-1"><bdi dir="ltr">{forecast.firstBelowZeroDate ?? "—"}</bdi></dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3 text-sm text-[var(--muted)]">
          <span>{messages.forecasts.result.estimatedCount(forecast.estimatedEventCount)}</span>
          <span>{messages.forecasts.result.duplicateSuppressed(forecast.duplicateEstimatesSuppressed)}</span>
          <bdi dir="ltr">{forecast.engineVersion} · {forecast.policyVersion} · {forecast.confidenceVersion}</bdi>
        </div>
      </section>
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-semibold">{messages.forecasts.events.title}</h2>
        {forecast.events.length === 0 ? <p className="mt-4 text-[var(--muted)]">—</p> : (
          <ol className="mt-5 space-y-3">
            {forecast.events.slice(0, 100).map((event) => (
              <li className="rounded-2xl bg-[var(--background)] p-4" key={event.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{messages.forecasts.events[event.truthStatus]} · {messages.forecasts.events[event.type]}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{messages.forecasts.events[event.source]}</p>
                  </div>
                  <MoneyValue value={event.amount} />
                </div>
                <p className="mt-2 text-sm"><bdi dir="ltr">{event.calendarDate}</bdi> · <bdi dir="ltr">{event.provenance.alias}</bdi>{event.confidence === null ? null : <> · {messages.forecasts.confidence[event.confidence]}</>}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function ForecastCenter({ initialView }: Readonly<{ initialView: ForecastCenterView }>) {
  const [forecasts, setForecasts] = useState(initialView.forecasts);
  const [scenarios, setScenarios] = useState(initialView.scenarios);
  const [horizon, setHorizon] = useState(initialView.defaultHorizonDays);
  const [busy, setBusy] = useState<"forecast" | "scenario" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const latest = forecasts[0] ?? null;
  const defaultScenarioDate = useMemo(() => latest?.evaluationDate ?? new Date().toISOString().slice(0, 10), [latest]);

  async function calculate() {
    setBusy("forecast"); setError(""); setMessage("");
    try {
      await postJson("/api/financial-engine/snapshots", {
        horizonDays: horizon,
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await postJson<{ forecast: ForecastSnapshotView }>("/api/forecasts", {
        horizonDays: horizon,
        idempotencyKey: crypto.randomUUID(),
      });
      setForecasts((current) => [response.forecast, ...current].slice(0, 10));
      setMessage(messages.forecasts.status.calculated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.forecasts.failure);
    } finally { setBusy(null); }
  }

  async function createScenario(form: HTMLFormElement) {
    if (latest === null) return;
    setBusy("scenario"); setError(""); setMessage("");
    const data = new FormData(form);
    try {
      const response = await postJson<{ scenario: ForecastScenarioView }>("/api/forecast-scenarios", {
        adjustments: [{
          amount: { amount: String(data.get("amount") ?? ""), currency: initialView.currency },
          calendarDate: String(data.get("calendarDate") ?? ""),
          kind: String(data.get("kind") ?? ""),
        }],
        forecastId: latest.id,
        idempotencyKey: crypto.randomUUID(),
        name: String(data.get("name") ?? ""),
        note: String(data.get("note") ?? "").trim() || null,
      });
      setScenarios((current) => [response.scenario, ...current].slice(0, 20));
      setMessage(messages.forecasts.scenario.saved);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.forecasts.failure);
    } finally { setBusy(null); }
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <label className="grid max-w-sm gap-2 font-semibold">
          {messages.forecasts.form.horizon}
          <select className="rounded-xl border border-[var(--border)] px-4 py-3" dir="ltr" value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
            {initialView.supportedHorizons.map((days) => <option key={days} value={days}>{messages.forecasts.horizons(days)}</option>)}
          </select>
        </label>
        <button className="mt-4 rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={busy !== null} onClick={() => void calculate()} type="button">
          {busy === "forecast" ? messages.forecasts.actions.calculating : messages.forecasts.actions.calculate}
        </button>
        {message === "" ? null : <p className="mt-4 font-semibold" role="status">{message}</p>}
        {error === "" ? null : <p className="mt-4 font-semibold text-red-700" role="alert">{error}</p>}
      </section>
      {latest === null ? <p className="rounded-3xl border border-[var(--border)] bg-white p-6 text-[var(--muted)]">{messages.forecasts.empty}</p> : <ForecastResult forecast={latest} />}
      {latest === null ? null : (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-2xl font-semibold">{messages.forecasts.scenario.title}</h2>
          <p className="mt-3 leading-7 text-[var(--muted)]">{messages.forecasts.scenario.separation}</p>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void createScenario(event.currentTarget); }}>
            <label className="grid gap-2 font-semibold">{messages.forecasts.form.name}<input className="rounded-xl border border-[var(--border)] px-4 py-3" maxLength={80} name="name" required /></label>
            <label className="grid gap-2 font-semibold">{messages.forecasts.form.scenarioKind}<select className="rounded-xl border border-[var(--border)] px-4 py-3" name="kind">{Object.entries(messages.forecasts.scenario.kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
            <label className="grid gap-2 font-semibold">{messages.forecasts.form.amount}<input className="rounded-xl border border-[var(--border)] px-4 py-3" dir="ltr" inputMode="decimal" name="amount" required /></label>
            <label className="grid gap-2 font-semibold">{messages.forecasts.form.date}<input className="rounded-xl border border-[var(--border)] px-4 py-3" defaultValue={defaultScenarioDate} dir="ltr" max={latest.horizonEndDate} min={latest.evaluationDate} name="calendarDate" required type="date" /></label>
            <label className="grid gap-2 font-semibold sm:col-span-2">{messages.forecasts.form.note}<input className="rounded-xl border border-[var(--border)] px-4 py-3" maxLength={500} name="note" /></label>
            <button className="rounded-2xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:opacity-60 sm:col-span-2" disabled={busy !== null} type="submit">{busy === "scenario" ? messages.forecasts.actions.creatingScenario : messages.forecasts.actions.createScenario}</button>
          </form>
        </section>
      )}
      {scenarios.length === 0 ? null : (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-2xl font-semibold">{messages.forecasts.scenario.title}</h2>
          <ul className="mt-5 grid gap-4 md:grid-cols-2">
            {scenarios.map((scenario) => <li className="rounded-2xl bg-[var(--background)] p-4" key={scenario.id}><h3 className="font-semibold">{scenario.name}</h3><p className="mt-2"><MoneyValue value={scenario.result.projectedEndBalance} /> · <MoneyValue value={scenario.result.projectedEndDelta} /></p><p className="mt-2 text-sm text-[var(--muted)]"><bdi dir="ltr">{scenario.calculatedAt}</bdi></p></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
