import Link from "next/link";
import { redirect } from "next/navigation";

import { DebtStrategyCenter } from "@/components/debt-strategies/debt-strategy-center";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { loadDebtStrategyCenter } from "@/lib/debt-strategies/debt-strategy-service";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function DebtStrategiesPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  const view = await loadDebtStrategyCenter(actor);
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:py-20">
      <div className="flex flex-wrap items-center justify-between gap-4"><HomeLink /><nav className="flex flex-wrap gap-4" aria-label={messages.debtStrategies.eyebrow}><Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">{messages.navigation.dashboard}</Link><Link className="text-sm font-semibold text-[var(--accent)]" href="/forecasts">{messages.navigation.forecasts}</Link><Link className="text-sm font-semibold text-[var(--accent)]" href="/net-worth">{messages.navigation.netWorth}</Link></nav></div>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.debtStrategies.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{messages.debtStrategies.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.debtStrategies.description}</p>
      <p className="mt-3 max-w-3xl text-sm font-semibold text-[var(--muted)]">{messages.debtStrategies.separation}</p>
      <DebtStrategyCenter initialView={view} />
    </main>
  );
}
