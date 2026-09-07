import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { parseOpenBankingCommand, refreshOpenBankingCommandSchema } from "@/lib/open-banking/open-banking";
import { requestOpenBankingRefresh } from "@/lib/open-banking/open-banking-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "open-banking-refresh");
    const command = parseOpenBankingCommand(refreshOpenBankingCommandSchema, await readJsonBody(request));
    return noStoreJson({ refresh: await requestOpenBankingRefresh(actor, command.idempotencyKey) }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
