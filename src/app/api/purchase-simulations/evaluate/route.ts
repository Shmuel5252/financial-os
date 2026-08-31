import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  evaluatePurchaseCommandSchema,
  parsePurchaseCommand,
} from "@/lib/purchase-simulations/purchase-simulation";
import { evaluatePurchaseSimulationView } from "@/lib/purchase-simulations/purchase-simulation-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "purchase-simulation-evaluate");
    const command = parsePurchaseCommand(
      evaluatePurchaseCommandSchema,
      await readJsonBody(request),
    );
    const evaluation = await evaluatePurchaseSimulationView(actor, command);
    return noStoreJson({ evaluation });
  } catch (error) {
    return errorResponse(error);
  }
}
