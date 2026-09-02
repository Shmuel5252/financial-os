import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardRefresh } from "@/components/dashboard/dashboard-refresh";
import { TimelinePanel } from "@/components/dashboard/timeline-panel";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import type {
  DashboardAlertCode,
  DashboardFreshnessReason,
  DashboardReadyView,
} from "@/lib/dashboard/dashboard";
import { loadDashboard } from "@/lib/dashboard/dashboard-service";
import type { SerializedMoney } from "@/lib/domain/money/money";
import { appLocale, messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

function formatMoney(amount: SerializedMoney): string {
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

function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(appLocale.intlLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12)));
}

function formatInstant(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(appLocale.intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function absoluteMoney(amount: SerializedMoney): SerializedMoney {
  return {
    ...amount,
    amountMinor: amount.amountMinor.startsWith("-")
      ? amount.amountMinor.slice(1)
      : amount.amountMinor,
  };
}

function creditUtilization(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const padded = value.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}%`;
}

const freshnessText: Readonly<Record<DashboardFreshnessReason, string>> = {
  manifest_unavailable: messages.dashboard.freshness.manifest_unavailable,
  new_calendar_day: messages.dashboard.freshness.new_calendar_day,
  profile_changed: messages.dashboard.freshness.profile_changed,
  source_changed: messages.dashboard.freshness.source_changed,
};

const alertText: Readonly<
  Record<
    DashboardAlertCode,
    Readonly<{ description: string; title: string }>
  >
> = {
  high_credit_utilization: messages.dashboard.alerts.high_credit_utilization,
  no_safe_to_spend: messages.dashboard.alerts.no_safe_to_spend,
  projected_shortfall: messages.dashboard.alerts.projected_shortfall,
  uncertain_income: messages.dashboard.alerts.uncertain_income,
};

function changeText(change: NonNullable<DashboardReadyView["change"]>): ReactNode {
  if (change.direction === "same") {
    return messages.dashboard.change.same;
  }
  const amount = formatMoney(absoluteMoney(change.amount));
  return (
    <>
      {change.direction === "up"
        ? messages.dashboard.change.up
        : messages.dashboard.change.down}{" "}
      <bdi dir="ltr">{amount}</bdi>{" "}
      {messages.dashboard.change.fromPrevious}
    </>
  );
}

function limitingText(view: DashboardReadyView): ReactNode {
  if (view.limitingPoint.kind === "current_liquidity") {
    return messages.dashboard.limiting.current_liquidity;
  }
  if (view.limitingPoint.kind === "margin_boundary") {
    return messages.dashboard.limiting.margin_boundary;
  }

  return (
    <>
      {messages.dashboard.limiting.eventBefore(
        messages.dashboard.eventKinds[view.limitingPoint.kind],
      )}{" "}
      <bdi dir="ltr">
        {formatCalendarDate(view.limitingPoint.calendarDate)}
      </bdi>{" "}
      {messages.dashboard.limiting.eventAfter}
    </>
  );
}

export default async function DashboardPage() {
  if (!getConfigurationStatus().authentication.ready) {
    redirect("/sign-in");
  }
  const session = await auth();
  if (session?.user?.id === undefined) {
    redirect("/sign-in");
  }
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") {
    redirect("/onboarding/review");
  }
  const dashboard = await loadDashboard(actor);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <HomeLink />
        <nav className="flex flex-wrap gap-4" aria-label={messages.dashboard.title}>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/copilot">
            {messages.navigation.copilot}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/purchase-simulation">
            {messages.navigation.purchaseSimulation}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/forecasts">
            {messages.navigation.forecasts}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/debt-strategies">
            {messages.navigation.debtStrategies}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/goals">
            {messages.navigation.goals}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/budgets">
            {messages.navigation.budgets}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/financial-data">
            {messages.dashboard.actions.financialData}
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">
        {messages.dashboard.eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
        {messages.dashboard.title}
      </h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">
        {messages.dashboard.description}
      </p>

      {dashboard.kind === "empty" ? (
        <section className="mt-10 rounded-3xl border border-[var(--border)] bg-white p-7 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-10">
          <h2 className="text-2xl font-semibold">
            {messages.dashboard.empty.title}
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">
            {messages.dashboard.empty.description}
          </p>
          <div className="mt-6">
            <DashboardRefresh hasSnapshot={false} />
          </div>
        </section>
      ) : (
        <div className="mt-10 space-y-6">
          <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
            <div className="rounded-3xl bg-[var(--foreground)] p-7 text-white shadow-[0_24px_70px_rgba(18,35,28,0.14)] sm:p-10">
              <p className="text-sm font-semibold text-emerald-200">
                {messages.dashboard.safeToSpend.label}
              </p>
              <bdi className="mt-4 block break-all text-4xl font-semibold tracking-[-0.04em] sm:text-6xl" dir="ltr">
                {formatMoney(dashboard.safeToSpend)}
              </bdi>
              {dashboard.change === null ? null : (
                <p className="mt-4 text-sm text-emerald-100">
                  {changeText(dashboard.change)}
                </p>
              )}
              <div className="mt-8 grid gap-3 border-t border-white/15 pt-6 sm:grid-cols-2">
                <p className="text-sm text-emerald-100">
                  {messages.dashboard.safeToSpend.margin}{" "}
                  <bdi className="font-semibold text-white" dir="ltr">
                    {formatMoney(dashboard.safetyMargin)}
                  </bdi>
                </p>
                <p className="text-sm text-emerald-100">
                  {messages.dashboard.safeToSpend.shortfall}{" "}
                  <bdi className="font-semibold text-white" dir="ltr">
                    {formatMoney(dashboard.summary.shortfall)}
                  </bdi>
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-white p-7">
              <h2 className="text-xl font-semibold">
                {messages.dashboard.freshness.title}
              </h2>
              {dashboard.stale ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                  <p className="font-semibold">
                    {messages.dashboard.freshness.staleTitle}
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                    {dashboard.freshnessReasons.map((reason) => (
                      <li key={reason}>{freshnessText[reason]}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                  {messages.dashboard.freshness.current}
                </p>
              )}
              <p className="mt-4 text-sm text-[var(--muted)]">
                {messages.dashboard.snapshot.calculatedAt}{" "}
                <bdi dir="ltr">
                  {formatInstant(dashboard.calculatedAt, dashboard.timeZone)}
                </bdi>
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {messages.dashboard.snapshot.horizon(dashboard.horizonDays)}
                {" · "}
                {messages.dashboard.snapshot.through}{" "}
                <bdi dir="ltr">
                  {formatCalendarDate(dashboard.horizonEndDate)}
                </bdi>
              </p>
              <div className="mt-5">
                <DashboardRefresh hasSnapshot />
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">
              {messages.dashboard.limiting.title}
            </h2>
            <p className="mt-3 leading-7 text-[var(--muted)]">
              {limitingText(dashboard)}
            </p>
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">
              {messages.dashboard.summary.title}
            </h2>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [messages.dashboard.summary.accountBalance, dashboard.summary.accountBalance],
                [messages.dashboard.summary.availableCash, dashboard.summary.availableCash],
                [messages.dashboard.summary.savingsBalance, dashboard.summary.savingsBalance],
                [messages.dashboard.summary.debtBalance, dashboard.summary.debtBalance],
                [messages.dashboard.summary.futureConfirmedBalance, dashboard.summary.futureConfirmedBalance],
                [messages.dashboard.summary.futureExpectedBalance, dashboard.summary.futureExpectedBalance],
              ].map(([label, amount]) => (
                <div className="rounded-2xl bg-[var(--background)] p-4" key={label as string}>
                  <dt className="text-sm text-[var(--muted)]">{label as string}</dt>
                  <dd className="mt-2 break-all text-xl font-semibold">
                    <bdi dir="ltr">{formatMoney(amount as SerializedMoney)}</bdi>
                  </dd>
                </div>
              ))}
              <div className="rounded-2xl bg-[var(--background)] p-4">
                <dt className="text-sm text-[var(--muted)]">
                  {messages.dashboard.summary.credit}
                </dt>
                <dd className="mt-2 break-all text-xl font-semibold">
                  <bdi dir="ltr">
                    {formatMoney(dashboard.credit.used)} / {formatMoney(dashboard.credit.limit)}
                  </bdi>
                </dd>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  <bdi dir="ltr">
                    {creditUtilization(dashboard.credit.utilizationBasisPoints)}
                  </bdi>
                </p>
              </div>
            </dl>
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">
              {messages.dashboard.alerts.title}
            </h2>
            {dashboard.alerts.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                {messages.dashboard.alerts.empty}
              </p>
            ) : (
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {dashboard.alerts.map((alert) => (
                  <li className="rounded-2xl border border-amber-200 bg-amber-50 p-4" key={alert}>
                    <p className="font-semibold text-amber-950">
                      {alertText[alert].title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-amber-900">
                      {alertText[alert].description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TimelinePanel timeline={dashboard.timeline} />

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">
              {messages.dashboard.monthly.title}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              <bdi dir="ltr">{dashboard.monthly.calendarMonth}</bdi>
            </p>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [messages.dashboard.monthly.actualIncome, dashboard.monthly.actualIncome],
                [messages.dashboard.monthly.actualExpenses, dashboard.monthly.actualExpenses],
                [messages.dashboard.monthly.actualNet, dashboard.monthly.actualNetCashFlow],
                [messages.dashboard.monthly.confirmedForecastIncome, dashboard.monthly.confirmedForecastIncome],
                [messages.dashboard.monthly.scheduledObligations, dashboard.monthly.scheduledObligations],
                [messages.dashboard.monthly.uncertainForecastIncome, dashboard.monthly.uncertainForecastIncome],
              ].map(([label, amount]) => (
                <div className="rounded-2xl bg-[var(--background)] p-4" key={label as string}>
                  <dt className="text-sm text-[var(--muted)]">{label as string}</dt>
                  <dd className="mt-2 break-all text-xl font-semibold">
                    <bdi dir="ltr">{formatMoney(amount as SerializedMoney)}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">
              {messages.dashboard.goals.title}
            </h2>
            {dashboard.goals.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                {messages.dashboard.goals.empty}
              </p>
            ) : (
              <ul className="mt-5 grid gap-4 sm:grid-cols-2">
                {dashboard.goals.map((goal) => (
                  <li className="rounded-2xl bg-[var(--background)] p-5" key={goal.id}>
                    <p className="font-semibold">{goal.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {messages.onboarding.form.goalTypes[goal.type]}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-[var(--muted)]">
                          {messages.dashboard.goals.current}
                        </dt>
                        <dd className="mt-1 font-semibold">
                          <bdi dir="ltr">{formatMoney(goal.currentValue)}</bdi>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">
                          {messages.dashboard.goals.target}
                        </dt>
                        <dd className="mt-1 font-semibold">
                          <bdi dir="ltr">{formatMoney(goal.targetAmount)}</bdi>
                        </dd>
                      </div>
                    </dl>
                    {goal.targetDate === null ? null : (
                      <p className="mt-4 text-sm text-[var(--muted)]">
                        {messages.dashboard.goals.targetDate}{" "}
                        <bdi dir="ltr">{formatCalendarDate(goal.targetDate)}</bdi>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {dashboard.goalsTruncated ? (
              <p className="mt-4 text-sm text-amber-800">
                {messages.dashboard.goals.truncated}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}
