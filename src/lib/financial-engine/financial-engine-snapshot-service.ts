import "server-only";

import { createHash } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import { stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { InputValidationError } from "@/lib/errors/application-error";
import {
  buildFinancialEngineInput,
  financialEngineSourceSections,
  type FinancialEngineSourceRecords,
} from "@/lib/financial-engine/financial-engine-input";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import {
  getFinancialEngineSnapshotRepository,
  type FinancialEngineSnapshotPage,
  type FinancialEngineSnapshotRepository,
} from "@/lib/financial-engine/financial-engine-snapshot-repository";
import {
  getFinancialSnapshotRepository,
  type FinancialSnapshotRepository,
} from "@/lib/financial-snapshots/financial-snapshot-repository";
import type { ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { getManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

export type FinancialEngineSnapshotDependencies = Readonly<{
  engineRepository?: FinancialEngineSnapshotRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  sourceManifestRepository?: FinancialSnapshotRepository;
  sourceRepositories?: Readonly<
    Partial<
      Record<
        (typeof financialEngineSourceSections)[number],
        ManualRecordRepository
      >
    >
  >;
}>;

export type CalculateFinancialEngineSnapshotRequest = Readonly<{
  asOf?: string | undefined;
  horizonDays: number;
  idempotencyKey: string;
}>;

function hashInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableSerializableDomainValue(input)), "utf8")
    .digest("hex");
}

export async function calculateFinancialEngineSnapshot(
  actor: Actor,
  request: CalculateFinancialEngineSnapshotRequest,
  dependencies?: FinancialEngineSnapshotDependencies,
): Promise<FinancialEngineSnapshot> {
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
        message: "A profile is required before a financial calculation.",
      },
    ]);
  }

  const sourceEntries = await Promise.all(
    financialEngineSourceSections.map(async (section) => {
      const repository =
        dependencies?.sourceRepositories?.[section] ??
        (await getManualRecordRepository(section));
      return [section, await repository.listAllForActor(actor)] as const;
    }),
  );
  const sourceRecords = Object.fromEntries(
    sourceEntries,
  ) as FinancialEngineSourceRecords;
  const sources = sourceEntries.map(([section, records]) => ({
    records: records.map((record) => ({
      id: record.id,
      updatedAt: record.updatedAt,
      version: record.version,
    })),
    section,
  }));
  const asOf = request.asOf ?? (dependencies?.now ?? (() => new Date()))().toISOString();
  const input = buildFinancialEngineInput(
    profile,
    sourceRecords,
    asOf,
    request.horizonDays,
  );
  const inputHash = hashInput(input);
  const result = calculateFinancialEngine(input);
  const sourceManifestRepository =
    dependencies?.sourceManifestRepository ??
    (await getFinancialSnapshotRepository());
  const sourceManifest = await sourceManifestRepository.createForActor(
    actor,
    profile.fields.primaryCurrency,
    sources,
    `${request.idempotencyKey}:source`,
  );
  const engineRepository =
    dependencies?.engineRepository ??
    (await getFinancialEngineSnapshotRepository());

  return engineRepository.createForActor(
    actor,
    inputHash,
    result,
    sourceManifest.id,
    request.idempotencyKey,
  );
}

export async function listFinancialEngineSnapshots(
  actor: Actor,
  request: Readonly<{ cursor?: string | undefined; limit: number }>,
  dependencies?: FinancialEngineSnapshotDependencies,
): Promise<FinancialEngineSnapshotPage> {
  const repository =
    dependencies?.engineRepository ??
    (await getFinancialEngineSnapshotRepository());
  return repository.listForActor(actor, request);
}
