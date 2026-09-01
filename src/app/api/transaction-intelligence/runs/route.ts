import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import {
  analyzeTransactionsCommandSchema,
  parseTransactionIntelligenceCommand,
} from "@/lib/transaction-intelligence/transaction-intelligence";
import {
  loadLatestTransactionIntelligence,
  runTransactionIntelligence,
} from "@/lib/transaction-intelligence/transaction-intelligence-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    return noStoreJson({
      run: await loadLatestTransactionIntelligence(actor),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "transaction-intelligence-analysis");
    const command = parseTransactionIntelligenceCommand(
      analyzeTransactionsCommandSchema,
      await readJsonBody(request),
    );
    return noStoreJson(
      {
        run: await runTransactionIntelligence(
          actor,
          command.idempotencyKey,
        ),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
