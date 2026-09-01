import { requireActor } from "@/lib/auth/actor";
import { versionedHouseholdMutationSchema } from "@/lib/households/household";
import { leaveHousehold } from "@/lib/households/household-service";
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
    await consumeMutationRateLimit(actor, "household-leave");
    const command = parseUntrusted(versionedHouseholdMutationSchema, await readJsonBody(request));
    await leaveHousehold(actor, (await context.params).householdId, command.expectedVersion);
    return noStoreJson({ left: true });
  } catch (error) {
    return errorResponse(error);
  }
}
