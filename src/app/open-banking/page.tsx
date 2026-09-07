import { redirect } from "next/navigation";

import { AppNavigation } from "@/components/navigation/app-navigation";
import { OpenBankingCenter } from "@/components/open-banking/open-banking-center";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { loadOpenBankingCenter } from "@/lib/open-banking/open-banking-service";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function OpenBankingPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  const center = await loadOpenBankingCenter(actor);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <AppNavigation currentPath="/open-banking" />
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.openBanking.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">{messages.openBanking.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.openBanking.description}</p>
      <OpenBankingCenter initialCenter={center} />
    </main>
  );
}
