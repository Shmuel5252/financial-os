import Link from "next/link";
import { redirect } from "next/navigation";

import { ReportCenter } from "@/components/reports/report-center";
import { HomeLink } from "@/components/navigation/home-link";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { loadHouseholdCenter } from "@/lib/households/household-service";
import { messages } from "@/lib/i18n";
import { loadProfile } from "@/lib/profiles/profile-service";
import { parseReportCommand, reportPeriodSchema, toFinancialReportView, toSavedFinancialReportView, type ReportPeriod, type ReportScope } from "@/lib/reports/report";
import { generateCurrentReport, listSavedReports } from "@/lib/reports/report-service";
import { listReportAiSummaries } from "@/lib/reports/report-summary-service";
import { toReportAiSummaryView } from "@/lib/reports/report-summary";

export const dynamic = "force-dynamic";
function currentMonth(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { month: "2-digit", timeZone, year: "numeric" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export default async function ReportsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in"); const session = await auth(); if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session); const profile = await loadProfile(actor); if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  const params = await searchParams; const kind = params.periodKind === "year" ? "year" : "month"; const rawValue = typeof params.periodValue === "string" ? params.periodValue : undefined;
  const period: ReportPeriod = parseReportCommand(reportPeriodSchema, { kind, value: rawValue ?? (kind === "year" ? currentMonth(profile.fields.timeZone).slice(0, 4) : currentMonth(profile.fields.timeZone)) });
  const households = await loadHouseholdCenter(actor); const scopeValue = typeof params.scope === "string" ? params.scope : "personal";
  const scope: ReportScope = scopeValue === "personal" ? { kind: "personal" } : households.households.some((item) => item.id === scopeValue) ? { householdId: scopeValue, kind: "household" } : { kind: "personal" };
  const [current, saved] = await Promise.all([generateCurrentReport(actor, scope, period), listSavedReports(actor)]);
  const latest = saved.find((item) => item.report.period.kind === period.kind && item.report.period.value === period.value && JSON.stringify(item.report.scope) === JSON.stringify(scope));
  const summaries = latest === undefined ? [] : await listReportAiSummaries(actor, latest.id);
  return <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:py-20"><div className="flex flex-wrap items-center justify-between gap-4"><HomeLink /><nav aria-label={messages.reports.title} className="flex flex-wrap gap-4"><Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">{messages.navigation.dashboard}</Link><Link className="text-sm font-semibold text-[var(--accent)]" href="/notifications">{messages.navigation.notifications}</Link></nav></div><p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.reports.eyebrow}</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{messages.reports.title}</h1><p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.reports.description}</p><ReportCenter households={households.households.map((item) => ({ id: item.id, name: item.name }))} initialCurrent={toFinancialReportView(current)} initialSaved={saved.map(toSavedFinancialReportView)} initialSummaries={summaries.map(toReportAiSummaryView)} /></main>;
}
