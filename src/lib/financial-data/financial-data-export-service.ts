import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  manualSectionSchema,
  toManualRecordView,
  type ManualRecordView,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import { toUserProfileView, type UserProfileView } from "@/lib/profiles/profile";
import type { UserProfileRepository } from "@/lib/profiles/profile-repository";
import { loadProfile } from "@/lib/profiles/profile-service";

export type FinancialDataExport = Readonly<{
  generatedAt: string;
  profile: UserProfileView | null;
  records: Readonly<Record<ManualSection, readonly ManualRecordView[]>>;
  schemaVersion: 1;
}>;

export type FinancialDataExportDependencies = Readonly<{
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  repositories?: Readonly<Partial<Record<ManualSection, ManualRecordRepository>>>;
}>;

export async function buildFinancialDataExport(
  actor: Actor,
  dependencies?: FinancialDataExportDependencies,
): Promise<FinancialDataExport> {
  const profile = await loadProfile(
    actor,
    dependencies?.profileRepository === undefined
      ? undefined
      : { repository: dependencies.profileRepository },
  );
  const entries = await Promise.all(
    manualSectionSchema.options.map(async (section) => {
      const repository =
        dependencies?.repositories?.[section] ??
        (await getManualRecordRepository(section));
      const records = await repository.listAllForActor(actor);

      return [section, records.map(toManualRecordView)] as const;
    }),
  );

  return {
    generatedAt: (dependencies?.now?.() ?? new Date()).toISOString(),
    profile: profile === null ? null : toUserProfileView(profile),
    records: Object.fromEntries(entries) as unknown as Readonly<
      Record<ManualSection, readonly ManualRecordView[]>
    >,
    schemaVersion: 1,
  };
}
