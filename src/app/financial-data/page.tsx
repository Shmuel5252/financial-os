import Link from "next/link";
import { redirect } from "next/navigation";

import { SnapshotPanel } from "@/components/financial-data/snapshot-panel";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { phaseTwoFinancialSections } from "@/lib/financial-data/sections";
import { toFinancialSnapshotView } from "@/lib/financial-snapshots/financial-snapshot";
import { listFinancialSnapshots } from "@/lib/financial-snapshots/financial-snapshot-service";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function FinancialDataPage() {
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

  const snapshotPage = await listFinancialSnapshots(actor, { limit: 1 });
  const latestSnapshot = snapshotPage.snapshots[0];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <HomeLink />
        <nav className="flex flex-wrap gap-4" aria-label={messages.financialData.title}>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/households">
            {messages.navigation.households}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/transaction-intelligence">
            {messages.navigation.transactionIntelligence}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/copilot">
            {messages.navigation.copilot}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/purchase-simulation">
            {messages.navigation.purchaseSimulation}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/goals">
            {messages.navigation.goals}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/budgets">
            {messages.navigation.budgets}
          </Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">
            {messages.navigation.dashboard}
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">
        {messages.financialData.eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
        {messages.financialData.title}
      </h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">
        {messages.financialData.description}
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {phaseTwoFinancialSections.map((section) => {
          const details = messages.financialData.sections[section];

          return (
            <li
              className="rounded-3xl border border-[var(--border)] bg-white p-5"
              key={section}
            >
              <h2 className="text-lg font-semibold">{details.label}</h2>
              <p className="mt-2 min-h-12 text-sm leading-6 text-[var(--muted)]">
                {details.description}
              </p>
              <Link
                className="mt-4 inline-flex font-semibold text-[var(--accent)]"
                href={`/financial-data/${section}`}
              >
                {messages.financialData.actions.manage}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_auto]">
        <SnapshotPanel
          initialSnapshot={
            latestSnapshot === undefined
              ? null
              : toFinancialSnapshotView(latestSnapshot)
          }
        />
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 lg:w-80">
          <h2 className="text-xl font-semibold">
            {messages.financialData.actions.export}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {messages.financialData.description}
          </p>
          <Link
            className="mt-5 inline-flex rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white"
            href="/api/financial-data/export"
          >
            {messages.financialData.actions.export}
          </Link>
        </section>
      </div>
    </main>
  );
}
