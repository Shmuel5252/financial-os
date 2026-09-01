import { requireActor } from "@/lib/auth/actor";
import {
  createHouseholdCommandSchema,
} from "@/lib/households/household";
import { createHousehold, loadHouseholdCenter } from "@/lib/households/household-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    return noStoreJson(await loadHouseholdCenter(actor));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "household-create");
    const command = parseUntrusted(createHouseholdCommandSchema, await readJsonBody(request));
    return noStoreJson({ household: await createHousehold(actor, command) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
