import { notFound, redirect } from "next/navigation";

import { HomeLink } from "@/components/navigation/home-link";
import { ManualSectionForm } from "@/components/onboarding/manual-section-form";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import {
  onboardingSectionSchema,
  toManualRecordView,
  type OnboardingSection,
} from "@/lib/onboarding/manual-record";
import { listManualRecords } from "@/lib/onboarding/manual-record-service";
import type { OnboardingStep } from "@/lib/profiles/profile";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

const sectionDetails: Readonly<
  Record<
    OnboardingSection,
    Readonly<{
      description: string;
      label: string;
      nextPath: string;
      step: OnboardingStep;
    }>
  >
> = {
  accounts: {
    description: messages.onboarding.sections.accounts.description,
    label: messages.onboarding.sections.accounts.label,
    nextPath: "/onboarding/cards",
    step: "accounts",
  },
  cards: {
    description: messages.onboarding.sections.cards.description,
    label: messages.onboarding.sections.cards.label,
    nextPath: "/onboarding/expenses",
    step: "cards",
  },
  expenses: {
    description: messages.onboarding.sections.expenses.description,
    label: messages.onboarding.sections.expenses.label,
    nextPath: "/onboarding/loans",
    step: "expenses",
  },
  goals: {
    description: messages.onboarding.sections.goals.description,
    label: messages.onboarding.sections.goals.label,
    nextPath: "/onboarding/review",
    step: "goals",
  },
  income: {
    description: messages.onboarding.sections.income.description,
    label: messages.onboarding.sections.income.label,
    nextPath: "/onboarding/accounts",
    step: "income",
  },
  loans: {
    description: messages.onboarding.sections.loans.description,
    label: messages.onboarding.sections.loans.label,
    nextPath: "/onboarding/safety_margin",
    step: "debts",
  },
  safety_margin: {
    description: messages.onboarding.sections.safety_margin.description,
    label: messages.onboarding.sections.safety_margin.label,
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

  const parsedSection = onboardingSectionSchema.safeParse((await params).section);
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
      <HomeLink />
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">
        {messages.onboarding.eyebrow(details.label)}
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
