import { requireActor } from "@/lib/auth/actor";
import {
  closeBudgetPeriodCommandSchema,
  parseBudgetCommand,
  saveBudgetPeriodCommandSchema,
} from "@/lib/budgets/budget";
import {
  closeBudgetPeriod,
  saveBudgetPeriod,
} from "@/lib/budgets/budget-service";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "budget-periods");
    const command = parseBudgetCommand(
      saveBudgetPeriodCommandSchema,
      await readJsonBody(request),
    );
    const view = await saveBudgetPeriod(actor, command);
    return noStoreJson({ view });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "budget-periods-close");
    const command = parseBudgetCommand(
      closeBudgetPeriodCommandSchema,
      await readJsonBody(request),
    );
    const view = await closeBudgetPeriod(actor, command);
    return noStoreJson({ view });
  } catch (error) {
    return errorResponse(error);
  }
}
