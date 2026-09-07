import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { parseOpenBankingCommand, synchronizeOpenBankingCommandSchema } from "@/lib/open-banking/open-banking";
import { loadOpenBankingCenter, synchronizeOpenBanking } from "@/lib/open-banking/open-banking-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "open-banking-sync");
    const command = parseOpenBankingCommand(synchronizeOpenBankingCommandSchema, await readJsonBody(request));
    const run = await synchronizeOpenBanking(actor, command.idempotencyKey);
    return noStoreJson({ center: await loadOpenBankingCenter(actor), run }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
