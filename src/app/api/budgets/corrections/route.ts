import { requireActor } from "@/lib/auth/actor";
import {
  createBudgetCorrectionCommandSchema,
  parseBudgetCommand,
} from "@/lib/budgets/budget";
import { createBudgetCorrection } from "@/lib/budgets/budget-service";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "budget-corrections");
    const command = parseBudgetCommand(
      createBudgetCorrectionCommandSchema,
      await readJsonBody(request),
    );
    const correction = await createBudgetCorrection(actor, command);
    return noStoreJson(
      {
        correction: {
          ...correction,
          at: correction.at.toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
