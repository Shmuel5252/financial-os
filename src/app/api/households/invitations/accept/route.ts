import { requireActor } from "@/lib/auth/actor";
import { acceptHouseholdInvitationCommandSchema } from "@/lib/households/household";
import { acceptHouseholdInvitation } from "@/lib/households/household-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-invitation-accept");
    const command = parseUntrusted(
      acceptHouseholdInvitationCommandSchema,
      await readJsonBody(request),
    );
    return noStoreJson({ household: await acceptHouseholdInvitation(actor, command.token) });
  } catch (error) {
    return errorResponse(error);
  }
}
