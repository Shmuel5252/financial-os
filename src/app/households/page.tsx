import Link from "next/link";
import { redirect } from "next/navigation";

import { HouseholdCenter } from "@/components/households/household-center";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { loadHouseholdCenter } from "@/lib/households/household-service";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function HouseholdsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ household?: string }> }>) {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") {
    redirect("/onboarding/review");
  }
  const view = await loadHouseholdCenter(actor, (await searchParams).household);
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <HomeLink />
        <nav aria-label={messages.households.title}>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">
            {messages.dashboard.title}
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.households.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">{messages.households.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.households.description}</p>
      <HouseholdCenter initialView={view} />
    </main>
  );
}
