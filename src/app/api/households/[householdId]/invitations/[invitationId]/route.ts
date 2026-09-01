import { requireActor } from "@/lib/auth/actor";
import { versionedHouseholdMutationSchema } from "@/lib/households/household";
import { revokeHouseholdInvitation } from "@/lib/households/household-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ householdId: string; invitationId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-invitation-revoke");
    const command = parseUntrusted(versionedHouseholdMutationSchema, await readJsonBody(request));
    const params = await context.params;
    await revokeHouseholdInvitation(
      actor,
      params.householdId,
      params.invitationId,
      command.expectedVersion,
    );
    return noStoreJson({ revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}
