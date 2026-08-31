import { requireActor } from "@/lib/auth/actor";
import { evaluateGoalCommandSchema, parseGoalCommand, toGoalProgressEvidenceView } from "@/lib/goals/goal";
import { evaluateGoal } from "@/lib/goals/goal-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "goal-evaluations");
    const command = parseGoalCommand(evaluateGoalCommandSchema, await readJsonBody(request));
    const progress = await evaluateGoal(actor, command);
    return noStoreJson({ progress: toGoalProgressEvidenceView(progress) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
