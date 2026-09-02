"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { AiStructuredResponse } from "@/lib/ai/ai";
import type { SerializedMoney } from "@/lib/domain/money/money";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";
import type { FinancialReportView, SavedFinancialReportView } from "@/lib/reports/report";
import type { ReportAiSummaryView } from "@/lib/reports/report-summary";
import type { SearchPageView } from "@/lib/search/search";

type HouseholdOption = Readonly<{ id: string; name: string }>;

function formatMoney(value: SerializedMoney): string {
  const digits = new Intl.NumberFormat(appLocale.intlLocale, { currency: value.currency, style: "currency" }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = value.amountMinor.startsWith("-"); const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor; const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`} ${value.currency}`;
}

function reportLineLabel(line: FinancialReportView["sections"][keyof FinancialReportView["sections"]][number]): string {
  const metricLabels: Readonly<Record<string, string>> = {
    "cash_flow.expense": messages.reports.metrics.expense, "cash_flow.income": messages.reports.metrics.income,
    "cash_flow.net": messages.reports.metrics.net, "cash_flow.refund": messages.reports.metrics.refund, "net_worth.total": messages.reports.metrics.netWorth,
  };
  if (metricLabels[line.key] !== undefined) return metricLabels[line.key]!;
  if (line.key === "category.spending") {
    const category = line.label.replace(/^system:/u, "");
    return (messages.onboarding.form.categories as Readonly<Record<string, string>>)[category] ?? line.label;
  }
  return line.label;
}

async function requestJson<T>(url: string, method: "DELETE" | "POST", body: unknown): Promise<T> {
  const response = await fetch(url, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method }); const payload: unknown = await response.json();
  if (!response.ok) throw new Error(userFacingErrorMessage(payload, messages.reports.failure)); return payload as T;
}

function SummaryResponse({ response }: Readonly<{ response: AiStructuredResponse }>) {
  const groups = [["עובדות", response.fact], ["תובנות", response.insight], ["צעדים אפשריים", response.recommendation]] as const;
  return <div className="grid gap-4 md:grid-cols-3">{groups.map(([title, items]) => <section className="rounded-2xl bg-[var(--background)] p-4" key={title}><h4 className="font-semibold">{title}</h4><ul className="mt-3 space-y-2 text-sm leading-6">{items.map((item, index) => <li key={`${title}-${index}`}>{item.text}</li>)}</ul></section>)}</div>;
}

export function ReportCenter({ households, initialCurrent, initialSaved, initialSummaries }: Readonly<{
  households: readonly HouseholdOption[]; initialCurrent: FinancialReportView; initialSaved: readonly SavedFinancialReportView[]; initialSummaries: readonly ReportAiSummaryView[];
}>) {
  const router = useRouter(); const [busy, setBusy] = useState<string | null>(null); const [failure, setFailure] = useState(""); const [status, setStatus] = useState("");
  const [periodKind, setPeriodKind] = useState<"month" | "year">(initialCurrent.period.kind);
  const [periodValue, setPeriodValue] = useState(initialCurrent.period.value);
  const [query, setQuery] = useState(""); const [searchPage, setSearchPage] = useState<SearchPageView | null>(null); const [reason, setReason] = useState("");
  const latestForPeriod = useMemo(() => initialSaved.find((saved) => saved.report.period.kind === initialCurrent.period.kind && saved.report.period.value === initialCurrent.period.value && JSON.stringify(saved.report.scope) === JSON.stringify(initialCurrent.scope)) ?? null, [initialCurrent, initialSaved]);
  const exportParams = new URLSearchParams({ periodKind: initialCurrent.period.kind, periodValue: initialCurrent.period.value, scopeKind: initialCurrent.scope.kind });
  if (initialCurrent.scope.kind === "household") exportParams.set("householdId", initialCurrent.scope.householdId);

  async function closeOrRestate() {
    const action = latestForPeriod === null ? "close" : "restate"; setBusy(action); setFailure(""); setStatus("");
    try {
      await requestJson("/api/reports", "POST", { action, idempotencyKey: crypto.randomUUID(), period: initialCurrent.period, ...(action === "restate" ? { reason, supersedesId: latestForPeriod!.id } : {}), scope: initialCurrent.scope });
      setStatus(action === "close" ? messages.reports.messages.closed : messages.reports.messages.restated); router.refresh();
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.reports.failure); } finally { setBusy(null); }
  }
  async function rebuildAndSearch() {
    setBusy("search"); setFailure(""); setStatus("");
    try {
      if (initialCurrent.scope.kind === "personal") { const indexed = await requestJson<{ indexedCount: number }>("/api/search", "POST", { confirm: true }); setStatus(`${messages.reports.messages.indexed} (${indexed.indexedCount})`); }
      const params = new URLSearchParams({ limit: "25", query, scopeKind: initialCurrent.scope.kind }); if (initialCurrent.scope.kind === "household") params.set("householdId", initialCurrent.scope.householdId);
      const response = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" }); const payload = await response.json() as { page?: SearchPageView }; if (!response.ok || payload.page === undefined) throw new Error(messages.reports.failure); setSearchPage(payload.page);
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.reports.failure); } finally { setBusy(null); }
  }
  async function summarize() {
    if (latestForPeriod === null) return; setBusy("summary"); setFailure(""); setStatus(""); const expected = initialSummaries[0]?.version ?? null;
    try { await requestJson("/api/report-summaries", "POST", { expectedSummaryVersion: expected, idempotencyKey: crypto.randomUUID(), reportId: latestForPeriod.id }); setStatus(messages.reports.messages.summarized); router.refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : messages.reports.failure); } finally { setBusy(null); }
  }

  return <div className="mt-9 space-y-8">
    <form className="grid gap-4 rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm sm:grid-cols-4" method="get">
      <label className="grid gap-2 font-semibold">{messages.reports.fields.period}<select className="rounded-xl border border-[var(--border)] px-3 py-2" name="periodKind" onChange={(event) => {
        const nextKind = event.target.value === "year" ? "year" : "month";
        setPeriodKind(nextKind);
        setPeriodValue((current) => nextKind === "year" ? current.slice(0, 4) : /^\d{4}-\d{2}$/u.test(current) ? current : `${current.slice(0, 4)}-01`);
      }} value={periodKind}><option value="month">{messages.reports.periodKinds.month}</option><option value="year">{messages.reports.periodKinds.year}</option></select></label>
      <label className="grid gap-2 font-semibold">{periodKind === "month" ? messages.reports.fields.month : messages.reports.fields.year}<input className="rounded-xl border border-[var(--border)] px-3 py-2" dir="ltr" inputMode="numeric" name="periodValue" onChange={(event) => setPeriodValue(event.target.value)} pattern={periodKind === "month" ? "\\d{4}-\\d{2}" : "\\d{4}"} required value={periodValue} /></label>
      <label className="grid gap-2 font-semibold">{messages.reports.fields.scope}<select className="rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={initialCurrent.scope.kind === "personal" ? "personal" : initialCurrent.scope.householdId} name="scope"><option value="personal">{messages.reports.scope.personal}</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label>
      <button className="self-end rounded-xl bg-[var(--ink)] px-4 py-2 font-semibold text-white" type="submit">הצגת דוח</button>
    </form>

    <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold">{initialCurrent.period.value}</h2><p className="mt-1 text-sm text-[var(--muted)]">{initialCurrent.scope.kind === "personal" ? messages.reports.scope.personal : messages.reports.scope.household}</p></div><div className="flex flex-wrap gap-3"><a className="rounded-xl border border-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent)]" href={`/api/reports/export?${exportParams.toString()}&format=csv`}>{messages.reports.actions.exportCsv}</a><a className="rounded-xl border border-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent)]" href={`/api/reports/export?${exportParams.toString()}&format=json`}>{messages.reports.actions.exportJson}</a></div></div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">{(Object.keys(initialCurrent.sections) as (keyof FinancialReportView["sections"])[]).map((section) => <section className="rounded-2xl border border-[var(--border)] p-5" key={section}><h3 className="text-lg font-semibold">{messages.reports.sections[section]}</h3>{initialCurrent.sections[section].length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{messages.reports.emptySection}</p> : <ul className="mt-4 space-y-3">{initialCurrent.sections[section].map((line, index) => <li className="flex items-start justify-between gap-4" key={`${line.key}-${line.amount.currency}-${index}`}><span>{reportLineLabel(line)}</span><bdi className="font-semibold" dir="ltr">{formatMoney(line.amount)}</bdi></li>)}</ul>}</section>)}</div>
      {latestForPeriod === null ? null : <p className="mt-5 text-sm text-[var(--muted)]">{messages.reports.closed.immutable}</p>}
      {latestForPeriod === null ? null : <label className="mt-5 grid max-w-xl gap-2 font-semibold">{messages.reports.closed.restatementReason}<textarea className="rounded-xl border border-[var(--border)] p-3" maxLength={500} minLength={5} onChange={(event) => setReason(event.target.value)} value={reason} /></label>}
      <button className="mt-5 rounded-xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null || (latestForPeriod !== null && reason.trim().length < 5)} onClick={() => void closeOrRestate()} type="button">{busy === "close" || busy === "restate" ? messages.reports.actions.closing : latestForPeriod === null ? messages.reports.actions.close : messages.reports.actions.restate}</button>
    </section>

    <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm"><h2 className="text-2xl font-semibold">{messages.reports.search.title}</h2><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-4 py-3" onChange={(event) => setQuery(event.target.value)} placeholder={messages.reports.search.placeholder} value={query} /><button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null || query.trim().length < 2} onClick={() => void rebuildAndSearch()} type="button">{messages.reports.actions.search}</button></div>{searchPage === null ? null : searchPage.results.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.reports.search.empty}</p> : <ul className="mt-5 space-y-3">{searchPage.results.map((result) => <li className="rounded-xl bg-[var(--background)] p-4" key={result.key}><strong>{result.title}</strong><p className="mt-1 text-sm text-[var(--muted)]">{result.subtitle} · {messages.reports.search.freshness[result.freshness]}</p></li>)}</ul>}</section>

    <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm"><h2 className="text-2xl font-semibold">{messages.reports.ai.title}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{messages.reports.ai.authority}</p>{latestForPeriod === null ? <p className="mt-4 text-[var(--muted)]">יש לסגור דוח לפני יצירת סיכום.</p> : <button className="mt-4 rounded-xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null} onClick={() => void summarize()} type="button">{busy === "summary" ? messages.reports.actions.summarizing : messages.reports.actions.summarize}</button>}{initialSummaries.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.reports.ai.empty}</p> : <div className="mt-5 space-y-5">{initialSummaries.map((summary) => <div key={summary.id}><p className="mb-3 text-xs text-[var(--muted)]"><bdi dir="ltr">{summary.createdAt}</bdi> · v{summary.version}</p><SummaryResponse response={summary.response} /></div>)}</div>}</section>

    <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm"><h2 className="text-2xl font-semibold">{messages.reports.closed.title}</h2>{initialSaved.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.reports.closed.empty}</p> : <ol className="mt-5 space-y-3">{initialSaved.map((saved) => <li className="rounded-xl bg-[var(--background)] p-4" key={saved.id}><strong>{saved.report.period.value}</strong><span className="me-3 text-sm text-[var(--muted)]">{messages.reports.closed.status[saved.status]} · v{saved.reportVersion}</span>{saved.restatementReason === null ? null : <p className="mt-2 text-sm">{saved.restatementReason}</p>}<div className="mt-3 flex gap-3"><a className="text-sm font-semibold text-[var(--accent)]" href={`/api/reports/export?snapshotId=${saved.id}&format=csv`}>{messages.reports.actions.exportCsv}</a><a className="text-sm font-semibold text-[var(--accent)]" href={`/api/reports/export?snapshotId=${saved.id}&format=json`}>{messages.reports.actions.exportJson}</a></div></li>)}</ol>}</section>
    <p className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm text-[var(--muted)]">{messages.reports.phase9}</p><div aria-live="polite" className="min-h-6 text-sm font-semibold text-[var(--accent)]" role="status">{status}</div>{failure === "" ? null : <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{failure}</p>}
  </div>;
}
