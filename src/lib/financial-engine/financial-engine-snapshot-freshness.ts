import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { calendarDateAtInstant } from "@/lib/domain/financial-engine/financial-calendar";
import {
  financialEngineSourceSections,
} from "@/lib/financial-engine/financial-engine-input";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import {
  getFinancialSnapshotRepository,
  type FinancialSnapshotRepository,
} from "@/lib/financial-snapshots/financial-snapshot-repository";
import type {
  ManualRecord,
  ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import type { UserProfile } from "@/lib/profiles/profile";

export type FinancialSnapshotFreshnessReason =
  | "manifest_unavailable"
  | "new_calendar_day"
  | "profile_changed"
  | "source_changed";

export type FinancialSnapshotFreshnessDependencies = Readonly<{
  manifestRepository?: FinancialSnapshotRepository;
  now?: () => Date;
  sourceRepositories?: Readonly<
    Partial<Record<ManualSection, ManualRecordRepository>>
  >;
}>;

function recordsMatch(
  records: readonly ManualRecord[],
  manifestRecords: readonly Readonly<{
    id: string;
    updatedAt: Date;
    version: number;
  }>[],
): boolean {
  if (records.length !== manifestRecords.length) return false;
  return records.every((record, index) => {
    const stored = manifestRecords[index];
    return (
      stored !== undefined &&
      record.id === stored.id &&
      record.version === stored.version &&
      record.updatedAt.getTime() === stored.updatedAt.getTime()
    );
  });
}

async function sourceRepository(
  section: ManualSection,
  dependencies?: FinancialSnapshotFreshnessDependencies,
): Promise<ManualRecordRepository> {
  return (
    dependencies?.sourceRepositories?.[section] ??
    (await getManualRecordRepository(section))
  );
}

export async function assessFinancialEngineSnapshotFreshness(
  actor: Actor,
  profile: UserProfile,
  snapshot: FinancialEngineSnapshot,
  dependencies?: FinancialSnapshotFreshnessDependencies,
): Promise<readonly FinancialSnapshotFreshnessReason[]> {
  const reasons: FinancialSnapshotFreshnessReason[] = [];
  const manifestRepository =
    dependencies?.manifestRepository ??
    (await getFinancialSnapshotRepository());
  const manifest = await manifestRepository.findForActor(
    actor,
    snapshot.sourceManifestId,
  );

  if (manifest === null) {
    reasons.push("manifest_unavailable");
  } else {
    const manifestBySection = new Map(
      manifest.sources.map((source) => [source.section, source] as const),
    );
    const changed = await Promise.all(
      financialEngineSourceSections.map(async (section) => {
        const repository = await sourceRepository(section, dependencies);
        const records = await repository.listAllForActor(actor);
        const source = manifestBySection.get(section);
        return source === undefined || !recordsMatch(records, source.records);
      }),
    );
    if (changed.some(Boolean)) reasons.push("source_changed");
  }

  if (profile.updatedAt.getTime() > snapshot.calculatedAt.getTime()) {
    reasons.push("profile_changed");
  }
  const now = (dependencies?.now ?? (() => new Date()))();
  if (
    calendarDateAtInstant(now.toISOString(), profile.fields.timeZone) !==
    snapshot.result.evaluationDate
  ) {
    reasons.push("new_calendar_day");
  }

  return reasons;
}
