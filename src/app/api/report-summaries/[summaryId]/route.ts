import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { deleteReportAiSummary } from "@/lib/reports/report-summary-service";
import { deleteReportSummaryCommandSchema, parseReportSummaryCommand } from "@/lib/reports/report-summary";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

type Context = Readonly<{ params: Promise<{ summaryId: string }> }>;
export async function DELETE(request: Request, context: Context) {
  try { assertTrustedMutationOrigin(request); const actor = await requireActor(); await consumeMutationRateLimit(actor, "report-ai-summary-delete"); const command = parseReportSummaryCommand(deleteReportSummaryCommandSchema, await readJsonBody(request)); const reportId = new URL(request.url).searchParams.get("reportId") ?? ""; await deleteReportAiSummary(actor, (await context.params).summaryId, reportId, command.expectedVersion); return noStoreJson({ ok: true }); } catch (error) { return errorResponse(error); }
}
