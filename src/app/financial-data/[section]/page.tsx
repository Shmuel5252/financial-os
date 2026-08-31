import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HomeLink } from "@/components/navigation/home-link";
import { ManualSectionForm } from "@/components/onboarding/manual-section-form";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { phaseTwoFinancialSectionSchema } from "@/lib/financial-data/sections";
import { messages } from "@/lib/i18n";
import { toManualRecordView } from "@/lib/onboarding/manual-record";
import {
  listManualRecordPage,
  listManualRecords,
} from "@/lib/onboarding/manual-record-service";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{
  params: Promise<Readonly<{ section: string }>>;
}>;

function accountLabel(record: ReturnType<typeof toManualRecordView>): string {
  if (typeof record.fields === "object" && record.fields !== null) {
    const name = (record.fields as Readonly<Record<string, unknown>>).name;

    if (typeof name === "string") {
      return name;
    }
  }

  return record.id;
}

function transactionLabel(record: ReturnType<typeof toManualRecordView>): string {
  if (typeof record.fields === "object" && record.fields !== null) {
    const fields = record.fields as Readonly<Record<string, unknown>>;
    const merchant = fields.merchant;
    const date = fields.date;
    return [
      typeof merchant === "string" ? merchant : null,
      typeof date === "string" ? date : null,
    ]
      .filter((value): value is string => value !== null)
      .join(" · ") || record.id;
  }
  return record.id;
}

export default async function FinancialDataSectionPage({ params }: PageProps) {
  if (!getConfigurationStatus().authentication.ready) {
    redirect("/sign-in");
  }

  const parsedSection = phaseTwoFinancialSectionSchema.safeParse(
    (await params).section,
  );
  if (!parsedSection.success) {
    notFound();
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

  const section = parsedSection.data;
  const [page, accounts, transactions] = await Promise.all([
    listManualRecordPage(actor, section, { limit: 20 }),
    section === "transactions" || section === "recurring_transactions"
      ? listManualRecords(actor, "accounts")
      : Promise.resolve([]),
    section === "transactions"
      ? listManualRecords(actor, "transactions")
      : Promise.resolve([]),
  ]);
  const details = messages.financialData.sections[section];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <HomeLink />
      <Link
        className="mt-6 inline-flex font-semibold text-[var(--accent)]"
        href="/financial-data"
      >
        {messages.financialData.actions.back}
      </Link>
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">
        {messages.financialData.eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
        {details.label}
      </h1>
      <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">
        {details.description}
      </p>
      <ManualSectionForm
        accountOptions={accounts.map(toManualRecordView).map((record) => ({
          id: record.id,
          label: accountLabel(record),
        }))}
        apiBasePath="/api/financial-data"
        currency={profile.fields.primaryCurrency}
        initialNextCursor={page.nextCursor}
        initialRecords={page.records.map(toManualRecordView)}
        section={section}
        transactionOptions={transactions
          .filter((record) => {
            const recordFields = record.fields as Readonly<Record<string, unknown>>;
            return recordFields.type === "expense";
          })
          .map(toManualRecordView)
          .map((record) => ({ id: record.id, label: transactionLabel(record) }))}
      />
    </main>
  );
}
