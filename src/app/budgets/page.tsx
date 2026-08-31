import Link from "next/link";
import { redirect } from "next/navigation";

import { BudgetPlanner } from "@/components/budgets/budget-planner";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { calendarMonthSchema } from "@/lib/budgets/budget";
import { loadBudgetView } from "@/lib/budgets/budget-service";
import { getConfigurationStatus } from "@/lib/config/server-env";
import {
  calendarDateAtInstant,
  calendarMonth,
} from "@/lib/domain/financial-engine/financial-calendar";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function BudgetsPage({ searchParams }: PageProps) {
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
  const currentMonth = calendarMonth(
    calendarDateAtInstant(new Date().toISOString(), profile.fields.timeZone),
  );
  const requested = (await searchParams).month;
  const parsed = calendarMonthSchema.safeParse(
    Array.isArray(requested) ? requested[0] : requested,
  );
  const selectedMonth = parsed.success ? parsed.data : currentMonth;
  const view = await loadBudgetView(actor, selectedMonth);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:py-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <HomeLink />
        <Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">
          {messages.budgets.actions.dashboard}
        </Link>
      </div>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.budgets.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{messages.budgets.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.budgets.description}</p>
      <form action="/budgets" className="mt-6 flex max-w-sm items-end gap-3" method="get">
        <label className="flex-1 text-sm font-semibold">{messages.budgets.month}<input className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-normal" defaultValue={selectedMonth} dir="ltr" name="month" type="month" /></label>
        <button className="rounded-2xl border border-[var(--border)] bg-white px-5 py-3 font-semibold" type="submit">{messages.budgets.month}</button>
      </form>
      <BudgetPlanner initialView={view} />
    </main>
  );
}
