import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReportCenter } from "@/components/reports/report-center";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Phase 16 Hebrew/RTL report UI", () => {
  it("renders Hebrew report, export, search, AI authority, and LTR money isolation", () => {
    const markup = renderToStaticMarkup(<ReportCenter households={[]} initialCurrent={{
      engineVersion: "financial-report-v1", generatedAt: "2026-09-02T10:00:00.000Z", period: { kind: "month", value: "2026-08" }, periodEnd: "2026-08-31", periodStart: "2026-08-01", policyVersion: "phase-16-report-policy-v1", scope: { kind: "personal" },
      sections: { accounts: [], budget: [], cashFlow: [{ amount: { amountMinor: "100", currency: "ILS" }, key: "cash_flow.net", label: "net", sourceAliases: [] }], categories: [], debt: [], goals: [], netWorth: [], savings: [], subscriptions: [] }, sourceFingerprint: "a".repeat(64), sourceReferences: [], timeZone: "Asia/Jerusalem",
    }} initialSaved={[]} initialSummaries={[]} />);
    expect(markup).toContain("סגירת דוח"); expect(markup).toContain("חיפוש מורשה"); expect(markup).toContain("הסיכום מסביר רק עובדות דטרמיניסטיות"); expect(markup).toContain('dir="ltr"'); expect(markup).toContain("Phase 9 נשאר חסום");
  });

  it("renders a yearly report with an explicit four-digit year control", () => {
    const markup = renderToStaticMarkup(<ReportCenter households={[]} initialCurrent={{
      engineVersion: "financial-report-v1", generatedAt: "2026-09-02T10:00:00.000Z", period: { kind: "year", value: "2026" }, periodEnd: "2026-12-31", periodStart: "2026-01-01", policyVersion: "phase-16-report-policy-v1", scope: { kind: "personal" },
      sections: { accounts: [], budget: [], cashFlow: [], categories: [], debt: [], goals: [], netWorth: [], savings: [], subscriptions: [] }, sourceFingerprint: "b".repeat(64), sourceReferences: [], timeZone: "Asia/Jerusalem",
    }} initialSaved={[]} initialSummaries={[]} />);
    expect(markup).toContain("שנתי");
    expect(markup).toContain("שנה");
    expect(markup).toContain('name="periodValue"');
    expect(markup).toContain('pattern="\\d{4}"');
    expect(markup).toContain('value="2026"');
  });
});
