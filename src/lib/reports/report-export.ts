import "server-only";

import { REPORT_EXPORT_VERSION, type FinancialReport, type FinancialReportView, toFinancialReportView } from "@/lib/reports/report";

const SECTION_ORDER: readonly (keyof FinancialReport["sections"])[] = [
  "cashFlow", "categories", "accounts", "budget", "debt", "savings", "netWorth", "goals", "subscriptions",
];

export type PublicReportExport = Readonly<{
  exportVersion: typeof REPORT_EXPORT_VERSION;
  report: Omit<FinancialReportView, "scope"> & Readonly<{ scope: Readonly<{ kind: FinancialReport["scope"]["kind"] }> }>;
}>;

export function toPublicReportExport(report: FinancialReport): PublicReportExport {
  const view = toFinancialReportView(report);
  return { exportVersion: REPORT_EXPORT_VERSION, report: { ...view, scope: { kind: view.scope.kind } } };
}

export function neutralizeSpreadsheetFormula(value: string): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return /^[\s]*[=+\-@]/u.test(normalized) ? `'${normalized}` : normalized;
}

function csvCell(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function reportCsvRows(report: FinancialReport): Iterable<string> {
  function* rows() {
    yield ["export_version", "report_engine_version", "report_policy_version", "scope", "period_kind", "period_value", "section", "item_key", "label", "amount_minor", "currency", "generated_at"].map(csvCell).join(",");
    for (const section of SECTION_ORDER) {
      for (const line of report.sections[section]) {
        yield [REPORT_EXPORT_VERSION, report.engineVersion, report.policyVersion, report.scope.kind, report.period.kind, report.period.value, section, line.key, line.label, line.amount.amountMinor.toString(), line.amount.currency, report.generatedAt].map(csvCell).join(",");
      }
    }
  }
  return rows();
}

export function reportCsvStream(report: FinancialReport): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = reportCsvRows(report)[Symbol.iterator]();
  let first = true;
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) { controller.close(); return; }
      controller.enqueue(encoder.encode(`${first ? "\uFEFF" : ""}${next.value}\r\n`));
      first = false;
    },
  });
}
