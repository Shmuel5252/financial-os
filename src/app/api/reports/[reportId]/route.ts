import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { deleteReportCommandSchema, parseReportCommand, toSavedFinancialReportView } from "@/lib/reports/report";
import { findSavedReport, hideSavedReport } from "@/lib/reports/report-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";
type Context = Readonly<{ params: Promise<{ reportId: string }> }>;
export async function GET(_request: Request, context: Context) {
  try { const actor = await requireActor(); return noStoreJson({ report: toSavedFinancialReportView(await findSavedReport(actor, (await context.params).reportId)) }); } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { assertTrustedMutationOrigin(request); const actor = await requireActor(); await consumeMutationRateLimit(actor, "report-hide"); const command = parseReportCommand(deleteReportCommandSchema, await readJsonBody(request)); await hideSavedReport(actor, (await context.params).reportId, command.expectedVersion); return noStoreJson({ ok: true }); } catch (error) { return errorResponse(error); }
}
