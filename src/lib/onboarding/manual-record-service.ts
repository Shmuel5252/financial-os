import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { InputValidationError } from "@/lib/errors/application-error";
import {
  collectMoneyValues,
  parseManualFields,
  type ManualRecord,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

type ManualRecordDependencies = Readonly<{
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

export async function listManualRecords(
  actor: Actor,
  section: ManualSection,
  dependencies?: ManualRecordDependencies,
): Promise<readonly ManualRecord[]> {
  const { repository } = await resolveDependencies(section, dependencies);
  return repository.listForActor(actor);
}

export async function createManualRecord(
  actor: Actor,
  section: ManualSection,
  input: unknown,
  dependencies?: ManualRecordDependencies,
): Promise<ManualRecord> {
  const fields = await parseAndAuthorizeFields(actor, section, input, dependencies);
  const { repository } = await resolveDependencies(section, dependencies);
  return repository.createForActor(actor, fields);
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
  const { repository } = await resolveDependencies(section, dependencies);
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
