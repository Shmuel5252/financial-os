import { requireActor } from "@/lib/auth/actor";
import {
  createFinancialSnapshotCommandSchema,
  financialSnapshotPageQuerySchema,
  toFinancialSnapshotView,
} from "@/lib/financial-snapshots/financial-snapshot";
import {
  captureFinancialSnapshot,
  listFinancialSnapshots,
} from "@/lib/financial-snapshots/financial-snapshot-service";
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
    const pageRequest = parseUntrusted(financialSnapshotPageQuerySchema, {
      ...(cursor === null ? {} : { cursor }),
      ...(limit === null ? {} : { limit }),
    });
    const page = await listFinancialSnapshots(actor, pageRequest);

    return noStoreJson({
      nextCursor: page.nextCursor,
      snapshots: page.snapshots.map(toFinancialSnapshotView),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "financial-snapshot");
    const command = parseUntrusted(
      createFinancialSnapshotCommandSchema,
      await readJsonBody(request),
    );
    const snapshot = await captureFinancialSnapshot(
      actor,
      command.idempotencyKey,
    );

    return noStoreJson({ snapshot: toFinancialSnapshotView(snapshot) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
