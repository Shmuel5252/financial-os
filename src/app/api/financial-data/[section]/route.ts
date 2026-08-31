import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  createManualRecordCommandSchema,
  deleteManualRecordCommandSchema,
  manualRecordPageQuerySchema,
  parseManualSection,
  toManualRecordView,
  updateManualRecordCommandSchema,
} from "@/lib/onboarding/manual-record";
import {
  createManualRecord,
  deleteManualRecord,
  listManualRecordPage,
  updateManualRecord,
} from "@/lib/onboarding/manual-record-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<Readonly<{ section: string }>>;
}>;

async function resolveSection(context: RouteContext) {
  return parseManualSection((await context.params).section);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const section = await resolveSection(context);
    const actor = await requireActor();
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const limit = url.searchParams.get("limit");
    const pageRequest = parseUntrusted(manualRecordPageQuerySchema, {
      ...(cursor === null ? {} : { cursor }),
      ...(limit === null ? {} : { limit }),
    });
    const page = await listManualRecordPage(actor, section, pageRequest);

    return noStoreJson({
      nextCursor: page.nextCursor,
      records: page.records.map(toManualRecordView),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const section = await resolveSection(context);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, `financial-data-${section}`);
    const command = parseUntrusted(
      createManualRecordCommandSchema,
      await readJsonBody(request),
    );
    const record = await createManualRecord(
      actor,
      section,
      command.fields,
      command.idempotencyKey,
    );

    return noStoreJson({ record: toManualRecordView(record) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const section = await resolveSection(context);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, `financial-data-${section}`);
    const command = parseUntrusted(
      updateManualRecordCommandSchema,
      await readJsonBody(request),
    );
    const record = await updateManualRecord(
      actor,
      section,
      command.id,
      command.expectedVersion,
      command.fields,
    );

    return noStoreJson({ record: toManualRecordView(record) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const section = await resolveSection(context);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, `financial-data-${section}`);
    const command = parseUntrusted(
      deleteManualRecordCommandSchema,
      await readJsonBody(request),
    );
    await deleteManualRecord(
      actor,
      section,
      command.id,
      command.expectedVersion,
    );

    return noStoreJson({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
