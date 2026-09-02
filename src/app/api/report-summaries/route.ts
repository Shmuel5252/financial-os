import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { generateReportAiSummary, listReportAiSummaries } from "@/lib/reports/report-summary-service";
import { generateReportSummaryCommandSchema, parseReportSummaryCommand, toReportAiSummaryView } from "@/lib/reports/report-summary";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const actor = await requireActor(); const reportId = new URL(request.url).searchParams.get("reportId") ?? ""; return noStoreJson({ summaries: (await listReportAiSummaries(actor, reportId)).map(toReportAiSummaryView) }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { assertTrustedMutationOrigin(request); const actor = await requireActor(); await consumeMutationRateLimit(actor, "report-ai-summary"); const command = parseReportSummaryCommand(generateReportSummaryCommandSchema, await readJsonBody(request)); return noStoreJson({ summary: toReportAiSummaryView(await generateReportAiSummary(actor, command)) }, 201); } catch (error) { return errorResponse(error); }
}
