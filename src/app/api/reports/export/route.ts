import { requireActor } from "@/lib/auth/actor";
import { errorResponse } from "@/lib/http/route-response";
import { parseReportCommand, reportPeriodSchema, reportScopeSchema } from "@/lib/reports/report";
import { reportCsvStream, toPublicReportExport } from "@/lib/reports/report-export";
import { findSavedReport, generateCurrentReport } from "@/lib/reports/report-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireActor(); const url = new URL(request.url); const format = url.searchParams.get("format");
    if (format !== "csv" && format !== "json") throw new RangeError("Unsupported report export format.");
    const snapshotId = url.searchParams.get("snapshotId");
    const report = snapshotId === null
      ? await generateCurrentReport(actor,
          parseReportCommand(reportScopeSchema, url.searchParams.get("scopeKind") === "household" ? { householdId: url.searchParams.get("householdId"), kind: "household" } : { kind: "personal" }),
          parseReportCommand(reportPeriodSchema, { kind: url.searchParams.get("periodKind") ?? "month", value: url.searchParams.get("periodValue") }))
      : (await findSavedReport(actor, snapshotId)).report;
    const filename = `financial-os-report-${report.period.value}.${format}`;
    const headers = { "Cache-Control": "no-store, max-age=0", "Content-Disposition": `attachment; filename="${filename}"`, "X-Content-Type-Options": "nosniff" };
    if (format === "csv") return new Response(reportCsvStream(report), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
    return new Response(JSON.stringify(toPublicReportExport(report)), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  } catch (error) { return errorResponse(error); }
}
