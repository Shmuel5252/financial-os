import { redirect } from "next/navigation";

import { HomeLink } from "@/components/navigation/home-link";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { ProfileForm } from "@/components/onboarding/profile-form";
import { actorFromSession } from "@/lib/auth/actor";
import { auth } from "@/lib/auth";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { toUserProfileView } from "@/lib/profiles/profile";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

const onboardingPaths = {
  accounts: "/onboarding/accounts",
  cards: "/onboarding/cards",
  debts: "/onboarding/loans",
  expenses: "/onboarding/expenses",
  goals: "/onboarding/goals",
  income: "/onboarding/income",
  profile: "/onboarding/income",
  review: "/onboarding/review",
  safety_margin: "/onboarding/safety_margin",
} as const;

export default async function OnboardingProfilePage() {
  if (!getConfigurationStatus().authentication.ready) {
    redirect("/sign-in");
  }

  const session = await auth();

  if (session?.user?.id === undefined) {
    redirect("/sign-in");
  }

  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  const managing = profile?.onboarding.status === "complete";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
      {managing ? <AppNavigation currentPath="/financial-data/profile" /> : <HomeLink />}
      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-7 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-10">
        <p className="text-sm font-semibold text-[var(--accent)]">
          {managing ? messages.financialData.title : messages.onboarding.eyebrow(messages.onboarding.profile.label)}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
          {managing ? messages.onboarding.profile.label : messages.onboarding.profile.title}
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
          {messages.onboarding.profile.description}
        </p>
        <ProfileForm
          management={managing}
          continuePath={
            managing ? "/financial-data" : profile === null
              ? "/onboarding/income"
              : onboardingPaths[profile.onboarding.currentStep]
          }
          initialProfile={profile === null ? null : toUserProfileView(profile)}
        />
      </section>
    </main>
  );
}
