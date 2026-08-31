"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type { SerializedMoney } from "@/lib/domain/money/money";
import type { GoalCenterItemView, GoalCenterView, GoalDefinitionConfiguration } from "@/lib/goals/goal";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat(appLocale.intlLocale, { currency, style: "currency" })
    .resolvedOptions().maximumFractionDigits ?? 2;
}

function moneyMajor(value: SerializedMoney): string {
  const digits = fractionDigits(value.currency);
  const negative = value.amountMinor.startsWith("-");
  const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`}`;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return <bdi className="break-all tabular-nums" dir="ltr">{moneyMajor(value)} {value.currency}</bdi>;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function ids(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formStrings(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === "string");
}

function formString(form: FormData, name: string, fallback = ""): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : fallback;
}

function moneyInput(form: FormData, name: string, currency: string) {
  return { amount: formString(form, name, "0"), currency };
}

async function jsonRequest(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(userFacingErrorMessage(payload, messages.goalEngine.messages.requestFailed));
  }
  return payload;
}

function CheckGroup({
  defaultIds,
  label,
  name,
  options,
}: Readonly<{
  defaultIds: readonly string[];
  label: string;
  name: string;
  options: GoalCenterView["sources"]["accounts"] | GoalCenterView["categories"];
}>) {
  function optionLabel(
    option: GoalCenterView["categories"][number] | GoalCenterView["sources"]["accounts"][number],
  ): string {
    if ("systemKey" in option) {
      const key = option.systemKey;
      return option.label ?? (
        key !== null && key in messages.budgets.systemCategories
          ? messages.budgets.systemCategories[
            key as keyof typeof messages.budgets.systemCategories
          ]
          : option.id
      );
    }
    return option.label;
  }

  return (
    <fieldset className="rounded-2xl border border-[var(--border)] p-4">
      <legend className="px-2 font-semibold">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label className="flex items-start gap-2 text-sm" key={option.id}>
            <input defaultChecked={defaultIds.includes(option.id)} name={name} type="checkbox" value={option.id} />
            <span>
              {optionLabel(option)}
              {"amount" in option ? <span className="mt-1 block text-xs text-[var(--muted)]"><MoneyValue value={option.amount} /></span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ConfigurationFields({ item, view }: Readonly<{ item: GoalCenterItemView; view: GoalCenterView }>) {
  const configuration = objectValue(item.definition?.configuration);
  const fundScope = objectValue(configuration.fundScope);
  const targetBasis = objectValue(configuration.targetBasis);
  const type = item.reported.type;
  const target = objectValue(configuration.targetAmount ?? configuration.spendingCeiling ?? targetBasis.amount);
  const targetDefault = stringValue(target.amountMinor) === ""
    ? moneyMajor(item.reported.targetAmount)
    : moneyMajor({ amountMinor: stringValue(target.amountMinor), currency: stringValue(target.currency, view.currency) });

  if (type === "debt_free") {
    return <CheckGroup defaultIds={ids(configuration.liabilityIds)} label={messages.goalEngine.configuration.liabilities} name="liabilityIds" options={view.sources.liabilities} />;
  }
  if (type === "no_overdraft") {
    return <>
      <CheckGroup defaultIds={ids(configuration.accountIds)} label={messages.goalEngine.configuration.accounts} name="accountIds" options={view.sources.accounts} />
      <NumberField defaultValue={numberValue(configuration.sustainedSuccessDays, 30)} label={messages.goalEngine.configuration.sustainedDays} name="sustainedSuccessDays" />
    </>;
  }
  if (type === "no_credit_dependency") {
    return <>
      <CheckGroup defaultIds={ids(configuration.accountIds)} label={messages.goalEngine.configuration.accounts} name="accountIds" options={view.sources.accounts} />
      <CheckGroup defaultIds={ids(configuration.cardIds)} label={messages.goalEngine.configuration.cards} name="cardIds" options={view.sources.cards} />
      <CheckGroup defaultIds={ids(configuration.liabilityIds)} label={messages.goalEngine.configuration.liabilities} name="liabilityIds" options={view.sources.liabilities} />
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField defaultValue={numberValue(configuration.horizonDays, 30)} label={messages.goalEngine.configuration.horizon} name="horizonDays" />
        <NumberField defaultValue={numberValue(configuration.sustainedSuccessDays, 30)} label={messages.goalEngine.configuration.sustainedDays} name="sustainedSuccessDays" />
      </div>
    </>;
  }
  if (type === "emergency_fund") {
    const source = stringValue(fundScope.source, "savings");
    return <>
      <label className="block text-sm font-semibold">{messages.goalEngine.configuration.fundSource}
        <select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={source} name="fundSource">
          <option value="savings">{messages.goalEngine.configuration.fundSavings}</option>
          <option value="accounts">{messages.goalEngine.configuration.fundAccounts}</option>
        </select>
      </label>
      <CheckGroup defaultIds={source === "savings" ? ids(fundScope.recordIds) : []} label={messages.goalEngine.configuration.fundSavings} name="savingFundIds" options={view.sources.savings} />
      <CheckGroup defaultIds={source === "accounts" ? ids(fundScope.recordIds) : []} label={messages.goalEngine.configuration.fundAccounts} name="accountFundIds" options={view.sources.accounts} />
      <label className="block text-sm font-semibold">{messages.goalEngine.configuration.targetBasis}
        <select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={stringValue(targetBasis.kind, "explicit_amount")} name="targetBasis">
          <option value="explicit_amount">{messages.goalEngine.configuration.explicitAmount}</option>
          <option value="months_of_essential_expenses">{messages.goalEngine.configuration.months}</option>
        </select>
      </label>
      <MoneyField defaultValue={targetDefault} label={messages.goalEngine.configuration.targetAmount} name="targetAmount" />
      <NumberField defaultValue={numberValue(targetBasis.months, 3)} label={messages.goalEngine.configuration.months} name="months" />
      <CheckGroup defaultIds={ids(targetBasis.essentialCategoryIds)} label={messages.goalEngine.configuration.essentialCategories} name="categoryIds" options={view.categories} />
    </>;
  }
  if (type === "savings_target") {
    const source = stringValue(fundScope.source, "savings");
    return <>
      <label className="block text-sm font-semibold">{messages.goalEngine.configuration.fundSource}
        <select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={source} name="fundSource">
          <option value="savings">{messages.goalEngine.configuration.fundSavings}</option>
          <option value="accounts">{messages.goalEngine.configuration.fundAccounts}</option>
        </select>
      </label>
      <CheckGroup defaultIds={source === "savings" ? ids(fundScope.recordIds) : []} label={messages.goalEngine.configuration.fundSavings} name="savingFundIds" options={view.sources.savings} />
      <CheckGroup defaultIds={source === "accounts" ? ids(fundScope.recordIds) : []} label={messages.goalEngine.configuration.fundAccounts} name="accountFundIds" options={view.sources.accounts} />
      <MoneyField defaultValue={targetDefault} label={messages.goalEngine.configuration.targetAmount} name="targetAmount" />
    </>;
  }
  if (type === "monthly_spending") {
    return <>
      <CheckGroup defaultIds={ids(configuration.categoryIds)} label={messages.goalEngine.configuration.categories} name="categoryIds" options={view.categories} />
      <MoneyField defaultValue={targetDefault} label={messages.goalEngine.configuration.spendingCeiling} name="targetAmount" />
    </>;
  }
  return <>
    <label className="block text-sm font-semibold">{messages.goalEngine.configuration.manualMetric}
      <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={stringValue(configuration.metricLabel, item.reported.title)} maxLength={100} name="metricLabel" required />
    </label>
    <label className="block text-sm font-semibold">{messages.goalEngine.configuration.manualDirection}
      <select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={stringValue(configuration.direction, "increase")} name="direction">
        <option value="increase">{messages.goalEngine.configuration.increase}</option><option value="decrease">{messages.goalEngine.configuration.decrease}</option>
      </select>
    </label>
    <MoneyField defaultValue={targetDefault} label={messages.goalEngine.configuration.targetAmount} name="targetAmount" />
  </>;
}

function MoneyField({ defaultValue, label, name }: Readonly<{ defaultValue: string; label: string; name: string }>) {
  return <label className="block text-sm font-semibold">{label}<input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={defaultValue} dir="ltr" inputMode="decimal" name={name} required /></label>;
}

function NumberField({ defaultValue, label, name }: Readonly<{ defaultValue: number; label: string; name: string }>) {
  return <label className="block text-sm font-semibold">{label}<input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={defaultValue} dir="ltr" max={366} min={1} name={name} required type="number" /></label>;
}

function metricFactLabel(key: string): string {
  if (key.startsWith("account:")) return messages.goalEngine.factLabels.account;
  if (key.startsWith("fund:")) return messages.goalEngine.factLabels.fund;
  if (key.startsWith("liability:")) return messages.goalEngine.factLabels.liability;
  if (key.startsWith("manual:")) return messages.goalEngine.factLabels.manual;
  const labels = {
    credit_used: messages.goalEngine.factLabels.creditUsed,
    engine_minimum_confirmed_balance: messages.goalEngine.factLabels.engineMinimumBalance,
    engine_shortfall: messages.goalEngine.factLabels.engineShortfall,
    essential_expense_monthly_basis: messages.goalEngine.factLabels.essentialExpenseBasis,
    liability_balance: messages.goalEngine.factLabels.liabilityBalance,
    qualifying_period_spending: messages.goalEngine.factLabels.monthlySpending,
    scoped_account_balance: messages.goalEngine.factLabels.scopedAccountBalance,
  } as const;
  return key in labels ? labels[key as keyof typeof labels] : messages.goalEngine.factLabels.generic;
}

function configurationFromForm(item: GoalCenterItemView, form: FormData, currency: string): GoalDefinitionConfiguration | Record<string, unknown> {
  const type = item.reported.type;
  if (type === "debt_free") return { kind: type, liabilityIds: formStrings(form, "liabilityIds") };
  if (type === "no_overdraft") return { kind: type, accountIds: formStrings(form, "accountIds"), sustainedSuccessDays: Number(formString(form, "sustainedSuccessDays", "30")) };
  if (type === "no_credit_dependency") return {
    kind: type,
    accountIds: formStrings(form, "accountIds"),
    cardIds: formStrings(form, "cardIds"),
    horizonDays: Number(formString(form, "horizonDays", "30")),
    liabilityIds: formStrings(form, "liabilityIds"),
    sustainedSuccessDays: Number(formString(form, "sustainedSuccessDays", "30")),
  };
  if (type === "emergency_fund") {
    const source = formString(form, "fundSource", "savings") as "accounts" | "savings";
    const basis = formString(form, "targetBasis", "explicit_amount");
    return {
      kind: type,
      fundScope: { source, recordIds: formStrings(form, source === "savings" ? "savingFundIds" : "accountFundIds") },
      targetBasis: basis === "months_of_essential_expenses"
        ? { essentialCategoryIds: formStrings(form, "categoryIds"), kind: basis, months: Number(formString(form, "months", "3")) }
        : { amount: moneyInput(form, "targetAmount", currency), kind: "explicit_amount" },
    };
  }
  if (type === "savings_target") {
    const source = formString(form, "fundSource", "savings") as "accounts" | "savings";
    return { kind: type, fundScope: { source, recordIds: formStrings(form, source === "savings" ? "savingFundIds" : "accountFundIds") }, targetAmount: moneyInput(form, "targetAmount", currency) };
  }
  if (type === "monthly_spending") return { kind: type, categoryIds: formStrings(form, "categoryIds"), spendingCeiling: moneyInput(form, "targetAmount", currency) };
  return { kind: "custom", direction: formString(form, "direction", "increase"), metricLabel: formString(form, "metricLabel"), targetAmount: moneyInput(form, "targetAmount", currency) };
}

function DefinitionForm({ item, onBusy, onSaved, view, working }: Readonly<{
  item: GoalCenterItemView;
  onBusy: (value: boolean, message?: string) => void;
  onSaved: () => void;
  view: GoalCenterView;
  working: boolean;
}>) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onBusy(true);
    try {
      await jsonRequest("/api/goals/definitions", {
        configuration: configurationFromForm(item, form, view.currency),
        expectedDefinitionVersion: item.definition?.version ?? null,
        expectedGoalRecordVersion: item.reported.version,
        goalId: item.reported.id,
        idempotencyKey: crypto.randomUUID(),
        targetDate: formString(form, "targetDate") || null,
      });
      onBusy(false, messages.goalEngine.messages.definitionSaved);
      onSaved();
    } catch (error) {
      onBusy(false, error instanceof Error ? error.message : messages.goalEngine.messages.requestFailed);
    }
  }
  return <form className="mt-5 grid gap-4" onSubmit={submit}>
    <ConfigurationFields item={item} view={view} />
    <label className="block text-sm font-semibold">{messages.goalEngine.configuration.deadline}
      <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-normal" defaultValue={item.definition?.targetDate ?? item.reported.targetDate ?? ""} dir="ltr" name="targetDate" type="date" />
    </label>
    <button className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={working} type="submit">
      {working ? messages.goalEngine.actions.activating : item.definition === null ? messages.goalEngine.actions.activate : messages.goalEngine.actions.newVersion}
    </button>
  </form>;
}

function DefinitionBlock({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="rounded-2xl bg-[var(--background)] p-4">{children}</div>;
}

export function GoalCenter({ initialView }: Readonly<{ initialView: GoalCenterView }>) {
  const router = useRouter();
  const [workingGoal, setWorkingGoal] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function evaluate(item: GoalCenterItemView, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setWorkingGoal(item.reported.id);
    setMessage("");
    try {
      const manual = formString(form, "manualCurrentValue");
      await jsonRequest("/api/goals/evaluations", {
        goalId: item.reported.id,
        idempotencyKey: crypto.randomUUID(),
        ...(manual === "" ? {} : { manualCurrentValue: { amount: manual, currency: initialView.currency } }),
      });
      setMessage(messages.goalEngine.messages.evaluationSaved);
      setWorkingGoal(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.goalEngine.messages.requestFailed);
      setWorkingGoal(null);
    }
  }

  if (initialView.goals.length === 0) {
    return <p className="mt-8 rounded-3xl border border-dashed border-[var(--border)] p-8 text-[var(--muted)]">{messages.goalEngine.empty}</p>;
  }

  return <div className="mt-8 space-y-6">
    <p className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm" role="status">{message || messages.goalEngine.separation}</p>
    {initialView.goals.map((item) => {
      const progress = item.latestProgress?.result;
      const working = workingGoal === item.reported.id;
      return <article className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm sm:p-8" key={item.reported.id}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-2xl font-semibold">{item.reported.title}</h2><p className="mt-2 text-sm text-[var(--muted)]">{messages.onboarding.form.goalTypes[item.reported.type]}</p></div>
          <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-sm font-semibold">{progress === undefined ? messages.goalEngine.versioning.untracked : messages.goalEngine.statuses[progress.status]}</span>
        </div>
        <section className="mt-6">
          <h3 className="font-semibold">{messages.goalEngine.baseline.reported}</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">{messages.goalEngine.baseline.description}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.baseline.reported}</dt><dd className="mt-1 font-semibold"><MoneyValue value={item.reported.startingValue} /></dd></DefinitionBlock>
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.baseline.currentReported}</dt><dd className="mt-1 font-semibold"><MoneyValue value={item.reported.currentValue} /></dd></DefinitionBlock>
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.progress.target}</dt><dd className="mt-1 font-semibold"><MoneyValue value={item.reported.targetAmount} /></dd></DefinitionBlock>
          </dl>
        </section>
        {progress === undefined ? null : <section className="mt-6" aria-labelledby={`progress-${item.reported.id}`}>
          <h3 className="font-semibold" id={`progress-${item.reported.id}`}>{messages.goalEngine.progress.current}</h3>
          <p className="mt-2 text-sm font-semibold text-[var(--accent)]">{messages.goalEngine.verification[progress.verification]}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.baseline.verified}</dt><dd className="mt-1 font-semibold"><MoneyValue value={progress.baselineValue} /></dd></DefinitionBlock>
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.progress.current}</dt><dd className="mt-1 font-semibold"><MoneyValue value={progress.currentValue} /></dd></DefinitionBlock>
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.progress.target}</dt><dd className="mt-1 font-semibold"><MoneyValue value={progress.targetValue} /></dd></DefinitionBlock>
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.progress.gap}</dt><dd className="mt-1 font-semibold"><MoneyValue value={progress.remainingGap} /></dd></DefinitionBlock>
            <DefinitionBlock><dt className="text-xs text-[var(--muted)]">{messages.goalEngine.progress.percentage}</dt><dd className="mt-1 font-semibold"><bdi dir="ltr">{(progress.normalizedProgressBasisPoints / 100).toFixed(2)}%</bdi></dd></DefinitionBlock>
          </dl>
          <p className="mt-3 text-sm">{messages.goalEngine.progress.trend}: {messages.goalEngine.trends[progress.trend]}</p>
          {item.definition?.targetDate === null || item.definition?.targetDate === undefined ? null : <p className="mt-2 text-sm">{messages.goalEngine.progress.deadline}: <bdi dir="ltr">{item.definition.targetDate}</bdi></p>}
          {progress.completedAt === null ? null : <p className="mt-2 text-sm">{messages.goalEngine.progress.completedAt} <bdi dir="ltr">{progress.completedAt}</bdi></p>}
        </section>}
        {item.definition === null ? null : <form className="mt-6 rounded-2xl border border-[var(--border)] p-4" onSubmit={(event) => evaluate(item, event)}>
          {item.reported.type === "custom" ? <MoneyField defaultValue={moneyMajor(item.reported.currentValue)} label={messages.goalEngine.progress.current} name="manualCurrentValue" /> : null}
          <button className="mt-4 w-full rounded-xl border border-[var(--border)] px-4 py-2 font-semibold disabled:opacity-60" disabled={working} type="submit">{working ? messages.goalEngine.actions.evaluating : messages.goalEngine.actions.evaluate}</button>
        </form>}
        <details className="mt-6 rounded-2xl border border-[var(--border)] p-4">
          <summary className="cursor-pointer font-semibold">{messages.goalEngine.versioning.title}{item.definition === null ? "" : ` · v${item.definition.version}`}</summary>
          <p className="mt-3 text-sm text-[var(--muted)]">{messages.goalEngine.versioning.description}</p>
          <DefinitionForm
            item={item}
            onBusy={(value, nextMessage) => {
              setWorkingGoal(value ? item.reported.id : null);
              if (nextMessage !== undefined) setMessage(nextMessage);
            }}
            onSaved={() => router.refresh()}
            view={initialView}
            working={working}
          />
        </details>
        <details className="mt-4 rounded-2xl border border-[var(--border)] p-4">
          <summary className="cursor-pointer font-semibold">{messages.goalEngine.history.title} · {item.history.length}</summary>
          {item.history.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{messages.goalEngine.history.empty}</p> : <ol className="mt-4 space-y-3">
            {item.history.map((entry) => <li className="rounded-xl bg-[var(--background)] p-4 text-sm" key={entry.id}>
              <p className="font-semibold">{messages.goalEngine.statuses[entry.result.status]} · <bdi dir="ltr">{(entry.result.normalizedProgressBasisPoints / 100).toFixed(2)}%</bdi></p>
              <p className="mt-1 text-[var(--muted)]">{messages.goalEngine.history.evaluatedAt}: <bdi dir="ltr">{entry.evaluatedAt}</bdi> · {messages.goalEngine.history.version}: <bdi dir="ltr">{entry.goalVersion}</bdi></p>
              <p className="mt-1">{messages.goalEngine.history.reason}: {messages.goalEngine.reasons[entry.reason]}</p>
              {entry.milestonesCrossed.length === 0 ? null : <p className="mt-1">{messages.goalEngine.history.milestones}: <bdi dir="ltr">{entry.milestonesCrossed.map((value) => `${value / 100}%`).join(", ")}</bdi></p>}
              <details className="mt-3 rounded-lg border border-[var(--border)] p-3">
                <summary className="cursor-pointer font-semibold">{messages.goalEngine.history.metricInputs}</summary>
                <ul className="mt-2 space-y-1">
                  {entry.metricFacts.map((fact) => <li key={fact.key}>{metricFactLabel(fact.key)}: <MoneyValue value={fact.value} /></li>)}
                </ul>
              </details>
              <details className="mt-2 rounded-lg border border-[var(--border)] p-3">
                <summary className="cursor-pointer font-semibold">{messages.goalEngine.history.sources}</summary>
                <ul className="mt-2 space-y-1">
                  {entry.sourceReferences.map((source) => <li key={`${source.kind}:${source.id}`}>{messages.goalEngine.sourceKinds[source.kind]} · <bdi dir="ltr">{source.id}{source.version === null ? "" : ` · v${source.version}`}</bdi></li>)}
                </ul>
              </details>
            </li>)}
          </ol>}
        </details>
      </article>;
    })}
  </div>;
}
