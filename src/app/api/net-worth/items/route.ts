import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  createNetWorthItemCommandSchema,
  deleteNetWorthItemCommandSchema,
  parseNetWorthCommand,
  toNetWorthItemView,
  toNetWorthSnapshotView,
  updateNetWorthItemCommandSchema,
} from "@/lib/net-worth/net-worth";
import { createNetWorthItem, deleteNetWorthItem, loadNetWorthCenter, updateNetWorthItem } from "@/lib/net-worth/net-worth-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    return noStoreJson(await loadNetWorthCenter(actor));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "net-worth-item-create");
    const command = parseNetWorthCommand(createNetWorthItemCommandSchema, await readJsonBody(request));
    const result = await createNetWorthItem(actor, command.fields, command.idempotencyKey);
    return noStoreJson({ item: toNetWorthItemView(result.item), snapshot: toNetWorthSnapshotView(result.snapshot) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "net-worth-item-update");
    const command = parseNetWorthCommand(updateNetWorthItemCommandSchema, await readJsonBody(request));
    const result = await updateNetWorthItem(actor, command.id, command.expectedVersion, command.fields);
    return noStoreJson({ item: toNetWorthItemView(result.item), snapshot: toNetWorthSnapshotView(result.snapshot) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "net-worth-item-delete");
    const command = parseNetWorthCommand(deleteNetWorthItemCommandSchema, await readJsonBody(request));
    const snapshot = await deleteNetWorthItem(actor, command.id, command.expectedVersion);
    return noStoreJson({ snapshot: toNetWorthSnapshotView(snapshot) });
  } catch (error) {
    return errorResponse(error);
  }
}
