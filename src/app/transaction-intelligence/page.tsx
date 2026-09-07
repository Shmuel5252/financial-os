import { redirect } from "next/navigation";

import { TransactionIntelligenceReview } from "@/components/transaction-intelligence/transaction-intelligence-review";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getBudgetRepository } from "@/lib/budgets/budget-repository";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";
import { loadLatestTransactionIntelligence } from "@/lib/transaction-intelligence/transaction-intelligence-service";

export const dynamic = "force-dynamic";

export default async function TransactionIntelligencePage() {
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
  const budgetRepository = await getBudgetRepository();
  const [initialRun, categories] = await Promise.all([
    loadLatestTransactionIntelligence(actor),
    budgetRepository.listCategoriesForActor(actor),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <AppNavigation currentPath="/transaction-intelligence" />
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">
        {messages.transactionIntelligence.eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
        {messages.transactionIntelligence.title}
      </h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">
        {messages.transactionIntelligence.description}
      </p>
      <TransactionIntelligenceReview
        categories={categories}
        initialRun={initialRun}
      />
    </main>
  );
}
