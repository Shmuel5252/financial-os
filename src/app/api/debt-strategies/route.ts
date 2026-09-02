import { requireActor } from "@/lib/auth/actor";
import {
  debtStrategyPageQuerySchema,
  parseDebtStrategyCommand,
  saveDebtStrategyCommandSchema,
  toDebtStrategyComparisonView,
} from "@/lib/debt-strategies/debt-strategy";
import { listDebtStrategies, saveDebtStrategy } from "@/lib/debt-strategies/debt-strategy-service";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const query = parseUntrusted(debtStrategyPageQuerySchema, {
      ...(url.searchParams.get("cursor") === null ? {} : { cursor: url.searchParams.get("cursor") }),
      ...(url.searchParams.get("limit") === null ? {} : { limit: url.searchParams.get("limit") }),
    });
    const page = await listDebtStrategies(actor, query);
    return noStoreJson({
      nextCursor: page.nextCursor,
      scenarios: page.scenarios.map((scenario) => ({
        comparison: toDebtStrategyComparisonView(scenario.comparison),
        createdAt: scenario.createdAt.toISOString(),
        id: scenario.id,
        name: scenario.name,
        note: scenario.note,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "debt-strategy-save");
    const command = parseDebtStrategyCommand(saveDebtStrategyCommandSchema, await readJsonBody(request));
    const saved = await saveDebtStrategy(actor, command);
    return noStoreJson({
      scenario: {
        comparison: toDebtStrategyComparisonView(saved.comparison),
        createdAt: saved.createdAt.toISOString(),
        id: saved.id,
        name: saved.name,
        note: saved.note,
      },
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
