import { requireActor } from "@/lib/auth/actor";
import {
  aiConversationPageQuerySchema,
  sendAiMessageCommandSchema,
  toAiConversationView,
} from "@/lib/ai/ai";
import { listAiConversations, sendAiMessage } from "@/lib/ai/ai-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeAiRequestRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const query = parseUntrusted(aiConversationPageQuerySchema, {
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return noStoreJson({
      conversations: (await listAiConversations(actor, query.limit)).map(toAiConversationView),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeAiRequestRateLimit(actor);
    const command = parseUntrusted(sendAiMessageCommandSchema, await readJsonBody(request));
    const conversation = await sendAiMessage(actor, command);
    return noStoreJson({ conversation: toAiConversationView(conversation) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
