import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import {
  parseTransactionIntelligenceCommand,
  reviewTransactionIntelligenceCommandSchema,
} from "@/lib/transaction-intelligence/transaction-intelligence";
import { reviewTransactionIntelligenceSignal } from "@/lib/transaction-intelligence/transaction-intelligence-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "transaction-intelligence-review");
    const command = parseTransactionIntelligenceCommand(
      reviewTransactionIntelligenceCommandSchema,
      await readJsonBody(request),
    );
    return noStoreJson({
      run: await reviewTransactionIntelligenceSignal(actor, command),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
