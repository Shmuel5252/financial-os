import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  ConflictError,
  InputValidationError,
} from "@/lib/errors/application-error";
import {
  collectMoneyValues,
  parseManualFields,
  type ManualRecord,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordPage,
  type ManualRecordPageRequest,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

export type ManualRecordDependencies = Readonly<{
  accountRepository?: ManualRecordRepository;
  profileRepository?: UserProfileRepository;
  repository: ManualRecordRepository;
}>;

async function resolveDependencies(
  section: ManualSection,
  dependencies?: ManualRecordDependencies,
): Promise<ManualRecordDependencies> {
  return dependencies ?? {
    repository: await getManualRecordRepository(section),
  };
}

async function parseAndAuthorizeFields(
  actor: Actor,
  section: ManualSection,
  input: unknown,
  dependencies?: ManualRecordDependencies,
): Promise<ReturnType<typeof parseManualFields>> {
  const fields = parseManualFields(section, input);
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );

  if (profile === null) {
    throw new InputValidationError([
      {
        field: "profile",
        message: "Complete the profile step before adding financial data.",
      },
    ]);
  }

  const mismatched = collectMoneyValues(fields).find(
    (value) => value.currency !== profile.fields.primaryCurrency,
  );

  if (mismatched !== undefined) {
    throw new InputValidationError([
      {
        field: "currency",
        message: `Use the profile currency ${profile.fields.primaryCurrency}.`,
      },
    ]);
  }

  return fields;
}

function accountReferences(
  section: ManualSection,
  fields: ReturnType<typeof parseManualFields>,
): readonly string[] {
  if (section !== "transactions" && section !== "recurring_transactions") {
    return [];
  }

  const value = fields as Readonly<Record<string, unknown>>;
  const accountId = value.accountId;
  const destinationAccountId = value.destinationAccountId;

  return [accountId, destinationAccountId].filter(
    (reference): reference is string => typeof reference === "string",
  );
}

async function assertOwnedAccountReferences(
  actor: Actor,
  section: ManualSection,
  fields: ReturnType<typeof parseManualFields>,
  dependencies?: ManualRecordDependencies,
): Promise<void> {
  const references = accountReferences(section, fields);

  if (references.length === 0) {
    return;
  }

  const repository =
    dependencies?.accountRepository ??
    (await getManualRecordRepository("accounts"));
  const results = await Promise.all(
    references.map((recordId) => repository.existsForActor(actor, recordId)),
  );

  if (results.some((exists) => !exists)) {
    throw new InputValidationError([
      {
        field: "accountId",
        message: "Every referenced account must belong to the authenticated user.",
      },
    ]);
  }
}

async function assertOwnedRefundReference(
  actor: Actor,
  section: ManualSection,
  fields: ReturnType<typeof parseManualFields>,
  dependencies?: ManualRecordDependencies,
): Promise<void> {
  if (section !== "transactions") {
    return;
  }

  const value = fields as Readonly<Record<string, unknown>>;
  const refundOfTransactionId = value.refundOfTransactionId;
  if (typeof refundOfTransactionId !== "string") {
    return;
  }

  const repository =
    dependencies?.repository ??
    (await getManualRecordRepository("transactions"));
  const original = await repository.findForActor(
    actor,
    refundOfTransactionId,
  );
  const originalFields = original?.fields as
    | Readonly<Record<string, unknown>>
    | undefined;

  if (originalFields?.type !== "expense") {
    throw new InputValidationError([
      {
        field: "refundOfTransactionId",
        message: "The refund must reference an owned expense transaction.",
      },
    ]);
  }
}

export async function listManualRecords(
  actor: Actor,
  section: ManualSection,
  dependencies?: ManualRecordDependencies,
): Promise<readonly ManualRecord[]> {
  const { repository } = await resolveDependencies(section, dependencies);
  return repository.listForActor(actor);
}

export async function listManualRecordPage(
  actor: Actor,
  section: ManualSection,
  request: ManualRecordPageRequest,
  dependencies?: ManualRecordDependencies,
): Promise<ManualRecordPage> {
  const { repository } = await resolveDependencies(section, dependencies);
  return repository.listPageForActor(actor, request);
}

export async function createManualRecord(
  actor: Actor,
  section: ManualSection,
  input: unknown,
  idempotencyKey: string,
  dependencies?: ManualRecordDependencies,
): Promise<ManualRecord> {
  const fields = await parseAndAuthorizeFields(actor, section, input, dependencies);
  await assertOwnedAccountReferences(actor, section, fields, dependencies);
  await assertOwnedRefundReference(actor, section, fields, dependencies);
  const { repository } = await resolveDependencies(section, dependencies);
  return repository.createForActor(actor, fields, idempotencyKey);
}

export async function updateManualRecord(
  actor: Actor,
  section: ManualSection,
  recordId: string,
  expectedVersion: number,
  input: unknown,
  dependencies?: ManualRecordDependencies,
): Promise<ManualRecord> {
  const fields = await parseAndAuthorizeFields(actor, section, input, dependencies);
  await assertOwnedAccountReferences(actor, section, fields, dependencies);
  await assertOwnedRefundReference(actor, section, fields, dependencies);
  const { repository } = await resolveDependencies(section, dependencies);
  if (section === "transactions") {
    const existing = await repository.findForActor(actor, recordId);
    const existingFields = existing?.fields as
      | Readonly<Record<string, unknown>>
      | undefined;
    const nextFields = fields as Readonly<Record<string, unknown>>;

    if (
      typeof existingFields?.category === "string" &&
      existingFields.category !== nextFields.category
    ) {
      throw new ConflictError(
        "Transaction categories must be corrected through immutable correction evidence.",
      );
    }
  }
  return repository.updateForActor(
    actor,
    recordId,
    fields,
    expectedVersion,
  );
}

export async function deleteManualRecord(
  actor: Actor,
  section: ManualSection,
  recordId: string,
  expectedVersion: number,
  dependencies?: ManualRecordDependencies,
): Promise<void> {
  const { repository } = await resolveDependencies(section, dependencies);
  await repository.deleteForActor(actor, recordId, expectedVersion);
}
