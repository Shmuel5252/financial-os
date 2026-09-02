import { describe, expect, it } from "vitest";

import { calculateFinancialReport, reportPeriodBounds, type ReportEngineInput } from "@/lib/domain/reports/report-engine";
import { money } from "@/lib/domain/money/money";
import { normalizeSearchTokens } from "@/lib/search/search-repository";
import { neutralizeSpreadsheetFormula, reportCsvStream, toPublicReportExport } from "@/lib/reports/report-export";
import { buildReportSummaryContext } from "@/lib/reports/report-summary-service";
import { toAiProviderContext } from "@/lib/ai/ai-context-service";

function input(): ReportEngineInput {
  return {
    accounts: [{ amount: money(1_000n, "ILS"), id: "account-a", label: "עו״ש", version: 1 }], budget: [], generatedAt: "2026-09-02T10:00:00.000Z", goals: [], liabilities: [], netWorth: [],
    period: { kind: "month", value: "2026-08" }, savings: [], scope: { kind: "personal" }, subscriptions: [], timeZone: "Asia/Jerusalem",
    transactions: [
      { amount: money(5_000n, "ILS"), category: "salary", date: "2026-08-01", id: "income", type: "income", version: 1 },
      { amount: money(1_200n, "ILS"), category: "food", date: "2026-08-31", id: "expense", type: "expense", version: 2 },
      { amount: money(200n, "ILS"), category: "food", date: "2026-08-31", id: "refund", type: "refund", version: 1 },
      { amount: money(9_999n, "USD"), category: "transfer", date: "2026-08-15", id: "transfer", type: "transfer", version: 1 },
      { amount: money(8_000n, "ILS"), category: "salary", date: "2026-09-01", id: "outside", type: "income", version: 1 },
    ],
  };
}

describe("Phase 16 deterministic reports", () => {
  it("uses explicit monthly and yearly inclusive calendar bounds", () => {
    expect(reportPeriodBounds({ kind: "month", value: "2028-02" })).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(reportPeriodBounds({ kind: "year", value: "2026" })).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("calculates exact cash flow, refunds, categories, and transfer exclusion without FX", () => {
    const report = calculateFinancialReport(input());
    expect(report.sections.cashFlow.map((line) => [line.key, line.amount.amountMinor, line.amount.currency])).toEqual([
      ["cash_flow.income", 5_000n, "ILS"], ["cash_flow.expense", 1_200n, "ILS"], ["cash_flow.refund", 200n, "ILS"], ["cash_flow.net", 4_000n, "ILS"],
    ]);
    expect(report.sections.categories[0]?.amount.amountMinor).toBe(1_000n);
    expect(report.sections.cashFlow.some((line) => line.amount.currency === "USD")).toBe(false);
    expect(report.sourceReferences.some((reference) => reference.sourceId === "outside")).toBe(false);
  });

  it("is reproducible and changes its source fingerprint when evidence versions change", () => {
    const first = calculateFinancialReport(input()); const retry = calculateFinancialReport(input());
    expect(retry).toEqual(first);
    const changed = calculateFinancialReport({ ...input(), transactions: input().transactions.map((item) => item.id === "expense" ? { ...item, version: 3 } : item) });
    expect(changed.sourceFingerprint).not.toBe(first.sourceFingerprint);
  });

  it("neutralizes spreadsheet formulas and streams exact UTF-8 CSV amount strings", async () => {
    expect(neutralizeSpreadsheetFormula("=HYPERLINK(\"bad\")")).toBe("'=HYPERLINK(\"bad\")");
    const report = calculateFinancialReport({ ...input(), accounts: [{ amount: money(9_007_199_254_740_991n, "ILS"), id: "large", label: "+SUM(A:A)", version: 1 }] });
    const bytes = new Uint8Array(await new Response(reportCsvStream(report)).arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]); expect(text).toContain("9007199254740991"); expect(text).toContain("'+SUM(A:A)");
    expect(text).not.toContain("account-a");
  });

  it("normalizes Hebrew and Latin prefixes deterministically", () => {
    expect(normalizeSearchTokens("  סופר־מרקט ALPHA  ")).toEqual(expect.arrayContaining(["סו", "סופר", "al", "alpha"]));
  });

  it("removes internal source and household identifiers from JSON exports", () => {
    const householdId = "507f1f77bcf86cd799439011";
    const report = calculateFinancialReport({ ...input(), scope: { householdId, kind: "household" } });
    const exported = JSON.stringify(toPublicReportExport(report));
    expect(exported).not.toContain(householdId); expect(exported).not.toContain("account-a"); expect(exported).not.toContain("sourceId");
  });

  it("minimizes report AI context and removes internal identifiers before provider invocation", () => {
    const report = calculateFinancialReport(input());
    const context = buildReportSummaryContext({ authorizationFingerprint: null, createdAt: new Date("2026-09-02T10:00:00.000Z"), hiddenAt: null, id: "507f1f77bcf86cd799439011", report, reportVersion: 1, restatementReason: null, rootReportId: "507f1f77bcf86cd799439011", schemaVersion: 1, status: "closed", supersedesId: null, version: 1 });
    const providerContext = toAiProviderContext(context); const serialized = JSON.stringify(providerContext);
    expect(providerContext.evidence.length).toBeGreaterThan(0); expect(providerContext.evidence.length).toBeLessThanOrEqual(32);
    expect(serialized).not.toContain("507f1f77bcf86cd799439011"); expect(serialized).not.toContain("account-a"); expect(providerContext.focus).toBe("report");
  });
});
