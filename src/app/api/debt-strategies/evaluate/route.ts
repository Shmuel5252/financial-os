import { requireActor } from "@/lib/auth/actor";
import { evaluateDebtStrategyCommandSchema, parseDebtStrategyCommand } from "@/lib/debt-strategies/debt-strategy";
import { evaluateDebtStrategyView } from "@/lib/debt-strategies/debt-strategy-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "debt-strategy-evaluate");
    const command = parseDebtStrategyCommand(evaluateDebtStrategyCommandSchema, await readJsonBody(request));
    return noStoreJson({ comparison: await evaluateDebtStrategyView(actor, command) });
  } catch (error) {
    return errorResponse(error);
  }
}
