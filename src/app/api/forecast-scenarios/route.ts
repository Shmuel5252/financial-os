import { requireActor } from "@/lib/auth/actor";
import {
  createForecastScenarioCommandSchema,
  parseForecastCommand,
  toForecastScenarioView,
} from "@/lib/forecasts/forecast";
import { createForecastScenario } from "@/lib/forecasts/forecast-service";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "forecast-scenario-calculation");
    const command = parseForecastCommand(
      createForecastScenarioCommandSchema,
      await readJsonBody(request),
    );
    const scenario = await createForecastScenario(actor, command);
    return noStoreJson({ scenario: toForecastScenarioView(scenario) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
