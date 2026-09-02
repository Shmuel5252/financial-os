import "server-only";

import { createHash } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import { getBudgetRepository } from "@/lib/budgets/budget-repository";
import { DependencyUnavailableError, NotFoundError } from "@/lib/errors/application-error";
import { loadHouseholdCenter } from "@/lib/households/household-service";
import { messages } from "@/lib/i18n";
import { loadNotificationCenter } from "@/lib/notifications/notification-service";
import { manualSectionDomainSchemas } from "@/lib/onboarding/manual-record";
import { getManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { findSavedReport, listSavedReports } from "@/lib/reports/report-service";
import { getReportSummaryRepository } from "@/lib/reports/report-summary-repository";
import { SEARCH_MAX_RESULTS, type SearchIndexItem, type SearchPageView, type SearchResultView } from "@/lib/search/search";
import { getSearchRepository, normalizeSearchTokens, type SearchCandidate, type SearchRepository } from "@/lib/search/search-repository";

type Dependencies = Readonly<{ repository?: SearchRepository }>;

function publicKey(domain: string, sourceId: string): string {
  return createHash("sha256").update(`${domain}:${sourceId}`, "utf8").digest("hex").slice(0, 20);
}
function cursorHash(query: string): string { return createHash("sha256").update(query, "utf8").digest("hex").slice(0, 16); }
const accountTypeLabels: Readonly<Record<string, string>> = { bank: "חשבון בנק", cash: "מזומן", investments: "השקעות", savings: "חיסכון" };
const goalTypeLabels: Readonly<Record<string, string>> = { custom: "יעד מותאם אישית", debt_free: "יציאה מחובות", emergency_fund: "קרן חירום", monthly_spending: "הוצאה חודשית", no_credit_dependency: "עצמאות מאשראי", no_overdraft: "יציאה ממינוס", savings_target: "יעד חיסכון" };
const categoryLabels: Readonly<Record<string, string>> = { benefits: "קצבאות והטבות", children: "ילדים", communications: "תקשורת", debt_payment: "החזרי חוב", entertainment: "בילויים", food: "מזון", housing: "דיור", insurance: "ביטוח", other: "אחר", restaurants: "מסעדות", salary: "שכר", savings: "חיסכון", shopping: "קניות", subscriptions: "מינויים", transfer: "העברה", transport: "תחבורה", utilities: "חשבונות שוטפים", vehicle: "רכב" };
function encodeCursor(query: string, id: string): string { return Buffer.from(JSON.stringify({ h: cursorHash(query), id }), "utf8").toString("base64url"); }
function decodeCursor(query: string, cursor?: string): string | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { h?: unknown; id?: unknown };
    if (value.h !== cursorHash(query) || typeof value.id !== "string" || !/^[0-9a-f]{24}$/i.test(value.id)) throw new Error();
    return value.id;
  } catch { throw new NotFoundError(); }
}

export async function rebuildSearchIndex(actor: Actor, dependencies?: Dependencies): Promise<number> {
  const [transactions, accounts, goals, loans, savings, categories, reports, notifications] = await Promise.all([
    (await getManualRecordRepository("transactions")).listAllForActor(actor, 10_000),
    (await getManualRecordRepository("accounts")).listAllForActor(actor, 10_000),
    (await getManualRecordRepository("goals")).listAllForActor(actor, 10_000),
    (await getManualRecordRepository("loans")).listAllForActor(actor, 10_000),
    (await getManualRecordRepository("savings")).listAllForActor(actor, 10_000),
    (await getBudgetRepository()).listCategoriesForActor(actor),
    listSavedReports(actor),
    loadNotificationCenter(actor),
  ]);
  const summaryRepository = await getReportSummaryRepository();
  const summaries = (await Promise.all(reports.map(async (report) => ({ report, summaries: await summaryRepository.listForReportActor(actor, report.id) })))).flatMap(({ report, summaries: reportSummaries }) => reportSummaries.map((summary) => ({ report, summary })));
  const items: SearchIndexItem[] = [
    ...transactions.map((record) => { const fields = manualSectionDomainSchemas.transactions.parse(record.fields); return { domain: "transaction" as const, sourceId: record.id, sourceUpdatedAt: record.updatedAt.toISOString(), sourceVersion: record.version, subtitle: `${fields.date} · ${categoryLabels[fields.category] ?? fields.category}`, title: fields.merchant ?? fields.notes ?? "תנועה ללא בית עסק" }; }),
    ...accounts.map((record) => { const fields = manualSectionDomainSchemas.accounts.parse(record.fields); return { domain: "account" as const, sourceId: record.id, sourceUpdatedAt: record.updatedAt.toISOString(), sourceVersion: record.version, subtitle: accountTypeLabels[fields.type] ?? fields.type, title: fields.name }; }),
    ...goals.map((record) => { const fields = manualSectionDomainSchemas.goals.parse(record.fields); return { domain: "goal" as const, sourceId: record.id, sourceUpdatedAt: record.updatedAt.toISOString(), sourceVersion: record.version, subtitle: goalTypeLabels[fields.type] ?? fields.type, title: fields.title }; }),
    ...loans.map((record) => { const fields = manualSectionDomainSchemas.loans.parse(record.fields); return { domain: "debt" as const, sourceId: record.id, sourceUpdatedAt: record.updatedAt.toISOString(), sourceVersion: record.version, subtitle: "חוב והתחייבות", title: fields.name }; }),
    ...savings.map((record) => { const fields = manualSectionDomainSchemas.savings.parse(record.fields); return { domain: "asset" as const, sourceId: record.id, sourceUpdatedAt: record.updatedAt.toISOString(), sourceVersion: record.version, subtitle: fields.availability === "liquid" ? "חיסכון נזיל" : fields.availability === "fixed_term" ? "חיסכון לתקופה קבועה" : "נכס חיסכון", title: fields.name }; }),
    ...categories.map((category) => ({ domain: "budget_category" as const, sourceId: category.categoryId, sourceUpdatedAt: "category", sourceVersion: category.version, subtitle: category.kind === "system" ? "קטגוריית מערכת" : "קטגוריה מותאמת אישית", title: category.label ?? categoryLabels[(category.systemKey ?? "").replace(/^system:/u, "")] ?? "קטגוריה" })),
    ...reports.map((saved) => ({ domain: "report" as const, sourceId: saved.id, sourceUpdatedAt: saved.createdAt.toISOString(), sourceVersion: saved.version, subtitle: `${saved.report.period.kind === "month" ? "חודשי" : "שנתי"} · ${saved.status === "closed" ? "סגור" : "גרסה מתוקנת"}`, title: `דוח ${saved.report.period.value}` })),
    ...notifications.notifications.map((notification) => ({ domain: "notification" as const, sourceId: notification.id, sourceUpdatedAt: notification.updatedAt, sourceVersion: notification.version, subtitle: notification.severity === "CRITICAL" ? "התראה קריטית" : notification.severity === "WARNING" ? "אזהרה" : "מידע", title: messages.notifications.messages[notification.messageKey].title })),
    ...summaries.map(({ report, summary }) => { const responseText = [...summary.response.fact, ...summary.response.insight, ...summary.response.recommendation].map((item) => item.text).join(" "); return { domain: "ai_summary" as const, searchText: responseText, sourceId: summary.id, sourceUpdatedAt: summary.createdAt.toISOString(), sourceVersion: summary.version, subtitle: responseText.slice(0, 240), title: `סיכום דוח ${report.report.period.value}` }; }),
  ];
  if (items.length > 15_000) throw new DependencyUnavailableError("The authorized search index exceeds its safe bound.");
  await (dependencies?.repository ?? await getSearchRepository()).rebuildForActor(actor, items);
  return items.length;
}

async function validateCandidate(actor: Actor, candidate: SearchCandidate): Promise<SearchResultView | null> {
  let currentVersion: number | null = null;
  if (candidate.domain === "transaction" || candidate.domain === "account" || candidate.domain === "goal") {
    const section = candidate.domain === "transaction" ? "transactions" : candidate.domain === "account" ? "accounts" : "goals";
    currentVersion = (await (await getManualRecordRepository(section)).findForActor(actor, candidate.sourceId))?.version ?? null;
  } else if (candidate.domain === "debt" || candidate.domain === "asset") {
    currentVersion = (await (await getManualRecordRepository(candidate.domain === "debt" ? "loans" : "savings")).findForActor(actor, candidate.sourceId))?.version ?? null;
  } else if (candidate.domain === "budget_category") {
    currentVersion = (await (await getBudgetRepository()).findCategoryForActor(actor, candidate.sourceId))?.version ?? null;
  } else if (candidate.domain === "report") {
    try { currentVersion = (await findSavedReport(actor, candidate.sourceId)).version; } catch (error) { if (error instanceof NotFoundError) currentVersion = null; else throw error; }
  } else if (candidate.domain === "ai_summary") {
    currentVersion = (await (await getReportSummaryRepository()).findForActor(actor, candidate.sourceId))?.version ?? null;
  } else {
    currentVersion = (await loadNotificationCenter(actor)).notifications.find((notification) => notification.id === candidate.sourceId)?.version ?? null;
  }
  if (currentVersion === null) return null;
  return { domain: candidate.domain, freshness: currentVersion === candidate.sourceVersion ? "CURRENT" : "STALE", key: publicKey(candidate.domain, candidate.sourceId), subtitle: candidate.subtitle, title: candidate.title };
}

async function searchPersonal(actor: Actor, query: string, limit: number, cursor: string | undefined, dependencies?: Dependencies): Promise<SearchPageView> {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return { nextCursor: null, results: [] };
  const candidates = await (dependencies?.repository ?? await getSearchRepository()).queryForActor(actor, tokens, { afterId: decodeCursor(query, cursor), limit: Math.min(SEARCH_MAX_RESULTS, limit) + 1 });
  const page = candidates.slice(0, limit);
  const validated = (await Promise.all(page.map((candidate) => validateCandidate(actor, candidate)))).filter((item): item is SearchResultView => item !== null);
  return { nextCursor: candidates.length > limit && page.at(-1) !== undefined ? encodeCursor(query, page.at(-1)!.id) : null, results: validated };
}

async function searchHousehold(actor: Actor, query: string, householdId: string, limit: number): Promise<SearchPageView> {
  const center = await loadHouseholdCenter(actor, householdId);
  if (center.selected === null) throw new NotFoundError();
  const normalized = query.normalize("NFKC").toLocaleLowerCase("he-IL");
  const results: SearchResultView[] = [
    ...center.sharedAccounts.map((item) => ({ domain: "account" as const, freshness: "CURRENT" as const, key: publicKey("household-account", item.provenanceAlias), subtitle: item.ownerLabel, title: item.label })),
    ...center.sharedGoals.map((item) => ({ domain: "goal" as const, freshness: "CURRENT" as const, key: publicKey("household-goal", item.provenanceAlias), subtitle: item.ownerLabel, title: item.label })),
  ].filter((item) => `${item.title} ${item.subtitle}`.normalize("NFKC").toLocaleLowerCase("he-IL").includes(normalized)).slice(0, limit);
  return { nextCursor: null, results };
}

export async function searchAuthorized(actor: Actor, input: Readonly<{ cursor?: string | undefined; householdId?: string | undefined; limit: number; query: string; scopeKind: "household" | "personal" }>, dependencies?: Dependencies): Promise<SearchPageView> {
  return input.scopeKind === "household" ? searchHousehold(actor, input.query, input.householdId!, input.limit) : searchPersonal(actor, input.query, input.limit, input.cursor, dependencies);
}
