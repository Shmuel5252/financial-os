import { redirect } from "next/navigation";

import { PurchaseSimulator } from "@/components/purchase-simulations/purchase-simulator";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";
import { loadPurchaseSimulationCenter } from "@/lib/purchase-simulations/purchase-simulation-service";

export const dynamic = "force-dynamic";

export default async function PurchaseSimulationPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") {
    redirect("/onboarding/review");
  }
  const view = await loadPurchaseSimulationCenter(actor);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:py-20">
      <AppNavigation currentPath="/purchase-simulation" />
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">
        {messages.purchaseSimulation.eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
        {messages.purchaseSimulation.title}
      </h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">
        {messages.purchaseSimulation.description}
      </p>
      <p className="mt-3 max-w-3xl text-sm font-semibold text-[var(--muted)]">
        {messages.purchaseSimulation.separation}
      </p>
      <PurchaseSimulator initialView={view} />
    </main>
  );
}
