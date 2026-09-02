import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { closeReportCommandSchema, parseReportCommand, reportPeriodSchema, reportScopeSchema, toFinancialReportView, toSavedFinancialReportView } from "@/lib/reports/report";
import { closeOrRestateReport, generateCurrentReport, listSavedReports } from "@/lib/reports/report-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(); const url = new URL(request.url);
    const period = parseReportCommand(reportPeriodSchema, { kind: url.searchParams.get("periodKind") ?? "month", value: url.searchParams.get("periodValue") });
    const scope = parseReportCommand(reportScopeSchema, url.searchParams.get("scopeKind") === "household" ? { householdId: url.searchParams.get("householdId"), kind: "household" } : { kind: "personal" });
    const [current, saved] = await Promise.all([generateCurrentReport(actor, scope, period), listSavedReports(actor)]);
    return noStoreJson({ current: toFinancialReportView(current), saved: saved.map(toSavedFinancialReportView) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request); const actor = await requireActor(); await consumeMutationRateLimit(actor, "report-close");
    const command = parseReportCommand(closeReportCommandSchema, await readJsonBody(request));
    return noStoreJson({ report: toSavedFinancialReportView(await closeOrRestateReport(actor, command)) }, 201);
  } catch (error) { return errorResponse(error); }
}
