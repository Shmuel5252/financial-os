"use client";

import { useState, type FormEvent } from "react";

import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";
import type {
  PurchaseSimulationCenterView,
  PurchaseSimulationEvaluationView,
} from "@/lib/purchase-simulations/purchase-simulation";
import type { SerializedMoney } from "@/lib/domain/money/money";

function moneyMajor(value: SerializedMoney): string {
  const digits = new Intl.NumberFormat("en", {
    currency: value.currency,
    style: "currency",
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const minor = BigInt(value.amountMinor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const major = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0");
  return `${negative ? "-" : ""}${major}${digits === 0 ? "" : `.${fraction}`}`;
}

function formatMoney(value: SerializedMoney): string {
  return `${moneyMajor(value)} ${value.currency}`;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return <bdi dir="ltr">{formatMoney(value)}</bdi>;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

function responsePayload(form: HTMLFormElement, view: PurchaseSimulationCenterView) {
  const data = new FormData(form);
  const inputMode = String(data.get("inputMode"));
  const charges = [
    { key: "interest", kind: "interest", label: messages.purchaseSimulation.charges.interest },
    { key: "fee", kind: "fee", label: messages.purchaseSimulation.charges.fee },
  ].flatMap(({ key, kind, label }) => {
    const amount = String(data.get(`${key}Amount`) ?? "").trim();
    if (amount === "") return [];
    const note = String(data.get(`${key}Note`) ?? "").trim();
    return [{
      amount: { amount, currency: view.currency },
      kind,
      label,
      provenance: { kind: "user_reported", note: note === "" ? null : note },
    }];
  });
  return {
    charges,
    inputMode,
    installmentCount: inputMode === "one_time"
      ? 1
      : Number(data.get("installmentCount")),
    installmentFrequency: "monthly",
    proposedDate: String(data.get("proposedDate")),
    sourceSnapshotId: view.baseline?.id ?? "",
    totalPurchasePrice: {
      amount: String(data.get("totalPurchasePrice")),
      currency: view.currency,
    },
  };
}

function Classification({ evaluation }: Readonly<{ evaluation: PurchaseSimulationEvaluationView }>) {
  const classification = evaluation.result.riskClassification;
  const stale = evaluation.dataFreshness === "STALE";
  const description = classification === "SAFE"
    ? stale
      ? messages.purchaseSimulation.classification.staleSafeDescription
      : messages.purchaseSimulation.classification.safeDescription
    : classification === "CAUTION"
      ? messages.purchaseSimulation.classification.cautionDescription
      : messages.purchaseSimulation.classification.unsafeDescription;
  const classes = classification === "SAFE"
    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
    : classification === "CAUTION"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : "border-red-300 bg-red-50 text-red-950";
  return (
    <section className={`rounded-3xl border p-6 ${classes}`} aria-live="polite">
      <p className="text-sm font-semibold">{messages.purchaseSimulation.result.title}</p>
      <h2 className="mt-2 text-3xl font-semibold">
        {messages.purchaseSimulation.classification[classification]}
      </h2>
      <p className="mt-3 leading-7">{description}</p>
      {stale ? (
        <div className="mt-4 rounded-2xl border border-amber-400 bg-white/70 p-4" role="alert">
          <p className="font-semibold">{messages.purchaseSimulation.freshness.stale}</p>
          <ul className="mt-2 list-inside list-disc text-sm">
            {evaluation.freshnessReasons.map((reason) => (
              <li key={reason}>{messages.purchaseSimulation.freshness[reason]}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function PurchaseSimulator({
  initialView,
}: Readonly<{ initialView: PurchaseSimulationCenterView }>) {
  const [mode, setMode] = useState<"installments" | "one_time">("one_time");
  const [busy, setBusy] = useState<"evaluate" | "refresh" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<PurchaseSimulationEvaluationView | null>(null);
  const [lastCommand, setLastCommand] = useState<Record<string, unknown> | null>(null);

  async function refreshBaseline() {
    setBusy("refresh");
    setError(null);
    try {
      const response = await fetch("/api/financial-engine/snapshots", {
        body: JSON.stringify({
          horizonDays: initialView.requiredBaselineHorizonDays,
          idempotencyKey: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(userFacingErrorMessage(payload, messages.purchaseSimulation.messages.refreshFailed));
      }
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.purchaseSimulation.messages.refreshFailed);
      setBusy(null);
    }
  }

  async function evaluate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("evaluate");
    setError(null);
    setSuccess(null);
    const command = responsePayload(event.currentTarget, initialView);
    try {
      const response = await fetch("/api/purchase-simulations/evaluate", {
        body: JSON.stringify(command),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = await response.json() as Readonly<{
        evaluation?: PurchaseSimulationEvaluationView;
      }>;
      if (!response.ok || payload.evaluation === undefined) {
        throw new Error(userFacingErrorMessage(payload, messages.purchaseSimulation.messages.evaluateFailed));
      }
      setEvaluation(payload.evaluation);
      setLastCommand(command);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.purchaseSimulation.messages.evaluateFailed);
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lastCommand === null) return;
    const data = new FormData(event.currentTarget);
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/purchase-simulations", {
        body: JSON.stringify({
          ...lastCommand,
          idempotencyKey: crypto.randomUUID(),
          name: String(data.get("name") ?? "").trim() || null,
          note: String(data.get("note") ?? "").trim() || null,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(userFacingErrorMessage(payload, messages.purchaseSimulation.messages.saveFailed));
      }
      setSuccess(messages.purchaseSimulation.messages.saved);
      setTimeout(() => window.location.reload(), 500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.purchaseSimulation.messages.saveFailed);
      setBusy(null);
    }
  }

  const baseline = initialView.baseline;
  return (
    <div className="mt-10 space-y-8">
      <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 font-semibold text-sky-950">
        {messages.purchaseSimulation.separation}
      </p>
      <section className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">{messages.purchaseSimulation.baseline.title}</h2>
        <p className="mt-2 text-[var(--muted)]">
          {messages.purchaseSimulation.baseline.description(initialView.requiredBaselineHorizonDays)}
        </p>
        {baseline === null ? (
          <p className="mt-4 font-semibold">{messages.purchaseSimulation.baseline.empty}</p>
        ) : (
          <>
            <p className={`mt-4 font-semibold ${baseline.dataFreshness === "STALE" ? "text-amber-800" : "text-emerald-800"}`}>
              {baseline.dataFreshness === "STALE"
                ? messages.purchaseSimulation.freshness.stale
                : messages.purchaseSimulation.baseline.current}
            </p>
            {baseline.dataFreshness === "STALE" ? (
              <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
                {baseline.freshnessReasons.map((reason) => (
                  <li key={reason}>{messages.purchaseSimulation.freshness[reason]}</li>
                ))}
              </ul>
            ) : null}
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><dt>{messages.purchaseSimulation.baseline.calculatedAt}</dt><dd><bdi dir="ltr">{baseline.calculatedAt}</bdi></dd></div>
              <div><dt>{messages.purchaseSimulation.baseline.through}</dt><dd><bdi dir="ltr">{baseline.horizonEndDate}</bdi></dd></div>
            </dl>
          </>
        )}
        <button className="mt-5 rounded-full bg-[var(--foreground)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={busy !== null} onClick={refreshBaseline} type="button">
          {busy === "refresh" ? messages.purchaseSimulation.actions.refreshingBaseline : messages.purchaseSimulation.actions.refreshBaseline}
        </button>
      </section>

      {baseline !== null ? (
        <form className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm" onSubmit={evaluate}>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 font-semibold">
              {messages.purchaseSimulation.form.totalPrice}
              <input className="rounded-xl border border-[var(--line)] px-4 py-3" dir="ltr" inputMode="decimal" name="totalPurchasePrice" required />
            </label>
            <label className="grid gap-2 font-semibold">
              {messages.purchaseSimulation.form.proposedDate}
              <input className="rounded-xl border border-[var(--line)] px-4 py-3" defaultValue={baseline.evaluationDate} dir="ltr" max={addDays(baseline.evaluationDate, 90)} min={baseline.evaluationDate} name="proposedDate" required type="date" />
            </label>
            <label className="grid gap-2 font-semibold">
              {messages.purchaseSimulation.form.paymentMode}
              <select className="rounded-xl border border-[var(--line)] px-4 py-3" name="inputMode" onChange={(event) => setMode(event.target.value as typeof mode)} value={mode}>
                <option value="one_time">{messages.purchaseSimulation.form.oneTime}</option>
                <option value="installments">{messages.purchaseSimulation.form.installments}</option>
              </select>
            </label>
            {mode === "installments" ? (
              <label className="grid gap-2 font-semibold">
                {messages.purchaseSimulation.form.installmentCount}
                <input className="rounded-xl border border-[var(--line)] px-4 py-3" defaultValue="3" dir="ltr" max="60" min="2" name="installmentCount" required type="number" />
              </label>
            ) : null}
          </div>
          <fieldset className="mt-6 rounded-2xl border border-[var(--line)] p-5">
            <legend className="px-2 font-semibold">{messages.purchaseSimulation.charges.title}</legend>
            <p className="text-sm text-[var(--muted)]">{messages.purchaseSimulation.charges.warning}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(["interest", "fee"] as const).map((kind) => (
                <div className="grid gap-3" key={kind}>
                  <label className="grid gap-2 font-semibold">
                    {messages.purchaseSimulation.charges[kind]}
                    <input className="rounded-xl border border-[var(--line)] px-4 py-3" dir="ltr" inputMode="decimal" name={`${kind}Amount`} />
                  </label>
                  <label className="grid gap-2 text-sm">
                    {messages.purchaseSimulation.charges.note}
                    <input className="rounded-xl border border-[var(--line)] px-4 py-3" name={`${kind}Note`} />
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
          <button className="mt-6 rounded-full bg-[var(--accent)] px-6 py-3 font-semibold text-white disabled:opacity-60" disabled={busy !== null} type="submit">
            {busy === "evaluate" ? messages.purchaseSimulation.actions.evaluating : messages.purchaseSimulation.actions.evaluate}
          </button>
        </form>
      ) : null}

      {error !== null ? <p className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-900" role="alert">{error}</p> : null}
      {success !== null ? <p className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900" role="status">{success}</p> : null}

      {evaluation !== null ? (
        <div className="space-y-6">
          <Classification evaluation={evaluation} />
          <section className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold">{messages.purchaseSimulation.result.title}</h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt>{messages.purchaseSimulation.result.totalPrice}</dt><dd className="text-xl font-semibold"><MoneyValue value={evaluation.result.totalPurchasePrice} /></dd></div>
              <div><dt>{messages.purchaseSimulation.result.trueFinancedCost}</dt><dd className="text-xl font-semibold"><MoneyValue value={evaluation.result.trueFinancedCost} /></dd></div>
              <div><dt>{messages.purchaseSimulation.result.minimumBalance}</dt><dd className="text-xl font-semibold"><MoneyValue value={evaluation.result.minimumConfirmedBalance} /></dd></div>
              <div><dt>{messages.purchaseSimulation.result.minimumCapacity}</dt><dd className="text-xl font-semibold"><MoneyValue value={evaluation.result.minimumSafeCapacity} /></dd></div>
              <div><dt>{messages.purchaseSimulation.result.finalBalance}</dt><dd className="text-xl font-semibold"><MoneyValue value={evaluation.result.finalConfirmedBalance} /></dd></div>
              <div><dt>{messages.purchaseSimulation.result.evaluationWindow}</dt><dd><bdi dir="ltr">{evaluation.result.evaluationStartDate} — {evaluation.result.evaluationEndDate}</bdi></dd></div>
            </dl>
            <p className="mt-5 font-semibold">
              {evaluation.result.saferDate !== null
                ? <>{messages.purchaseSimulation.result.saferDate}: <bdi dir="ltr">{evaluation.result.saferDate}</bdi></>
                : evaluation.result.riskClassification === "SAFE"
                  ? messages.purchaseSimulation.result.noSaferDateNeeded
                  : messages.purchaseSimulation.result.noSaferDate}
            </p>
          </section>

          <section className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold">{messages.purchaseSimulation.result.fullSchedule}</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {evaluation.result.installmentSchedule.map((installment) => (
                <li className="rounded-2xl border border-[var(--line)] p-4" key={installment.number}>
                  <span className="font-semibold"><bdi dir="ltr">#{installment.number}</bdi></span>{" · "}
                  <MoneyValue value={installment.amount} />{" · "}<bdi dir="ltr">{installment.calendarDate}</bdi>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold">{messages.purchaseSimulation.timeline.title}</h2>
            <ol className="mt-4 space-y-3">
              {evaluation.result.timeline.map((point) => (
                <li className="rounded-2xl border border-[var(--line)] p-4" key={`${point.eventId}:${point.calendarDate}`}>
                  <p className="font-semibold">{point.proposedPurchase ? messages.purchaseSimulation.timeline.proposedPurchase : messages.purchaseSimulation.timeline.baselineEvent}</p>
                  <p className="mt-1"><bdi dir="ltr">{point.calendarDate}</bdi>{" · "}<MoneyValue value={point.amount} /></p>
                  <p className="text-sm text-[var(--muted)]">{messages.purchaseSimulation.timeline.balanceAfter}: <MoneyValue value={point.confirmedBalance} /></p>
                </li>
              ))}
            </ol>
            {evaluation.result.timelineTruncated ? <p className="mt-4 text-sm font-semibold">{messages.purchaseSimulation.timeline.truncated}</p> : null}
          </section>

          <form className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm" onSubmit={save}>
            <h2 className="text-2xl font-semibold">{messages.purchaseSimulation.actions.save}</h2>
            <p className="mt-2 text-[var(--muted)]">{messages.purchaseSimulation.separation}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 font-semibold">{messages.purchaseSimulation.form.name}<input className="rounded-xl border border-[var(--line)] px-4 py-3" maxLength={80} name="name" /></label>
              <label className="grid gap-2 font-semibold">{messages.purchaseSimulation.form.note}<input className="rounded-xl border border-[var(--line)] px-4 py-3" maxLength={500} name="note" /></label>
            </div>
            <button className="mt-5 rounded-full bg-[var(--foreground)] px-6 py-3 font-semibold text-white disabled:opacity-60" disabled={busy !== null} type="submit">
              {busy === "save" ? messages.purchaseSimulation.actions.saving : messages.purchaseSimulation.actions.save}
            </button>
          </form>
        </div>
      ) : null}

      <section className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">{messages.purchaseSimulation.saved.title}</h2>
        {initialView.saved.length === 0 ? <p className="mt-3 text-[var(--muted)]">{messages.purchaseSimulation.saved.empty}</p> : (
          <ul className="mt-4 space-y-4">
            {initialView.saved.map((saved) => (
              <li className="rounded-2xl border border-[var(--line)] p-5" key={saved.id}>
                <h3 className="font-semibold">{saved.name ?? messages.purchaseSimulation.saved.hypothetical}</h3>
                <p className="mt-2"><bdi dir="ltr">{saved.createdAt}</bdi>{" · "}{messages.purchaseSimulation.classification[saved.evaluation.result.riskClassification]}{" · "}<MoneyValue value={saved.evaluation.result.trueFinancedCost} /></p>
                <p className="mt-2 text-sm text-[var(--muted)]">{messages.purchaseSimulation.saved.hypothetical}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-[var(--muted)]"><bdi dir="ltr">{initialView.currency}</bdi>{" · "}<bdi dir="ltr">{initialView.timeZone}</bdi>{" · "}{appLocale.htmlLanguage}</p>
    </div>
  );
}
