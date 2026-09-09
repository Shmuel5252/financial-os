import { requireActor } from "@/lib/auth/actor";
import { getDatabase } from "@/lib/db/mongodb";
import { inspectStagingBinding, type BindingEvidence } from "@/lib/operations/environment-binding";
import { boundedReadiness, evaluateReadiness, parseOperatorAllowlist } from "@/lib/operations/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let evidence: BindingEvidence | undefined;
  const authorization = await boundedReadiness(evaluateReadiness({
    authenticate: requireActor,
    operatorIds: parseOperatorAllowlist(process.env.OPERATIONS_OPERATOR_USER_IDS),
    probe: async () => { evidence = await inspectStagingBinding(process.env, getDatabase); },
  }));
  // A successful inspection is NOT a readiness or isolation certification.
  return Response.json(authorization.status === 200 && evidence !== undefined
    ? evidence : { status: authorization.category }, {
    status: authorization.status,
    headers: { "Cache-Control": "no-store", "Vary": "Cookie" },
  });
}
