import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  financialSnapshotSections,
  type FinancialSnapshot,
} from "@/lib/financial-snapshots/financial-snapshot";
import {
  getFinancialSnapshotRepository,
  type FinancialSnapshotPage,
  type FinancialSnapshotRepository,
} from "@/lib/financial-snapshots/financial-snapshot-repository";
import { InputValidationError } from "@/lib/errors/application-error";
import type { ManualSection } from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

export type FinancialSnapshotDependencies = Readonly<{
  profileRepository?: UserProfileRepository;
  repository: FinancialSnapshotRepository;
  sourceRepositories?: Readonly<
    Partial<Record<ManualSection, ManualRecordRepository>>
  >;
}>;

export async function captureFinancialSnapshot(
  actor: Actor,
  idempotencyKey: string,
  dependencies?: FinancialSnapshotDependencies,
): Promise<FinancialSnapshot> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );

  if (profile === null) {
    throw new InputValidationError([
      { field: "profile", message: "A profile is required before a snapshot." },
    ]);
  }

  const sources = await Promise.all(
    financialSnapshotSections.map(async (section) => {
      const repository =
        dependencies?.sourceRepositories?.[section] ??
        (await getManualRecordRepository(section));
      const records = await repository.listAllForActor(actor);

      return {
        records: records.map((record) => ({
          id: record.id,
          updatedAt: record.updatedAt,
          version: record.version,
        })),
        section,
      };
    }),
  );
  const repository =
    dependencies?.repository ?? (await getFinancialSnapshotRepository());

  return repository.createForActor(
    actor,
    profile.fields.primaryCurrency,
    sources,
    idempotencyKey,
  );
}

export async function listFinancialSnapshots(
  actor: Actor,
  request: Readonly<{ cursor?: string | undefined; limit: number }>,
  dependencies?: FinancialSnapshotDependencies,
): Promise<FinancialSnapshotPage> {
  const repository =
    dependencies?.repository ?? (await getFinancialSnapshotRepository());
  return repository.listForActor(actor, request);
}
