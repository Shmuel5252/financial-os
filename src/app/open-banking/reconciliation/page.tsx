import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountReconciliationCenter } from "@/components/open-banking/account-reconciliation-center";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function AccountReconciliationPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const profile = await loadProfile(actorFromSession(session));
  if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  const copy = messages.openBanking.reconciliation;
  return <main className="mx-auto w-full max-w-5xl px-6 py-12">
    <Link className="text-sm font-semibold text-[var(--accent)]" href="/open-banking">{copy.back}</Link>
    <h1 className="mt-8 text-3xl font-semibold">{copy.title}</h1>
    <p className="mt-4 leading-7">{copy.description}</p>
    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{copy.privacy}</p>
    <AccountReconciliationCenter />
  </main>;
}
