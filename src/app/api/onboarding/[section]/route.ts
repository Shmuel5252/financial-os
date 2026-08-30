import { requireActor } from "@/lib/auth/actor";
import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import {
  createManualRecordCommandSchema,
  deleteManualRecordCommandSchema,
  parseManualSection,
  toManualRecordView,
  updateManualRecordCommandSchema,
} from "@/lib/onboarding/manual-record";
import {
  createManualRecord,
  deleteManualRecord,
  listManualRecords,
  updateManualRecord,
} from "@/lib/onboarding/manual-record-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<Readonly<{ section: string }>>;
}>;

async function resolveSection(context: RouteContext) {
  const { section } = await context.params;
  return parseManualSection(section);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const section = await resolveSection(context);
    const actor = await requireActor();
    const records = await listManualRecords(actor, section);

    return noStoreJson({
      records: records.map(toManualRecordView),
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
    await consumeMutationRateLimit(actor, `onboarding-${section}`);
    const command = parseUntrusted(
      createManualRecordCommandSchema,
      await readJsonBody(request),
    );
    const record = await createManualRecord(actor, section, command.fields);

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
    await consumeMutationRateLimit(actor, `onboarding-${section}`);
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
    await consumeMutationRateLimit(actor, `onboarding-${section}`);
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
