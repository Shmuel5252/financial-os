import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { claimOpenBankingCommandSchema, parseOpenBankingCommand } from "@/lib/open-banking/open-banking";
import { claimConfiguredOpenBankingSubject, loadOpenBankingCenter } from "@/lib/open-banking/open-banking-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "open-banking-claim");
    parseOpenBankingCommand(claimOpenBankingCommandSchema, await readJsonBody(request));
    await claimConfiguredOpenBankingSubject(actor);
    return noStoreJson({ center: await loadOpenBankingCenter(actor) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
