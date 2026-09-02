import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { parseNotificationCommand, updateNotificationPreferencesCommandSchema } from "@/lib/notifications/notification";
import { saveNotificationPreferences } from "@/lib/notifications/notification-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "notification-preferences");
    const command = parseNotificationCommand(updateNotificationPreferencesCommandSchema, await readJsonBody(request));
    return noStoreJson({ center: await saveNotificationPreferences(actor, command) });
  } catch (error) { return errorResponse(error); }
}
