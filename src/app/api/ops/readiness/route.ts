import { requireActor } from "@/lib/auth/actor";
import { getDatabase } from "@/lib/db/mongodb";
import { probeDeletionLedger } from "@/lib/operations/deletion-ledger-runtime";
import { boundedReadiness, evaluateReadiness, parseOperatorAllowlist, singleFlightProbe } from "@/lib/operations/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const probe = singleFlightProbe(async () => {
  // A configured ledger that is invalid or unreachable makes readiness unavailable, as it makes claims fail closed.
  await Promise.all([
    getDatabase().then((database) => database.command({ ping: 1 }, { timeoutMS: 3_000 })),
    probeDeletionLedger(),
  ]);
});

export async function GET(): Promise<Response> {
  const result = await boundedReadiness(evaluateReadiness({
    authenticate: requireActor,
    deadlineAt: Date.now() + 5_000,
    operatorIds: parseOperatorAllowlist(process.env.OPERATIONS_OPERATOR_USER_IDS),
    probe,
  }));
  return Response.json({ status: result.category }, {
    status: result.status,
    headers: { "Cache-Control": "no-store", "Vary": "Cookie" },
  });
}
