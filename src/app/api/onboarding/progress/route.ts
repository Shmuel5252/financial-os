import { z } from "zod";

import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  onboardingStepSchema,
  toUserProfileView,
} from "@/lib/profiles/profile";
import { completeOnboardingStep } from "@/lib/profiles/profile-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

const commandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  step: onboardingStepSchema,
});

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "onboarding-progress");
    const command = parseUntrusted(commandSchema, await readJsonBody(request));
    const profile = await completeOnboardingStep(
      actor,
      command.step,
      command.expectedVersion,
    );

    return noStoreJson({
      profile: toUserProfileView(profile),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
