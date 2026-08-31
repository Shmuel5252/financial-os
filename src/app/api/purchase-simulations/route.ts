import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  parsePurchaseCommand,
  purchaseSimulationPageQuerySchema,
  savePurchaseSimulationCommandSchema,
  toSavedPurchaseSimulationView,
} from "@/lib/purchase-simulations/purchase-simulation";
import {
  listPurchaseSimulations,
  savePurchaseSimulation,
} from "@/lib/purchase-simulations/purchase-simulation-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const limit = url.searchParams.get("limit");
    const query = parseUntrusted(purchaseSimulationPageQuerySchema, {
      ...(cursor === null ? {} : { cursor }),
      ...(limit === null ? {} : { limit }),
    });
    const page = await listPurchaseSimulations(actor, query);
    return noStoreJson({
      nextCursor: page.nextCursor,
      simulations: page.simulations.map(toSavedPurchaseSimulationView),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "purchase-simulation-save");
    const command = parsePurchaseCommand(
      savePurchaseSimulationCommandSchema,
      await readJsonBody(request),
    );
    const simulation = await savePurchaseSimulation(actor, command);
    return noStoreJson(
      { simulation: toSavedPurchaseSimulationView(simulation) },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
