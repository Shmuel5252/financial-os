import { requireActor } from "@/lib/auth/actor";
import {
  createForecastCommandSchema,
  parseForecastCommand,
  toForecastSnapshotView,
} from "@/lib/forecasts/forecast";
import {
  createOperationalForecast,
  loadForecastCenter,
} from "@/lib/forecasts/forecast-service";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    return noStoreJson({ center: await loadForecastCenter(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "forecast-calculation");
    const command = parseForecastCommand(
      createForecastCommandSchema,
      await readJsonBody(request),
    );
    const forecast = await createOperationalForecast(actor, command);
    return noStoreJson({ forecast: toForecastSnapshotView(forecast) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
