import { requireActor } from "@/lib/auth/actor";
import {
  budgetScenarioCommandSchema,
  parseBudgetCommand,
} from "@/lib/budgets/budget";
import { runBudgetScenario } from "@/lib/budgets/budget-service";
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
    await consumeMutationRateLimit(actor, "budget-scenarios");
    const command = parseBudgetCommand(
      budgetScenarioCommandSchema,
      await readJsonBody(request),
    );
    const scenario = await runBudgetScenario(actor, command);
    return noStoreJson({ scenario });
  } catch (error) {
    return errorResponse(error);
  }
}
