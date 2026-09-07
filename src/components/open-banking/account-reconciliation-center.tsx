"use client";

import { useState } from "react";

import { messages, userFacingErrorMessage } from "@/lib/i18n";
import type { AccountReconciliationCommand, AccountReconciliationRow, AccountReconciliationView, ReconciliationComparison } from "@/lib/open-banking/account-reconciliation";

const copy = messages.openBanking.reconciliation;

export function AccountComparison({ comparison, legacy = false }: Readonly<{ comparison: ReconciliationComparison; legacy?: boolean }>) {
  const absent = legacy ? copy.legacyMissing : copy.missing;
  return <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
    <div><dt className="text-[var(--muted)]">{copy.institution}</dt><dd><bdi>{comparison.institution}</bdi></dd></div>
    <div><dt className="text-[var(--muted)]">{copy.name}</dt><dd className="break-words"><bdi>{comparison.name}</bdi></dd></div>
    <div><dt className="text-[var(--muted)]">{copy.type}</dt><dd>{messages.openBanking.accountTypes[comparison.type]}</dd></div>
    <div><dt className="text-[var(--muted)]">{copy.currency}</dt><dd><bdi dir="ltr">{comparison.currency}</bdi></dd></div>
    <div><dt className="text-[var(--muted)]">{copy.number}</dt><dd>{comparison.maskedNumber === null ? absent : <bdi dir="ltr">{comparison.maskedNumber}</bdi>}</dd></div>
    <div><dt className="text-[var(--muted)]">{copy.branch}</dt><dd>{comparison.branchCode === null ? absent : <bdi dir="ltr">{comparison.branchCode}</bdi>}</dd></div>
    <div><dt className="text-[var(--muted)]">{copy.bank}</dt><dd>{comparison.bankCode === null ? absent : <bdi dir="ltr">{comparison.bankCode}</bdi>}</dd></div>
  </dl>;
}

function ReviewRow({ row, decide, working }: Readonly<{
  row: AccountReconciliationRow;
  decide: (row: AccountReconciliationRow, candidate: string | null, decision: AccountReconciliationCommand["decision"], confirmation: boolean) => Promise<void>;
  working: boolean;
}>) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  return <section className="rounded-3xl border border-[var(--border)] bg-white p-5 sm:p-6" aria-label={copy.legacy}>
    <h2 className="text-xl font-semibold">{copy.legacy}</h2>
    <p className="mt-2 font-semibold text-[var(--accent)]">{copy.statuses[row.status]}</p>
    <AccountComparison comparison={row.legacy} legacy />
    {row.status === "confirmed" ? <div className="mt-5 rounded-2xl border border-[var(--border)] p-4">
      <h3 className="font-semibold">{copy.confirmedAccount}</h3>
      {row.confirmedAccount === null ? null : <AccountComparison comparison={row.confirmedAccount} />}
    </div> : <>
      <fieldset className="mt-6 space-y-3" disabled={working}>
        <legend className="mb-3 font-semibold">{copy.candidates}</legend>
        {row.candidates.length === 0 ? <p>{copy.noCandidates}</p> : row.candidates.map((item, index) => <label className="block rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4" key={item.key}>
          <span className="flex items-center gap-3"><input type="radio" name={`candidate-${row.key}`} checked={candidate === item.key} onChange={() => { setCandidate(item.key); setAttested(false); }} /><span className="font-semibold">{copy.candidate} {index + 1}</span></span>
          <AccountComparison comparison={item.comparison} />
          {item.previouslyRejected ? <span className="mt-3 block text-sm text-amber-900">{copy.previouslyRejected}</span> : null}
        </label>)}
      </fieldset>
      <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input className="mt-1" type="checkbox" checked={attested} disabled={working || candidate === null} onChange={(event) => setAttested(event.target.checked)} /><span>{copy.attestation}</span></label>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="rounded-2xl bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-50" type="button" disabled={working || candidate === null || !attested} onClick={() => void decide(row, candidate, "same_account", attested)}>{copy.confirm}</button>
        <button className="rounded-2xl border border-[var(--border)] px-4 py-3 disabled:opacity-50" type="button" disabled={working || candidate === null} onClick={() => void decide(row, candidate, "not_same", false)}>{copy.reject}</button>
        <button className="rounded-2xl border border-[var(--border)] px-4 py-3 disabled:opacity-50" type="button" disabled={working} onClick={() => void decide(row, null, "cannot_determine", false)}>{copy.unknown}</button>
      </div>
    </>}
    {row.lastDecisionAt === null ? null : <p className="mt-4 text-sm">{copy.lastDecision}: <bdi dir="ltr">{new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.lastDecisionAt))}</bdi></p>}
  </section>;
}

export function AccountReconciliationCenter({ initialView = null }: Readonly<{ initialView?: AccountReconciliationView | null }>) {
  const [view, setView] = useState(initialView);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<AccountReconciliationCommand | null>(null);
  async function load() {
    const response = await fetch("/api/open-banking/reconciliation", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(userFacingErrorMessage(payload, copy.failed));
    setView(payload.review as AccountReconciliationView);
  }
  async function refresh() {
    setWorking(true); setStatus(copy.loading);
    try { await load(); setStatus(""); setPending(null); }
    catch (error) { setStatus(error instanceof Error ? error.message : copy.failed); }
    finally { setWorking(false); }
  }
  async function decide(row: AccountReconciliationRow, candidateKey: string | null, decision: AccountReconciliationCommand["decision"], confirmation: boolean) {
    setWorking(true); setStatus(copy.working);
    const command: AccountReconciliationCommand = pending !== null && pending.legacyKey === row.key && pending.reviewToken === row.reviewToken && pending.candidateKey === candidateKey && pending.decision === decision
      ? pending : { legacyKey: row.key, candidateKey, decision, confirmation, reviewToken: row.reviewToken, idempotencyKey: crypto.randomUUID() };
    setPending(command);
    try {
      const response = await fetch("/api/open-banking/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const payload = await response.json();
      if (!response.ok) throw new Error(userFacingErrorMessage(payload, copy.failed));
      await load(); setPending(null); setStatus(copy.saved);
    } catch (error) { setStatus(error instanceof Error ? error.message : copy.failed); }
    finally { setWorking(false); }
  }
  return <div className="mt-8 space-y-5" dir="rtl">
    {view !== null && view.rows.length > 0 ? <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 leading-7">{copy.gate}</p> : null}
    <button className="rounded-2xl border border-[var(--border)] px-4 py-3 disabled:opacity-50" type="button" disabled={working} onClick={() => void refresh()}>{copy.refresh}</button>
    <p role="status" aria-live="polite">{status}</p>
    {view?.rows.length === 0 ? <p>{copy.empty}</p> : view?.rows.map((row) => <ReviewRow key={`${row.key}:${row.reviewToken}`} row={row} decide={decide} working={working} />)}
  </div>;
}
