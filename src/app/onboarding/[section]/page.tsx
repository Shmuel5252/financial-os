import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ManualSectionForm } from "@/components/onboarding/manual-section-form";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import {
  manualSectionSchema,
  toManualRecordView,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import { listManualRecords } from "@/lib/onboarding/manual-record-service";
import type { OnboardingStep } from "@/lib/profiles/profile";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

const sectionDetails: Readonly<
  Record<
    ManualSection,
    Readonly<{
      description: string;
      label: string;
      nextPath: string;
      step: OnboardingStep;
    }>
  >
> = {
  accounts: {
    description: "Add every account balance that belongs in your manual profile.",
    label: "Accounts",
    nextPath: "/onboarding/cards",
    step: "accounts",
  },
  cards: {
    description: "Record credit limits, current usage, and billing days.",
    label: "Credit cards",
    nextPath: "/onboarding/expenses",
    step: "cards",
  },
  expenses: {
    description: "Add required recurring expenses and their next due dates.",
    label: "Recurring expenses",
    nextPath: "/onboarding/loans",
    step: "expenses",
  },
  goals: {
    description: "Define the financial changes you want to measure.",
    label: "Goals",
    nextPath: "/onboarding/review",
    step: "goals",
  },
  income: {
    description: "Add expected income, timing, frequency, and certainty.",
    label: "Income",
    nextPath: "/onboarding/accounts",
    step: "income",
  },
  loans: {
    description: "Record loan balances, payments, rates, and dates.",
    label: "Loans and debts",
    nextPath: "/onboarding/safety_margin",
    step: "debts",
  },
  safety_margin: {
    description: "Choose the amount that should remain protected.",
    label: "Safety margin",
    nextPath: "/onboarding/goals",
    step: "safety_margin",
  },
};

type PageProps = Readonly<{
  params: Promise<Readonly<{ section: string }>>;
}>;

export default async function ManualOnboardingPage({ params }: PageProps) {
  if (!getConfigurationStatus().authentication.ready) {
    redirect("/sign-in");
  }

  const parsedSection = manualSectionSchema.safeParse((await params).section);
  if (!parsedSection.success) {
    notFound();
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

  const section = parsedSection.data;
  const details = sectionDetails[section];
  const records = await listManualRecords(actor, section);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <Link className="text-sm font-semibold text-[var(--accent)]" href="/">
        ← Financial OS
      </Link>
      <p className="mt-8 text-sm font-semibold tracking-wide text-[var(--accent)] uppercase">
        Onboarding · {details.label}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
        {details.label}
      </h1>
      <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
        {details.description}
      </p>
      <ManualSectionForm
        canComplete={profile.onboarding.currentStep === details.step}
        currency={profile.fields.primaryCurrency}
        initialRecords={records.map(toManualRecordView)}
        nextPath={details.nextPath}
        profileVersion={profile.version}
        section={section}
        step={details.step}
      />
    </main>
  );
}
