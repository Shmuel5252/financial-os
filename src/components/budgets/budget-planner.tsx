"use client";

import { useMemo, useState, type FormEvent } from "react";

import type {
  BudgetCategoryView,
  BudgetScenarioView,
  BudgetView,
  SystemBudgetCategoryKey,
} from "@/lib/budgets/budget";
import type { SerializedMoney } from "@/lib/domain/money/money";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";

type ViewResponse = Readonly<{ view: BudgetView }>;
type ScenarioResponse = Readonly<{ scenario: BudgetScenarioView }>;

const scenarioFieldLabels = {
  additionalExpense: messages.budgets.scenario.additionalExpense,
  additionalIncome: messages.budgets.scenario.additionalIncome,
  expenseReduction: messages.budgets.scenario.expenseReduction,
  investmentProceeds: messages.budgets.scenario.investmentProceeds,
  targetBalance: messages.budgets.scenario.target,
  uncertainIncome: messages.budgets.scenario.uncertainIncome,
} as const;

function fractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat(appLocale.intlLocale, {
      currency,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function moneyMajor(value: SerializedMoney): string {
  const digits = fractionDigits(value.currency);
  const negative = value.amountMinor.startsWith("-");
  const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${
    digits === 0
      ? padded
      : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
  }`;
}

function formatMoney(value: SerializedMoney): string {
  return `${moneyMajor(value)} ${value.currency}`;
}

function categoryLabel(category: BudgetCategoryView): string {
  if (category.label !== null) {
    return category.label;
  }
  if (category.systemKey !== null) {
    return messages.budgets.systemCategories[
      category.systemKey as SystemBudgetCategoryKey
    ];
  }
  return category.categoryId;
}

function inputValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function jsonRequest(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      userFacingErrorMessage(payload, messages.budgets.messages.requestFailed),
    );
  }
  return payload;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return (
    <bdi className="break-all tabular-nums" dir="ltr">
      {formatMoney(value)}
    </bdi>
  );
}

export function BudgetPlanner({ initialView }: Readonly<{ initialView: BudgetView }>) {
  const [view, setView] = useState(initialView);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [scenario, setScenario] = useState<BudgetScenarioView | null>(null);
  const initialAllocations = useMemo(
    () =>
      Object.fromEntries(
        initialView.categories.map((category) => {
          const allocation = initialView.period.allocations.find(
            (item) => item.categoryId === category.categoryId,
          );
          return [
            category.categoryId,
            allocation === undefined ? "0" : moneyMajor(allocation.amount),
          ];
        }),
      ),
    [initialView],
  );
  const [allocations, setAllocations] = useState(initialAllocations);
  const calculationByCategory = new Map(
    view.calculation.lines.map((line) => [line.categoryId, line]),
  );
  const isClosed = view.period.status === "closed";
  const isDeficit = BigInt(view.calculation.unallocated.amountMinor) < 0n;

  async function saveAllocations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setMessage("");
    try {
      const payload = (await jsonRequest("/api/budgets/periods", "PUT", {
        allocations: view.categories.map((category) => ({
          amount: {
            amount: allocations[category.categoryId] ?? "0",
            currency: view.period.currency,
          },
          categoryId: category.categoryId,
        })),
        calendarMonth: view.period.calendarMonth,
        expectedVersion: view.period.version,
      })) as ViewResponse;
      setView(payload.view);
      setMessage(messages.budgets.messages.periodSaved);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.budgets.messages.requestFailed,
      );
    } finally {
      setWorking(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setWorking(true);
    setMessage("");
    try {
      await jsonRequest("/api/budgets/categories", "POST", {
        idempotencyKey: crypto.randomUUID(),
        label: inputValue(new FormData(form), "label"),
        rolloverPolicy: inputValue(new FormData(form), "rolloverPolicy"),
      });
      setMessage(messages.budgets.messages.categoryCreated);
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.budgets.messages.requestFailed,
      );
      setWorking(false);
    }
  }

  async function updateCategory(
    event: FormEvent<HTMLFormElement>,
    category: BudgetCategoryView,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setWorking(true);
    setMessage("");
    try {
      await jsonRequest("/api/budgets/categories", "PUT", {
        categoryId: category.categoryId,
        expectedVersion: category.version,
        hidden: formData.get("hidden") === "on",
        label: inputValue(formData, "label"),
        rolloverPolicy: inputValue(formData, "rolloverPolicy"),
        sortOrder: Number.parseInt(inputValue(formData, "sortOrder"), 10),
      });
      setMessage(messages.budgets.messages.categoryUpdated);
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.budgets.messages.requestFailed,
      );
      setWorking(false);
    }
  }

  async function closePeriod() {
    if (view.period.version === null) {
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      const payload = (await jsonRequest("/api/budgets/periods", "POST", {
        calendarMonth: view.period.calendarMonth,
        expectedVersion: view.period.version,
      })) as ViewResponse;
      setView(payload.view);
      setMessage(messages.budgets.messages.periodClosed);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.budgets.messages.requestFailed,
      );
    } finally {
      setWorking(false);
    }
  }

  async function correctCategory(
    event: FormEvent<HTMLFormElement>,
    transactionId: string,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setWorking(true);
    setMessage("");
    try {
      await jsonRequest("/api/budgets/corrections", "POST", {
        idempotencyKey: crypto.randomUUID(),
        reason: inputValue(formData, "reason"),
        toCategoryId: inputValue(formData, "toCategoryId"),
        transactionId,
      });
      setMessage(messages.budgets.messages.correctionSaved);
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.budgets.messages.requestFailed,
      );
      setWorking(false);
    }
  }

  async function runScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const amount = (name: string) => ({
      amount: inputValue(formData, name) || "0",
      currency: view.period.currency,
    });
    setWorking(true);
    setMessage("");
    try {
      const target = inputValue(formData, "targetBalance");
      const payload = (await jsonRequest("/api/budgets/scenarios", "POST", {
        additionalExpense: amount("additionalExpense"),
        additionalIncome: amount("additionalIncome"),
        expenseReduction: amount("expenseReduction"),
        investmentProceeds: amount("investmentProceeds"),
        targetBalance: target === "" ? null : amount("targetBalance"),
        uncertainIncome: amount("uncertainIncome"),
      })) as ScenarioResponse;
      setScenario(payload.scenario);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.budgets.messages.requestFailed,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-10 space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label={messages.budgets.summary.confirmedIncome} value={view.calculation.confirmedIncome} />
        <Summary label={messages.budgets.summary.allocated} value={view.calculation.allocated} />
        <article className={`rounded-3xl border p-5 ${isDeficit ? "border-red-300 bg-red-50" : "border-[var(--border)] bg-white"}`}>
          <p className="text-sm text-[var(--muted)]">{messages.budgets.summary.unallocated}</p>
          <p className={`mt-2 text-2xl font-semibold ${isDeficit ? "text-red-800" : ""}`}><MoneyValue value={view.calculation.unallocated} /></p>
          {isDeficit ? <p className="mt-2 text-sm font-semibold text-red-800">{messages.budgets.summary.deficit}</p> : null}
        </article>
        <Summary label={messages.budgets.summary.uncertainIncome} value={view.calculation.uncertainIncome} />
        <Summary label={messages.budgets.summary.totalSpent} value={view.calculation.totalSpent} />
        <Summary label={messages.budgets.summary.totalForecastSpent} value={view.calculation.totalForecastSpent} />
        <Summary label={messages.budgets.summary.uncategorized} value={view.calculation.uncategorizedSpent} />
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">{messages.budgets.categories.title}</h2>
          <p className="rounded-full bg-[var(--background)] px-4 py-2 text-sm font-semibold">
            {isClosed ? messages.budgets.status.closed : messages.budgets.status.open}
          </p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={saveAllocations}>
          <ul className="space-y-4">
            {view.categories.map((category) => {
              const line = calculationByCategory.get(category.categoryId);
              if (line === undefined) return null;
              return (
                <li className={`rounded-2xl border border-[var(--border)] p-4 ${category.hidden ? "opacity-70" : ""}`} key={category.categoryId}>
                  <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_2fr] lg:items-end">
                    <div>
                      <p className="font-semibold">{categoryLabel(category)}</p>
                    </div>
                    <label className="text-sm font-semibold">
                      {messages.budgets.categories.allocation} (<bdi dir="ltr">{view.period.currency}</bdi>)
                      <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" dir="ltr" disabled={isClosed || working} inputMode="decimal" onChange={(event) => setAllocations((current) => ({...current, [category.categoryId]: event.target.value}))} value={allocations[category.categoryId] ?? "0"} />
                    </label>
                    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <Metric label={messages.budgets.categories.carryIn} value={line.carryIn} />
                      <Metric label={messages.budgets.categories.spent} value={line.spent} />
                      <Metric label={messages.budgets.categories.remaining} value={line.remaining} />
                      <Metric label={messages.budgets.categories.forecastRemaining} value={line.forecastRemaining} />
                    </dl>
                  </div>
                </li>
              );
            })}
          </ul>
          <button className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={isClosed || working} type="submit">{working ? messages.budgets.actions.saving : messages.budgets.actions.saveAllocations}</button>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <form className="rounded-3xl border border-[var(--border)] bg-white p-6" onSubmit={createCategory}>
          <h2 className="text-xl font-semibold">{messages.budgets.categories.customTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{messages.budgets.categories.customDescription}</p>
          <label className="mt-4 block text-sm font-semibold">{messages.budgets.categories.label}<input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" maxLength={80} name="label" required /></label>
          <label className="mt-4 block text-sm font-semibold">{messages.budgets.categories.carryPolicy}<select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" name="rolloverPolicy"><option value="reset">{messages.budgets.categories.reset}</option><option value="carry">{messages.budgets.categories.rollover}</option></select></label>
          <button className="mt-5 w-full rounded-2xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:opacity-60" disabled={working} type="submit">{messages.budgets.actions.createCategory}</button>
        </form>
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-semibold">{messages.budgets.close.title}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{messages.budgets.close.description}</p>
          <button className="mt-5 w-full rounded-2xl border border-[var(--border)] px-5 py-3 font-semibold disabled:opacity-50" disabled={working || isClosed || view.period.version === null || view.period.calendarMonth >= view.currentCalendarMonth} onClick={() => void closePeriod()} type="button">{working ? messages.budgets.actions.closing : messages.budgets.actions.close}</button>
        </section>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">{messages.budgets.corrections.title}</h2>
        {view.activities.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.budgets.corrections.empty}</p> : <ul className="mt-5 space-y-4">{view.activities.map((activity) => <li className="rounded-2xl bg-[var(--background)] p-4" key={activity.id}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{activity.merchant ?? activity.date}</p><p className="text-sm text-[var(--muted)]"><bdi dir="ltr">{activity.date}</bdi> · {messages.budgets.corrections.count(activity.correctionCount)}</p></div><MoneyValue value={activity.amount} /></div><form className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={(event) => void correctCategory(event, activity.id)}><label className="text-sm font-semibold">{messages.budgets.corrections.category}<select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={activity.categoryId ?? ""} name="toCategoryId" required><option disabled value="">—</option>{view.categories.filter((category) => !category.hidden).map((category) => <option key={category.categoryId} value={category.categoryId}>{categoryLabel(category)}</option>)}</select></label><label className="text-sm font-semibold">{messages.budgets.corrections.reason}<input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" maxLength={300} minLength={3} name="reason" required /></label><button className="rounded-xl border border-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent)] disabled:opacity-60" disabled={working} type="submit">{messages.budgets.corrections.save}</button></form></li>)}</ul>}
      </section>

      <section className="rounded-3xl border-2 border-dashed border-[var(--accent)] bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">{messages.budgets.scenario.title}</h2>
        <p className="mt-2 max-w-3xl leading-7 text-[var(--muted)]">{messages.budgets.scenario.description}</p>
        {view.coreForecast === null ? <p className="mt-4 font-semibold text-amber-800">{messages.budgets.summary.coreForecastMissing}</p> : <p className="mt-4 text-sm">{messages.budgets.summary.coreForecast}: <MoneyValue value={view.coreForecast.safeToSpend} /> · {messages.budgets.summary.forecastThrough} <bdi dir="ltr">{view.coreForecast.evaluationEndDate}</bdi></p>}
        <form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={runScenario}>{(["additionalIncome","uncertainIncome","expenseReduction","investmentProceeds","additionalExpense","targetBalance"] as const).map((name) => <label className="text-sm font-semibold" key={name}>{scenarioFieldLabels[name]} (<bdi dir="ltr">{view.period.currency}</bdi>)<input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={name === "targetBalance" ? "" : "0"} dir="ltr" inputMode="decimal" name={name} /></label>)}<button className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60 sm:col-span-2 lg:col-span-3" disabled={working || view.coreForecast === null} type="submit">{working ? messages.budgets.actions.runningScenario : messages.budgets.actions.runScenario}</button></form>
        {scenario === null ? null : <dl aria-live="polite" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Metric label={messages.budgets.scenario.base} value={scenario.baseConfirmedPosition} /><Metric label={messages.budgets.scenario.difference} value={scenario.delta} /><Metric label={messages.budgets.scenario.result} value={scenario.scenarioPosition} /><Metric label={messages.budgets.scenario.gap} value={scenario.gapToTarget} /><Metric label={messages.budgets.scenario.neededIncome} value={scenario.additionalIncomeNeededToTarget} /><Metric label={messages.budgets.scenario.neededReduction} value={scenario.spendingReductionNeededToTarget} /></dl>}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-semibold">{messages.budgets.categories.carryPolicy}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{view.categories.map((category) => <form className="rounded-2xl bg-[var(--background)] p-4" key={category.categoryId} onSubmit={(event) => void updateCategory(event, category)}><label className="block text-sm font-semibold">{messages.budgets.categories.label}<input className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 font-normal" defaultValue={categoryLabel(category)} maxLength={80} name="label" required /></label><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">{messages.budgets.categories.carryPolicy}<select className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 font-normal" defaultValue={category.rolloverPolicy} name="rolloverPolicy"><option value="reset">{messages.budgets.categories.reset}</option><option value="carry">{messages.budgets.categories.rollover}</option></select></label><label className="text-sm font-semibold">{messages.budgets.categories.sortOrder}<input className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 font-normal" defaultValue={category.sortOrder} dir="ltr" max={10000} min={0} name="sortOrder" required type="number" /></label></div><label className="mt-3 flex items-center gap-2 text-sm"><input defaultChecked={category.hidden} name="hidden" type="checkbox" />{messages.budgets.categories.hidden}</label><button className="mt-4 w-full rounded-xl border border-[var(--border)] px-4 py-2 font-semibold disabled:opacity-60" disabled={working} type="submit">{messages.budgets.actions.saveCategory}</button></form>)}</div>
      </section>
      <p aria-live="polite" className="text-sm font-semibold text-[var(--muted)]">{message}</p>
    </div>
  );
}

function Summary({ label, value }: Readonly<{ label: string; value: SerializedMoney }>) {
  return <article className="rounded-3xl border border-[var(--border)] bg-white p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-semibold"><MoneyValue value={value} /></p></article>;
}

function Metric({ label, value }: Readonly<{ label: string; value: SerializedMoney }>) {
  return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 font-semibold"><MoneyValue value={value} /></dd></div>;
}
