import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { disconnectOpenBankingCommandSchema, parseOpenBankingCommand } from "@/lib/open-banking/open-banking";
import { disconnectOpenBankingConnection } from "@/lib/open-banking/open-banking-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "open-banking-disconnect");
    const command = parseOpenBankingCommand(disconnectOpenBankingCommandSchema, await readJsonBody(request));
    await disconnectOpenBankingConnection(actor, command.connectionId, command.expectedVersion, command.idempotencyKey);
    return noStoreJson({ disconnected: true });
  } catch (error) {
    return errorResponse(error);
  }
}
