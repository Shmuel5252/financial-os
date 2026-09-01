import { requireActor } from "@/lib/auth/actor";
import {
  dissolveHouseholdCommandSchema,
  updateHouseholdCommandSchema,
} from "@/lib/households/household";
import {
  dissolveHousehold,
  loadHouseholdCenter,
  updateHousehold,
} from "@/lib/households/household-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ householdId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    return noStoreJson(await loadHouseholdCenter(actor, (await context.params).householdId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-settings");
    const command = parseUntrusted(updateHouseholdCommandSchema, await readJsonBody(request));
    return noStoreJson({
      household: await updateHousehold(actor, (await context.params).householdId, command),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-dissolve");
    const command = parseUntrusted(dissolveHouseholdCommandSchema, await readJsonBody(request));
    await dissolveHousehold(actor, (await context.params).householdId, command.expectedVersion);
    return noStoreJson({ dissolved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
