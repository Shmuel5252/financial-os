import { requireActor } from "@/lib/auth/actor";
import {
  createBudgetCategoryCommandSchema,
  parseBudgetCommand,
  updateBudgetCategoryCommandSchema,
} from "@/lib/budgets/budget";
import {
  createBudgetCategory,
  updateBudgetCategory,
} from "@/lib/budgets/budget-service";
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
    await consumeMutationRateLimit(actor, "budget-categories");
    const command = parseBudgetCommand(
      createBudgetCategoryCommandSchema,
      await readJsonBody(request),
    );
    const category = await createBudgetCategory(actor, command);
    return noStoreJson({ category }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "budget-categories");
    const command = parseBudgetCommand(
      updateBudgetCategoryCommandSchema,
      await readJsonBody(request),
    );
    const category = await updateBudgetCategory(actor, command);
    return noStoreJson({ category });
  } catch (error) {
    return errorResponse(error);
  }
}
