import { requireActor } from "@/lib/auth/actor";
import { createGoalDefinitionCommandSchema, parseGoalCommand, toGoalDefinitionView, toGoalProgressEvidenceView } from "@/lib/goals/goal";
import { createGoalDefinition } from "@/lib/goals/goal-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "goal-definitions");
    const command = parseGoalCommand(createGoalDefinitionCommandSchema, await readJsonBody(request));
    const created = await createGoalDefinition(actor, command);
    return noStoreJson({
      definition: toGoalDefinitionView(created.definition),
      progress: toGoalProgressEvidenceView(created.progress),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
