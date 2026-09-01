import { requireActor } from "@/lib/auth/actor";
import { createHouseholdInvitationCommandSchema } from "@/lib/households/household";
import { createHouseholdInvitation } from "@/lib/households/household-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ householdId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-invitation-create");
    const command = parseUntrusted(
      createHouseholdInvitationCommandSchema,
      await readJsonBody(request),
    );
    return noStoreJson(
      await createHouseholdInvitation(actor, (await context.params).householdId, command),
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
