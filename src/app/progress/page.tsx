import Link from "next/link";
import { redirect } from "next/navigation";

import { ProgressJourneyCenter } from "@/components/progress-journeys/progress-journey-center";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";
import { loadProgressJourney } from "@/lib/progress-journeys/progress-journey-service";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  const view = await loadProgressJourney(actor);
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <HomeLink />
        <nav aria-label={messages.progress.title} className="flex flex-wrap gap-4">
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">{messages.navigation.dashboard}</Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/goals">{messages.navigation.goals}</Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href="/reports">{messages.navigation.reports}</Link>
        </nav>
      </div>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.progress.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{messages.progress.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.progress.description}</p>
      <ProgressJourneyCenter initialView={view} />
    </main>
  );
}
