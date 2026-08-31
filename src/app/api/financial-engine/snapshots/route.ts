import { requireActor } from "@/lib/auth/actor";
import {
  createFinancialEngineSnapshotCommandSchema,
  financialEngineSnapshotPageQuerySchema,
  toFinancialEngineSnapshotView,
} from "@/lib/financial-engine/financial-engine-snapshot";
import {
  calculateFinancialEngineSnapshot,
  listFinancialEngineSnapshots,
} from "@/lib/financial-engine/financial-engine-snapshot-service";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const limit = url.searchParams.get("limit");
    const pageRequest = parseUntrusted(financialEngineSnapshotPageQuerySchema, {
      ...(cursor === null ? {} : { cursor }),
      ...(limit === null ? {} : { limit }),
    });
    const page = await listFinancialEngineSnapshots(actor, pageRequest);

    return noStoreJson({
      nextCursor: page.nextCursor,
      snapshots: page.snapshots.map(toFinancialEngineSnapshotView),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "financial-engine-snapshot");
    const command = parseUntrusted(
      createFinancialEngineSnapshotCommandSchema,
      await readJsonBody(request),
    );
    const snapshot = await calculateFinancialEngineSnapshot(actor, command);

    return noStoreJson(
      { snapshot: toFinancialEngineSnapshotView(snapshot) },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
