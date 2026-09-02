import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { calculateFinancialReport, type ReportEngineInput } from "@/lib/domain/reports/report-engine";
import { money } from "@/lib/domain/money/money";
import { financialReportRepositoryForDatabase } from "@/lib/reports/report-repository";
import { reportSummaryRepositoryForDatabase } from "@/lib/reports/report-summary-repository";
import { REPORT_AI_SUMMARY_POLICY_VERSION } from "@/lib/reports/report-summary";
import { searchRepositoryForDatabase } from "@/lib/search/search-repository";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 16 reports, search, isolation, exactness, and performance", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() }; const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  let database: Db; let reports: ReturnType<typeof financialReportRepositoryForDatabase>; let search: ReturnType<typeof searchRepositoryForDatabase>; let summaries: ReturnType<typeof reportSummaryRepositoryForDatabase>;
  const reportInput: ReportEngineInput = { accounts: [{ amount: money(9_007_199_254_740_991n, "ILS"), id: "account", label: "Account", version: 1 }], budget: [], generatedAt: "2026-09-02T10:00:00.000Z", goals: [], liabilities: [], netWorth: [], period: { kind: "month", value: "2026-08" }, savings: [], scope: { kind: "personal" }, subscriptions: [], timeZone: "Asia/Jerusalem", transactions: [] };

  beforeAll(async () => { await client.connect(); database = client.db(databaseName); reports = financialReportRepositoryForDatabase(database); search = searchRepositoryForDatabase(database); summaries = reportSummaryRepositoryForDatabase(database); await Promise.all([reports.ensureIndexes(), search.ensureIndexes(), summaries.ensureIndexes()]); });
  afterAll(async () => { await client.db(databaseName).dropDatabase(); await client.close(); });

  it("persists immutable report versions with BSON int64 and strict owner filters", async () => {
    const closed = await reports.createForActor(firstActor, { authorizationFingerprint: null, idempotencyKey: randomUUID(), idempotencyPayload: { action: "close" }, report: calculateFinancialReport(reportInput), restatementReason: null, supersedes: null });
    const restated = await reports.createForActor(firstActor, { authorizationFingerprint: null, idempotencyKey: randomUUID(), idempotencyPayload: { action: "restate" }, report: calculateFinancialReport({ ...reportInput, accounts: [{ ...reportInput.accounts[0]!, version: 2 }] }), restatementReason: "explicit correction", supersedes: closed });
    expect(restated.reportVersion).toBe(2); expect(restated.supersedesId).toBe(closed.id); expect((await reports.findForActor(firstActor, closed.id))?.report.sections.accounts[0]?.amount.amountMinor).toBe(9_007_199_254_740_991n); expect(await reports.findForActor(secondActor, closed.id)).toBeNull();
    const stored = await database.collection("financialReports").findOne({ _id: new ObjectId(closed.id) }); expect((stored?.report as { sections: { accounts: { amount: { amountMinor: unknown } }[] } }).sections.accounts[0]?.amount.amountMinor).toBeInstanceOf(Long);
    await reports.hideForActor(firstActor, closed.id, closed.version); expect(await reports.findForActor(firstActor, closed.id)).toBeNull(); expect(await reports.findForActor(firstActor, closed.id, true)).not.toBeNull();
  });

  it("keeps indexed search owner-scoped and immediately removes rebuilt deleted sources", async () => {
    await search.rebuildForActor(firstActor, [{ domain: "transaction", sourceId: "owned", sourceUpdatedAt: "2026-09-01T00:00:00.000Z", sourceVersion: 1, subtitle: "מזון", title: "סופר פרטי" }]);
    await search.rebuildForActor(secondActor, [{ domain: "transaction", sourceId: "other", sourceUpdatedAt: "2026-09-01T00:00:00.000Z", sourceVersion: 1, subtitle: "סודי", title: "סופר פרטי" }]);
    expect((await search.queryForActor(firstActor, ["סו"], { limit: 100 }))).toHaveLength(1); expect((await search.queryForActor(secondActor, ["סו"], { limit: 100 }))).toHaveLength(1);
    await search.rebuildForActor(firstActor, []); expect(await search.queryForActor(firstActor, ["סו"], { limit: 100 })).toHaveLength(0);
  });

  it("keeps structured report-summary versions owner-scoped and independently deletable", async () => {
    const reportId = new ObjectId().toHexString();
    const summary = await summaries.createForActor(firstActor, {
      evidence: [{ label: "report.net_cash_flow", ref: "report.fact.1", value: { amountMinor: "4000", currency: "ILS", kind: "money" } }], model: "claude-acceptance", policyVersion: REPORT_AI_SUMMARY_POLICY_VERSION, provider: "anthropic", reportId,
      reportSourceFingerprint: "a".repeat(64), response: { fact: [{ evidenceRefs: ["report.fact.1"], text: "התזרים בתקופה חיובי." }], insight: [], recommendation: [] }, usage: { inputTokens: 10, outputTokens: 10 }, version: 1,
    }, randomUUID());
    expect(await summaries.listForReportActor(firstActor, reportId)).toHaveLength(1); expect(await summaries.listForReportActor(secondActor, reportId)).toHaveLength(0);
    await expect(summaries.deleteForActor(secondActor, summary.id, summary.version)).rejects.toBeTruthy();
    await summaries.deleteForActor(firstActor, summary.id, summary.version); expect(await summaries.listForReportActor(firstActor, reportId)).toHaveLength(0);
  });

  it("meets bounded 10k-source report and p95 indexed search targets", async () => {
    const transactions = Array.from({ length: 10_000 }, (_, index) => ({ amount: money(1n, "ILS"), category: `category-${index % 20}`, date: "2026-08-15", id: `tx-${index}`, type: "expense" as const, version: 1 }));
    const reportDurations = Array.from({ length: 20 }, () => { const start = performance.now(); calculateFinancialReport({ ...reportInput, accounts: [], transactions }); return performance.now() - start; }).sort((a, b) => a - b);
    expect(reportDurations[Math.ceil(reportDurations.length * 0.95) - 1]).toBeLessThan(2_000);
    await search.rebuildForActor(firstActor, Array.from({ length: 10_000 }, (_, index) => ({ domain: "transaction" as const, sourceId: `bulk-${index}`, sourceUpdatedAt: "2026-09-01T00:00:00.000Z", sourceVersion: 1, subtitle: `קטגוריה ${index % 20}`, title: `בית עסק קבוע ${index}` })));
    await search.queryForActor(firstActor, ["בית"], { limit: 100 });
    const searchDurations: number[] = []; for (let index = 0; index < 20; index += 1) { const start = performance.now(); const result = await search.queryForActor(firstActor, ["בית"], { limit: 100 }); searchDurations.push(performance.now() - start); expect(result.length).toBeLessThanOrEqual(100); }
    searchDurations.sort((a, b) => a - b); expect(searchDurations[Math.ceil(searchDurations.length * 0.95) - 1]).toBeLessThan(500);
  }, 60_000);
});
