import { requireActor } from "@/lib/auth/actor";
import { getDatabase } from "@/lib/db/mongodb";
import { boundedReadiness, evaluateReadiness, parseOperatorAllowlist, singleFlightProbe } from "@/lib/operations/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const probe = singleFlightProbe(async () => {
  const database = await getDatabase();
  await database.command({ ping: 1 }, { timeoutMS: 3_000 });
});

export async function GET(): Promise<Response> {
  const result = await boundedReadiness(evaluateReadiness({
    authenticate: requireActor,
    operatorIds: parseOperatorAllowlist(process.env.OPERATIONS_OPERATOR_USER_IDS),
    probe,
  }));
  return Response.json({ status: result.category }, {
    status: result.status,
    headers: { "Cache-Control": "no-store", "Vary": "Cookie" },
  });
}
