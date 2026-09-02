import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  parseNotificationCommand,
  toNotificationView,
  updateNotificationCommandSchema,
} from "@/lib/notifications/notification";
import { loadNotificationCenter, updateNotificationState } from "@/lib/notifications/notification-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson({ center: await loadNotificationCenter(await requireActor()) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "notification-state");
    const command = parseNotificationCommand(updateNotificationCommandSchema, await readJsonBody(request));
    return noStoreJson({ notification: toNotificationView(await updateNotificationState(actor, command)) });
  } catch (error) { return errorResponse(error); }
}
