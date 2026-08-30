import Link from "next/link";
import { redirect } from "next/navigation";

import { HomeLink } from "@/components/navigation/home-link";
import { ReviewCompletion } from "@/components/onboarding/review-completion";
import { auth, signOut } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import type { ManualSection } from "@/lib/onboarding/manual-record";
import { listManualRecords } from "@/lib/onboarding/manual-record-service";
import type { OnboardingStep } from "@/lib/profiles/profile";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

const sections: readonly Readonly<{
  label: string;
  path: string;
  section: ManualSection;
}>[] = [
  { label: messages.onboarding.sections.income.label, path: "/onboarding/income", section: "income" },
  { label: messages.onboarding.sections.accounts.label, path: "/onboarding/accounts", section: "accounts" },
  { label: messages.onboarding.sections.cards.label, path: "/onboarding/cards", section: "cards" },
  { label: messages.onboarding.sections.expenses.label, path: "/onboarding/expenses", section: "expenses" },
  { label: messages.onboarding.sections.loans.label, path: "/onboarding/loans", section: "loans" },
  {
    label: messages.onboarding.sections.safety_margin.label,
    path: "/onboarding/safety_margin",
    section: "safety_margin",
  },
  { label: messages.onboarding.sections.goals.label, path: "/onboarding/goals", section: "goals" },
];

const stepPaths: Readonly<Record<OnboardingStep, string>> = {
  accounts: "/onboarding/accounts",
  cards: "/onboarding/cards",
  debts: "/onboarding/loans",
  expenses: "/onboarding/expenses",
  goals: "/onboarding/goals",
  income: "/onboarding/income",
  profile: "/onboarding/profile",
  review: "/onboarding/review",
  safety_margin: "/onboarding/safety_margin",
};

async function signOutAction() {
  "use server";

  await signOut({ redirectTo: "/" });
}

export default async function OnboardingReviewPage() {
  if (!getConfigurationStatus().authentication.ready) {
    redirect("/sign-in");
  }

  const session = await auth();
  if (session?.user?.id === undefined) {
    redirect("/sign-in");
  }

  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null) {
    redirect("/onboarding/profile");
  }

  const records = await Promise.all(
    sections.map(async (section) => ({
      ...section,
      count: (await listManualRecords(actor, section.section)).length,
    })),
  );
  const completed = profile.onboarding.status === "complete";
  const canComplete =
    profile.onboarding.status === "in_progress" &&
    profile.onboarding.currentStep === "review";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-20">
      <HomeLink />
      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-7 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-10">
        <p className="text-sm font-semibold text-[var(--accent)]">
          {messages.onboarding.eyebrow(messages.onboarding.review.label)}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
          {messages.onboarding.review.title}
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          {messages.onboarding.review.description}
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {records.map((record) => (
            <li
              className="flex items-center justify-between rounded-2xl bg-[var(--background)] p-4"
              key={record.section}
            >
              <Link className="font-semibold text-[var(--accent)]" href={record.path}>
                {record.label}
              </Link>
              <span className="text-sm text-[var(--muted)]">
                {messages.onboarding.review.recordCount(record.count)}
              </span>
            </li>
          ))}
        </ul>

        {!canComplete && !completed ? (
          <p className="mt-6 text-sm text-[var(--muted)]">
            {messages.onboarding.review.currentStep}{" "}
            <Link
              className="font-semibold text-[var(--accent)]"
              href={stepPaths[profile.onboarding.currentStep]}
            >
              {messages.onboarding.review.resume}
            </Link>
          </p>
        ) : null}

        <ReviewCompletion
          canComplete={canComplete}
          completed={completed}
          profileVersion={profile.version}
        />

        <form action={signOutAction} className="mt-8 border-t border-[var(--border)] pt-6">
          <button className="text-sm font-semibold text-[var(--muted)]" type="submit">
            {messages.onboarding.review.signOut}
          </button>
        </form>
      </section>
    </main>
  );
}
