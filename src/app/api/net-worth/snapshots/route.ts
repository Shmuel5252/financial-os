import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  createNetWorthSnapshotCommandSchema,
  netWorthPageQuerySchema,
  parseNetWorthCommand,
  toNetWorthSnapshotView,
} from "@/lib/net-worth/net-worth";
import { captureExplicitNetWorthSnapshot, listNetWorthSnapshots } from "@/lib/net-worth/net-worth-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const query = parseUntrusted(netWorthPageQuerySchema, {
      ...(url.searchParams.get("cursor") === null ? {} : { cursor: url.searchParams.get("cursor") }),
      ...(url.searchParams.get("limit") === null ? {} : { limit: url.searchParams.get("limit") }),
    });
    const page = await listNetWorthSnapshots(actor, query);
    return noStoreJson({ nextCursor: page.nextCursor, snapshots: page.snapshots.map(toNetWorthSnapshotView) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "net-worth-snapshot-create");
    parseNetWorthCommand(createNetWorthSnapshotCommandSchema, await readJsonBody(request));
    const snapshot = await captureExplicitNetWorthSnapshot(actor);
    return noStoreJson({ snapshot: toNetWorthSnapshotView(snapshot) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
