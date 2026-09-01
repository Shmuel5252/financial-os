import Link from "next/link";
import { redirect } from "next/navigation";

import { GoalCenter } from "@/components/goals/goal-center";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { loadGoalCenterView } from "@/lib/goals/goal-service";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  const view = await loadGoalCenterView(actor);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <HomeLink />
      <nav className="mt-6 flex flex-wrap gap-4" aria-label={messages.goalEngine.navigationLabel}>
        <Link className="font-semibold text-[var(--accent)]" href="/copilot">{messages.navigation.copilot}</Link>
        <Link className="font-semibold text-[var(--accent)]" href="/dashboard">{messages.goalEngine.actions.dashboard}</Link>
        <Link className="font-semibold text-[var(--accent)]" href="/financial-data/goals">{messages.goalEngine.actions.addGoal}</Link>
      </nav>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.goalEngine.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">{messages.goalEngine.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.goalEngine.description}</p>
      <GoalCenter initialView={view} />
    </main>
  );
}
