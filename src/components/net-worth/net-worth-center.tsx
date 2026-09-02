"use client";

import { useMemo, useState, type FormEvent } from "react";

import type { SerializedMoney } from "@/lib/domain/money/money";
import { messages, userFacingErrorMessage } from "@/lib/i18n";
import type { NetWorthCenterView } from "@/lib/net-worth/net-worth";

type CenterResponse = NetWorthCenterView;

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as unknown;
  return userFacingErrorMessage(payload, messages.netWorth.failure);
}

function moneyMajor(value: SerializedMoney): string {
  const digits = fractionDigits(value.currency);
  const amount = BigInt(value.amountMinor);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const factor = 10n ** BigInt(digits);
  const whole = absolute / factor;
  if (digits === 0) return `${sign}${whole.toString()}`;
  return `${sign}${whole.toString()}.${(absolute % factor).toString().padStart(digits, "0")}`;
}

function ExactMoney({ value }: Readonly<{ value: SerializedMoney }>) {
  return <bdi dir="ltr">{moneyMajor(value)} {value.currency}</bdi>;
}

function chartPoints(values: readonly bigint[]): string {
  if (values.length === 0) return "";
  const maximum = values.reduce((current, value) => {
    const absolute = value < 0n ? -value : value;
    return absolute > current ? absolute : current;
  }, 1n);
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : Math.round(index * 100 / (values.length - 1));
    const scaled = Number((value * 40n) / maximum);
    return `${x},${50 - scaled}`;
  }).join(" ");
}

export function NetWorthCenter({ initialView }: Readonly<{ initialView: NetWorthCenterView }>) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [relationship, setRelationship] = useState("standalone");
  const historyByCurrency = useMemo(() => {
    const result = new Map<string, { dates: string[]; values: bigint[] }>();
    for (const snapshot of [...view.snapshots].reverse()) {
      for (const total of snapshot.statement.totals) {
        const series = result.get(total.netWorth.currency) ?? { dates: [], values: [] };
        series.dates.push(snapshot.statement.evaluationDate);
        series.values.push(BigInt(total.netWorth.amountMinor));
        result.set(total.netWorth.currency, series);
      }
    }
    return [...result.entries()];
  }, [view.snapshots]);

  async function refresh(): Promise<void> {
    const response = await fetch("/api/net-worth/items", { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response));
    setView(await response.json() as CenterResponse);
  }

  async function submitItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true); setFailure(null); setStatus(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const relation = String(data.get("relationship"));
    const linkedId = String(data.get("linkedId") ?? "");
    const side = relation === "account_detail_parent" || relation === "account_detail_details" ? "asset"
      : relation === "loan" || relation === "credit_card" ? "liability" : String(data.get("side"));
    const category = relation.startsWith("account_detail") ? "investment"
      : relation === "loan" ? "loan" : relation === "credit_card" ? "credit_card" : String(data.get("category"));
    const normalizedRelationship = relation === "standalone" ? { kind: "standalone" }
      : relation === "account_detail_parent" || relation === "account_detail_details"
        ? { accountId: linkedId, aggregationMode: relation === "account_detail_details" ? "detail_authoritative" : "parent_authoritative", kind: "account_detail" }
        : { kind: "liability_evidence", recordId: linkedId, recordKind: relation };
    try {
      const response = await fetch("/api/net-worth/items", {
        body: JSON.stringify({
          fields: {
            amount: { amount: String(data.get("amount")), currency: String(data.get("currency")).toUpperCase() },
            category,
            effectiveAt: new Date(String(data.get("effectiveAt"))).toISOString(),
            label: String(data.get("label")),
            provenanceNote: String(data.get("note") || "") || null,
            relationship: normalizedRelationship,
            side,
            valuationType: String(data.get("valuationType")),
          },
          idempotencyKey: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      form.reset();
      setRelationship("standalone");
      await refresh();
      setStatus(messages.netWorth.messages.added);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : messages.netWorth.failure);
    } finally { setBusy(false); }
  }

  async function capture(): Promise<void> {
    setBusy(true); setFailure(null); setStatus(null);
    try {
      const response = await fetch("/api/net-worth/snapshots", {
        body: JSON.stringify({ trigger: "explicit" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      await refresh();
      setStatus(messages.netWorth.messages.captured);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : messages.netWorth.failure);
    } finally { setBusy(false); }
  }

  async function remove(id: string, expectedVersion: number): Promise<void> {
    setBusy(true); setFailure(null); setStatus(null);
    try {
      const response = await fetch("/api/net-worth/items", {
        body: JSON.stringify({ id, expectedVersion }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await responseError(response));
      await refresh();
      setStatus(messages.netWorth.messages.removed);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : messages.netWorth.failure);
    } finally { setBusy(false); }
  }

  const linkedOptions = relationship.startsWith("account_detail") ? view.sourceOptions.accounts
    : relationship === "loan" ? view.sourceOptions.loans
      : relationship === "credit_card" ? view.sourceOptions.cards : [];

  return (
    <div className="mt-10 space-y-8">
      {view.current.freshness === "STALE" ? <p role="status" className="rounded-2xl border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-950">{messages.netWorth.freshness.warning}</p> : null}
      <section aria-labelledby="net-worth-summary-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="net-worth-summary-title" className="text-2xl font-semibold">{messages.netWorth.summary.netWorth}</h2>
          <button type="button" disabled={busy} onClick={() => void capture()} className="rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? messages.netWorth.actions.capturing : messages.netWorth.actions.capture}</button>
        </div>
        {view.current.totals.length === 0 ? <p className="text-[var(--muted)]">{messages.netWorth.included}: 0</p> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {view.current.totals.map((total) => <article key={total.netWorth.currency} className="rounded-3xl border border-[var(--line)] bg-white p-5 shadow-sm">
              <p className="text-sm text-[var(--muted)]">{messages.netWorth.summary.netWorth}</p>
              <p className="mt-2 text-3xl font-semibold"><ExactMoney value={total.netWorth} /></p>
              <dl className="mt-4 grid gap-2 text-sm">
                <div className="flex justify-between gap-4"><dt>{messages.netWorth.summary.assets}</dt><dd><ExactMoney value={total.assets} /></dd></div>
                <div className="flex justify-between gap-4"><dt>{messages.netWorth.summary.liabilities}</dt><dd><ExactMoney value={total.liabilities} /></dd></div>
                <div className="flex justify-between gap-4"><dt>{messages.netWorth.summary.cashAssets}</dt><dd><ExactMoney value={total.cashAssets} /></dd></div>
                <div className="flex justify-between gap-4"><dt>{messages.netWorth.summary.nonCashAssets}</dt><dd><ExactMoney value={total.nonCashAssets} /></dd></div>
              </dl>
            </article>)}
          </div>
        )}
      </section>

      <section aria-labelledby="net-worth-components-title" className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
        <h2 id="net-worth-components-title" className="text-2xl font-semibold">{messages.netWorth.included}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{messages.netWorth.separation}</p>
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {view.current.included.map((component) => <li key={component.id} className="rounded-2xl border border-[var(--line)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><strong>{component.label}</strong><ExactMoney value={component.amount} /></div>
            <p className="mt-2 text-sm text-[var(--muted)]">{messages.netWorth.sides[component.side]} · {messages.netWorth.categories[component.category]} · {messages.netWorth.valuationTypes[component.valuationType]}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{messages.netWorth.provenance[component.provenance.kind]} · {messages.netWorth.freshness[component.freshness]}</p>
            <p className="mt-1 text-xs" dir="ltr"><bdi>{component.effectiveAt}</bdi></p>
          </li>)}
        </ul>
        {view.current.excluded.length > 0 ? <details className="mt-6"><summary className="cursor-pointer font-semibold">{messages.netWorth.excludedTitle} ({view.current.excluded.length})</summary><ul className="mt-3 space-y-2">{view.current.excluded.map((entry) => <li key={entry.component.id} className="text-sm"><strong>{entry.component.label}</strong> — {messages.netWorth.excluded[entry.reason]}</li>)}</ul></details> : null}
        <p className="mt-5 text-sm text-[var(--muted)]">קישורי יעדי חיסכון קיימים: <bdi dir="ltr">{view.goalLinks.length}</bdi>. הקישורים אינם מוסיפים ערך נוסף לדוח.</p>
      </section>

      <section aria-labelledby="net-worth-add-title" className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
        <h2 id="net-worth-add-title" className="text-2xl font-semibold">{messages.netWorth.actions.add}</h2>
        <form onSubmit={(event) => void submitItem(event)} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2"><span>{messages.netWorth.form.label}</span><input required name="label" maxLength={100} className="rounded-xl border border-[var(--line)] px-3 py-2" /></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.relationship}</span><select name="relationship" value={relationship} onChange={(event) => setRelationship(event.target.value)} className="rounded-xl border border-[var(--line)] px-3 py-2"><option value="standalone">{messages.netWorth.relationships.standalone}</option><option value="account_detail_parent">{messages.netWorth.relationships.parentAuthoritative}</option><option value="account_detail_details">{messages.netWorth.relationships.detailAuthoritative}</option><option value="loan">ראיית יתרה להלוואה קיימת</option><option value="credit_card">ראיית יתרה לכרטיס קיים</option></select></label>
          {relationship !== "standalone" ? <label className="grid gap-2"><span>{messages.netWorth.form.account}</span><select required name="linkedId" className="rounded-xl border border-[var(--line)] px-3 py-2"><option value="">בחירה…</option>{linkedOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label> : null}
          <label className="grid gap-2"><span>{messages.netWorth.form.side}</span><select name="side" disabled={relationship !== "standalone"} className="rounded-xl border border-[var(--line)] px-3 py-2"><option value="asset">{messages.netWorth.sides.asset}</option><option value="liability">{messages.netWorth.sides.liability}</option></select></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.category}</span><select name="category" disabled={relationship !== "standalone"} className="rounded-xl border border-[var(--line)] px-3 py-2">{Object.entries(messages.netWorth.categories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.valuationType}</span><select name="valuationType" className="rounded-xl border border-[var(--line)] px-3 py-2">{Object.entries(messages.netWorth.valuationTypes).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.amount}</span><input required name="amount" inputMode="decimal" dir="ltr" defaultValue="0.00" className="rounded-xl border border-[var(--line)] px-3 py-2" /></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.currency}</span><input required name="currency" dir="ltr" defaultValue="ILS" pattern="[A-Za-z]{3}" maxLength={3} className="rounded-xl border border-[var(--line)] px-3 py-2 uppercase" /></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.effectiveAt}</span><input required type="datetime-local" name="effectiveAt" dir="ltr" defaultValue={new Date().toISOString().slice(0, 16)} className="rounded-xl border border-[var(--line)] px-3 py-2" /></label>
          <label className="grid gap-2"><span>{messages.netWorth.form.note}</span><input name="note" maxLength={240} className="rounded-xl border border-[var(--line)] px-3 py-2" /></label>
          <button disabled={busy} className="rounded-full bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50 md:col-span-2">{busy ? messages.netWorth.actions.adding : messages.netWorth.actions.add}</button>
        </form>
        {view.items.length > 0 ? <ul className="mt-6 space-y-2">{view.items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] p-3"><span><strong>{item.fields.label}</strong> · <ExactMoney value={item.fields.amount} /></span><button type="button" disabled={busy} onClick={() => void remove(item.id, item.version)} className="text-sm font-semibold text-red-700">{messages.netWorth.actions.remove}</button></li>)}</ul> : null}
      </section>

      <section aria-labelledby="net-worth-history-title" className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
        <h2 id="net-worth-history-title" className="text-2xl font-semibold">{messages.netWorth.history.title}</h2>
        {historyByCurrency.map(([currency, series]) => <figure key={currency} className="mt-5"><figcaption className="font-semibold" dir="ltr">{currency}</figcaption><svg role="img" aria-label={`מגמת שווי נקי ${currency}`} viewBox="0 0 100 100" className="mt-2 h-36 w-full rounded-xl bg-[var(--surface)]" preserveAspectRatio="none"><line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" opacity="0.2" /><polyline points={chartPoints(series.values)} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></figure>)}
        {view.snapshots.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.netWorth.emptyHistory}</p> : <ol className="mt-5 space-y-3">{view.snapshots.map((snapshot) => <li key={snapshot.id} className="rounded-2xl border border-[var(--line)] p-4"><div className="flex flex-wrap justify-between gap-3"><span>{messages.netWorth.history[snapshot.trigger]}</span><bdi dir="ltr">{snapshot.statement.evaluationDate}</bdi></div><ul className="mt-2 flex flex-wrap gap-4">{snapshot.statement.totals.map((total) => <li key={total.netWorth.currency}><ExactMoney value={total.netWorth} /></li>)}</ul></li>)}</ol>}
      </section>
      <div aria-live="polite" role="status" className="min-h-6 text-sm font-semibold text-[var(--accent)]">{status}</div>
      {failure === null ? null : <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{failure}</p>}
      <p className="text-xs text-[var(--muted)]"><bdi dir="ltr">{view.current.engineVersion}</bdi> · <bdi dir="ltr">{view.current.policyVersion}</bdi> · <bdi dir="ltr">{view.current.freshnessVersion}</bdi></p>
    </div>
  );
}
