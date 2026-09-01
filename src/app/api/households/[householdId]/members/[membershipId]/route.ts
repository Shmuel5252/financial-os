import { requireActor } from "@/lib/auth/actor";
import { versionedHouseholdMutationSchema } from "@/lib/households/household";
import { removeHouseholdMember } from "@/lib/households/household-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ householdId: string; membershipId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-member-remove");
    const command = parseUntrusted(versionedHouseholdMutationSchema, await readJsonBody(request));
    const params = await context.params;
    await removeHouseholdMember(
      actor,
      params.householdId,
      params.membershipId,
      command.expectedVersion,
    );
    return noStoreJson({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
