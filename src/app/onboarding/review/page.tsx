import Link from "next/link";
import { redirect } from "next/navigation";

import { ReviewCompletion } from "@/components/onboarding/review-completion";
import { auth, signOut } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
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
  { label: "Income", path: "/onboarding/income", section: "income" },
  { label: "Accounts", path: "/onboarding/accounts", section: "accounts" },
  { label: "Credit cards", path: "/onboarding/cards", section: "cards" },
  { label: "Recurring expenses", path: "/onboarding/expenses", section: "expenses" },
  { label: "Loans and debts", path: "/onboarding/loans", section: "loans" },
  {
    label: "Safety margin",
    path: "/onboarding/safety_margin",
    section: "safety_margin",
  },
  { label: "Goals", path: "/onboarding/goals", section: "goals" },
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
      <Link className="text-sm font-semibold text-[var(--accent)]" href="/">
        ← Financial OS
      </Link>
      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-7 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-10">
        <p className="text-sm font-semibold tracking-wide text-[var(--accent)] uppercase">
          Onboarding · Review
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
          Review your manual profile
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          Check each section before completing onboarding. A zero count is valid when
          you explicitly completed a section that does not apply.
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
                {record.count} {record.count === 1 ? "record" : "records"}
              </span>
            </li>
          ))}
        </ul>

        {!canComplete && !completed ? (
          <p className="mt-6 text-sm text-[var(--muted)]">
            Current step:{" "}
            <Link
              className="font-semibold text-[var(--accent)]"
              href={stepPaths[profile.onboarding.currentStep]}
            >
              continue onboarding
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
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
