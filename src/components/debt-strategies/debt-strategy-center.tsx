"use client";

import { useMemo, useState } from "react";

import type { DebtStrategyCenterView, DebtStrategyComparisonView } from "@/lib/debt-strategies/debt-strategy";
import type { SerializedMoney } from "@/lib/domain/money/money";
import { messages, userFacingErrorMessage } from "@/lib/i18n";

type Provenance = "assumption" | "contract" | "user_reported";
type LoanForm = {
  accrualConvention: "actual_360" | "actual_365" | "monthly_compounded";
  feesKnown: boolean;
  firstPaymentDate: string;
  minimumAmount: string;
  prepayment: "free" | "unknown";
  provenance: Provenance;
  ratePercent: string;
  selected: boolean;
};

function major(value: SerializedMoney): string {
  const digits = new Intl.NumberFormat("he-IL", {
    currency: value.currency,
    style: "currency",
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = value.amountMinor.startsWith("-");
  const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`}`;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return <bdi className="tabular-nums" dir="ltr">{major(value)} {value.currency}</bdi>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST" });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(userFacingErrorMessage(payload, messages.debtStrategies.failure));
  return payload as T;
}

function Comparison({ comparison }: Readonly<{ comparison: DebtStrategyComparisonView }>) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-6" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">{messages.debtStrategies.results.title}</h2>
        <span className="rounded-full bg-[var(--background)] px-4 py-2 font-semibold">
          {messages.debtStrategies.completeness[comparison.calculationCompleteness]}
        </span>
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">{messages.debtStrategies.results.disclosure}</p>
      <p className="mt-3 font-semibold">{messages.debtStrategies.results.requiredMonthly}: <MoneyValue value={comparison.requiredMonthlyPayment} /></p>
      {comparison.assessments.some((item) => item.reasons.length > 0) ? (
        <ul className="mt-4 list-disc ps-6 text-sm text-amber-800">
          {comparison.assessments.flatMap((item) => item.reasons.map((reason) => (
            <li key={`${item.debtId}-${reason}`}>{messages.debtStrategies.reasons[reason]}</li>
          )))}
        </ul>
      ) : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {comparison.results.map((result) => (
          <article className="rounded-2xl border border-[var(--border)] p-5" key={result.strategy}>
            <h3 className="text-lg font-semibold">{messages.debtStrategies.strategies[result.strategy]}</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-[var(--muted)]">{messages.debtStrategies.results.payoffDate}</dt><dd><bdi dir="ltr">{result.payoffDate ?? "—"}</bdi></dd></div>
              <div><dt className="text-[var(--muted)]">{messages.debtStrategies.results.totalRepayment}</dt><dd className="font-semibold"><MoneyValue value={result.totalRepayment} /></dd></div>
              <div><dt className="text-[var(--muted)]">{messages.debtStrategies.results.interest}</dt><dd><MoneyValue value={result.totalInterest} /></dd></div>
              <div><dt className="text-[var(--muted)]">{messages.debtStrategies.results.fees}</dt><dd><MoneyValue value={result.totalKnownFees} /></dd></div>
              <div><dt className="text-[var(--muted)]">{messages.debtStrategies.results.timeSaved}</dt><dd>{result.timeSavedDaysVersusBaseline ?? "—"}</dd></div>
            </dl>
            {!result.costComparable ? <p className="mt-3 text-sm font-semibold text-amber-800">{messages.debtStrategies.results.notCostComparable}</p> : null}
            {!result.payoffReached ? <p className="mt-3 text-sm font-semibold text-amber-800">{messages.debtStrategies.results.notReached}</p> : null}
          </article>
        ))}
      </div>
      <p className="mt-5 text-xs text-[var(--muted)]"><bdi dir="ltr">{comparison.engineVersion} · {comparison.policyVersion}</bdi></p>
    </section>
  );
}

export function DebtStrategyCenter({ initialView }: Readonly<{ initialView: DebtStrategyCenterView }>) {
  const [forms, setForms] = useState<Record<string, LoanForm>>(() => Object.fromEntries(initialView.loans.map((loan) => [loan.id, {
    accrualConvention: "monthly_compounded",
    feesKnown: true,
    firstPaymentDate: loan.nextPaymentDate < initialView.evaluationDate ? initialView.evaluationDate : loan.nextPaymentDate,
    minimumAmount: major(loan.monthlyPayment),
    prepayment: "unknown",
    provenance: "user_reported",
    ratePercent: (loan.reportedAnnualInterestRateBps / 100).toFixed(2),
    selected: false,
  }])));
  const [extraPayment, setExtraPayment] = useState("0.00");
  const [extraStartDate, setExtraStartDate] = useState(initialView.evaluationDate);
  const [name, setName] = useState("");
  const [comparison, setComparison] = useState<DebtStrategyComparisonView | null>(null);
  const [saved, setSaved] = useState(initialView.saved);
  const [busy, setBusy] = useState<"evaluate" | "save" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedLoans = useMemo(() => initialView.loans.filter((loan) => forms[loan.id]?.selected), [forms, initialView.loans]);

  function update(id: string, patch: Partial<LoanForm>) {
    setForms((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
  }

  function command() {
    const customPriority = selectedLoans.map((loan) => loan.id);
    return {
      customPriority,
      debtTerms: selectedLoans.map((loan) => {
        const form = forms[loan.id]!;
        const provenance = { kind: form.provenance, note: null };
        return {
          allocationOrder: { order: ["fees", "interest", "principal"], provenance },
          fees: [],
          feesKnown: form.feesKnown,
          feesProvenance: form.feesKnown ? provenance : null,
          firstPaymentDate: form.firstPaymentDate,
          interest: {
            accrualConvention: form.accrualConvention,
            kind: "fixed_rate",
            rateApplication: "payment_date",
            rates: [{ annualRateBps: Math.round(Number(form.ratePercent) * 100), effectiveDate: initialView.evaluationDate, provenance }],
          },
          loanId: loan.id,
          minimumPayment: { amount: { amount: form.minimumAmount, currency: loan.remainingBalance.currency }, kind: "fixed", provenance },
          prepayment: form.prepayment === "free" ? { kind: "free", provenance } : { kind: "unknown" },
        };
      }),
      extraPayment: { amount: extraPayment, currency: selectedLoans[0]?.remainingBalance.currency ?? initialView.currency },
      extraPaymentStartDate: extraStartDate,
    };
  }

  async function evaluate() {
    setBusy("evaluate"); setError(""); setMessage("");
    try {
      const response = await postJson<{ comparison: DebtStrategyComparisonView }>("/api/debt-strategies/evaluate", command());
      setComparison(response.comparison);
      setMessage(messages.debtStrategies.messages.evaluated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : messages.debtStrategies.failure); }
    finally { setBusy(null); }
  }

  async function saveScenario() {
    setBusy("save"); setError(""); setMessage("");
    try {
      const response = await postJson<{ scenario: DebtStrategyCenterView["saved"][number] }>("/api/debt-strategies", {
        ...command(), idempotencyKey: crypto.randomUUID(), name: name.trim() || null, note: null,
      });
      setSaved((current) => [response.scenario, ...current]);
      setComparison(response.scenario.comparison);
      setMessage(messages.debtStrategies.messages.saved);
    } catch (caught) { setError(caught instanceof Error ? caught.message : messages.debtStrategies.failure); }
    finally { setBusy(null); }
  }

  return (
    <div className="mt-10 space-y-8">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-semibold">{messages.debtStrategies.form.title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{messages.debtStrategies.form.contractWarning}</p>
        <p className="mt-2 text-sm font-semibold text-[var(--muted)]">{messages.debtStrategies.separation}</p>
        {initialView.loans.length === 0 ? <p className="mt-5">{messages.debtStrategies.empty}</p> : (
          <div className="mt-6 space-y-5">
            {initialView.loans.map((loan) => {
              const form = forms[loan.id]!;
              return (
                <fieldset className="rounded-2xl border border-[var(--border)] p-5" key={loan.id}>
                  <label className="flex items-center gap-3 font-semibold"><input checked={form.selected} onChange={(event) => update(loan.id, { selected: event.target.checked })} type="checkbox" />{loan.label} · <MoneyValue value={loan.remainingBalance} /></label>
                  {form.selected ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      <label>{messages.debtStrategies.form.firstPayment}<input className="mt-2 w-full rounded-xl border p-3" dir="ltr" min={initialView.evaluationDate} onChange={(event) => update(loan.id, { firstPaymentDate: event.target.value })} type="date" value={form.firstPaymentDate} /></label>
                      <label>{messages.debtStrategies.form.rate}<input className="mt-2 w-full rounded-xl border p-3" dir="ltr" min="-1000" onChange={(event) => update(loan.id, { ratePercent: event.target.value })} step="0.01" type="number" value={form.ratePercent} /></label>
                      <label>{messages.debtStrategies.form.minimum}<input className="mt-2 w-full rounded-xl border p-3" dir="ltr" min="0.01" onChange={(event) => update(loan.id, { minimumAmount: event.target.value })} step="0.01" type="number" value={form.minimumAmount} /></label>
                      <label>{messages.debtStrategies.form.provenance}<select className="mt-2 w-full rounded-xl border p-3" onChange={(event) => update(loan.id, { provenance: event.target.value as Provenance })} value={form.provenance}><option value="contract">{messages.debtStrategies.provenance.contract}</option><option value="user_reported">{messages.debtStrategies.provenance.user_reported}</option><option value="assumption">{messages.debtStrategies.provenance.assumption}</option></select></label>
                      <label>{messages.debtStrategies.form.accrual}<select className="mt-2 w-full rounded-xl border p-3" onChange={(event) => update(loan.id, { accrualConvention: event.target.value as LoanForm["accrualConvention"] })} value={form.accrualConvention}><option value="monthly_compounded">{messages.debtStrategies.accrual.monthly_compounded}</option><option value="actual_365">{messages.debtStrategies.accrual.actual_365}</option><option value="actual_360">{messages.debtStrategies.accrual.actual_360}</option></select></label>
                      <label>{messages.debtStrategies.form.prepayment}<select className="mt-2 w-full rounded-xl border p-3" onChange={(event) => update(loan.id, { prepayment: event.target.value as LoanForm["prepayment"] })} value={form.prepayment}><option value="unknown">{messages.debtStrategies.prepayment.unknown}</option><option value="free">{messages.debtStrategies.prepayment.free}</option></select></label>
                      <label className="flex items-center gap-3"><input checked={form.feesKnown} onChange={(event) => update(loan.id, { feesKnown: event.target.checked })} type="checkbox" />{messages.debtStrategies.form.feesKnown}</label>
                    </div>
                  ) : null}
                </fieldset>
              );
            })}
          </div>
        )}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label>{messages.debtStrategies.form.extraPayment}<input className="mt-2 w-full rounded-xl border p-3" dir="ltr" min="0" onChange={(event) => setExtraPayment(event.target.value)} step="0.01" type="number" value={extraPayment} /></label>
          <label>{messages.debtStrategies.form.extraStart}<input className="mt-2 w-full rounded-xl border p-3" dir="ltr" min={initialView.evaluationDate} onChange={(event) => setExtraStartDate(event.target.value)} type="date" value={extraStartDate} /></label>
          <label>{messages.debtStrategies.form.name}<input className="mt-2 w-full rounded-xl border p-3" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /></label>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="rounded-full bg-[var(--foreground)] px-6 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null || selectedLoans.length === 0} onClick={evaluate} type="button">{busy === "evaluate" ? messages.debtStrategies.actions.evaluating : messages.debtStrategies.actions.evaluate}</button>
          <button className="rounded-full border border-[var(--border)] px-6 py-3 font-semibold disabled:opacity-50" disabled={busy !== null || selectedLoans.length === 0} onClick={saveScenario} type="button">{busy === "save" ? messages.debtStrategies.actions.saving : messages.debtStrategies.actions.save}</button>
        </div>
        {message ? <p className="mt-4 font-semibold text-emerald-700" role="status">{message}</p> : null}
        {error ? <p className="mt-4 font-semibold text-red-700" role="alert">{error}</p> : null}
      </section>
      {comparison === null ? null : <Comparison comparison={comparison} />}
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-semibold">{messages.debtStrategies.saved.title}</h2>
        {saved.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.debtStrategies.saved.empty}</p> : <ul className="mt-5 space-y-3">{saved.map((scenario) => <li className="rounded-2xl bg-[var(--background)] p-4" key={scenario.id}><p className="font-semibold">{scenario.name ?? messages.debtStrategies.saved.unnamed}</p><p className="mt-1 text-sm text-[var(--muted)]"><bdi dir="ltr">{scenario.createdAt}</bdi> · {messages.debtStrategies.completeness[scenario.comparison.calculationCompleteness]}</p><p className="mt-2 text-sm">{messages.debtStrategies.saved.hypothetical}</p></li>)}</ul>}
      </section>
    </div>
  );
}
