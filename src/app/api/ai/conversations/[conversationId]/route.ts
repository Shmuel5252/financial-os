import { requireActor } from "@/lib/auth/actor";
import { deleteAiConversationCommandSchema } from "@/lib/ai/ai";
import { deleteAiConversation } from "@/lib/ai/ai-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<Readonly<{ conversationId: string }>>;
}>;

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "ai-conversation-delete");
    const { conversationId } = await context.params;
    const command = parseUntrusted(deleteAiConversationCommandSchema, await readJsonBody(request));
    await deleteAiConversation(actor, conversationId, command.expectedVersion);
    return noStoreJson({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
