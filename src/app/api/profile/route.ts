import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  saveProfileCommandSchema,
  toUserProfileView,
} from "@/lib/profiles/profile";
import {
  loadProfile,
  saveProfile,
} from "@/lib/profiles/profile-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    const profile = await loadProfile(actor);

    return noStoreJson({
      profile: profile === null ? null : toUserProfileView(profile),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "profile-write");
    const command = parseUntrusted(
      saveProfileCommandSchema,
      await readJsonBody(request),
    );
    const profile = await saveProfile(actor, command);

    return noStoreJson({
      profile: toUserProfileView(profile),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
