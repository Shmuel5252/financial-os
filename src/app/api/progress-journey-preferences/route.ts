import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  parseProgressJourneyCommand,
  updateProgressJourneyPreferencesCommandSchema,
} from "@/lib/progress-journeys/progress-journey";
import { saveProgressJourneyPreferences } from "@/lib/progress-journeys/progress-journey-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "progress-journey-preferences");
    const command = parseProgressJourneyCommand(updateProgressJourneyPreferencesCommandSchema, await readJsonBody(request));
    return noStoreJson(await saveProgressJourneyPreferences(actor, command));
  } catch (error) {
    return errorResponse(error);
  }
}
