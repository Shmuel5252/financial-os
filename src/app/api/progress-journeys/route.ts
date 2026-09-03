import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  evaluateProgressJourneyCommandSchema,
  parseProgressJourneyCommand,
} from "@/lib/progress-journeys/progress-journey";
import { evaluateProgressJourney, loadProgressJourney } from "@/lib/progress-journeys/progress-journey-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson(await loadProgressJourney(await requireActor()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "progress-journey-evaluate");
    const command = parseProgressJourneyCommand(evaluateProgressJourneyCommandSchema, await readJsonBody(request));
    return noStoreJson(await evaluateProgressJourney(actor, command));
  } catch (error) {
    return errorResponse(error);
  }
}
