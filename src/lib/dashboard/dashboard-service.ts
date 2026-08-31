import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  addCalendarDays,
  calendarDateAtInstant,
} from "@/lib/domain/financial-engine/financial-calendar";
import {
  subtractMoney,
  serializeMoney,
  type Money,
} from "@/lib/domain/money/money";
import type { FinancialTimelinePoint } from "@/lib/domain/financial-engine/financial-engine";
import type {
  DashboardAlertCode,
  DashboardEventView,
  DashboardFreshnessReason,
  DashboardGoalView,
  DashboardLimitingPointView,
  DashboardTimelineWindowView,
  DashboardView,
} from "@/lib/dashboard/dashboard";
import {
  financialEngineSourceSections,
} from "@/lib/financial-engine/financial-engine-input";
import {
  getFinancialEngineSnapshotRepository,
  type FinancialEngineSnapshotRepository,
} from "@/lib/financial-engine/financial-engine-snapshot-repository";
import {
  getFinancialSnapshotRepository,
  type FinancialSnapshotRepository,
} from "@/lib/financial-snapshots/financial-snapshot-repository";
import {
  manualSectionDomainSchemas,
  type ManualRecord,
  type ManualSection,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import {
  getUserProfileRepository,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";

export type DashboardDependencies = Readonly<{
  engineRepository?: FinancialEngineSnapshotRepository;
  manifestRepository?: FinancialSnapshotRepository;
  now?: () => Date;
  profileRepository?: UserProfileRepository;
  sourceRepositories?: Readonly<
    Partial<Record<ManualSection, ManualRecordRepository>>
  >;
}>;

function compareRecords(
  records: readonly ManualRecord[],
  manifestRecords: readonly Readonly<{
    id: string;
    updatedAt: Date;
    version: number;
  }>[],
): boolean {
  if (records.length !== manifestRecords.length) {
    return false;
  }

  return records.every((record, index) => {
    const manifestRecord = manifestRecords[index];
    return (
      manifestRecord !== undefined &&
      record.id === manifestRecord.id &&
      record.version === manifestRecord.version &&
      record.updatedAt.getTime() === manifestRecord.updatedAt.getTime()
    );
  });
}

function goalViews(records: readonly ManualRecord[]): readonly DashboardGoalView[] {
  return records.map((record) => {
    const fields = manualSectionDomainSchemas.goals.parse(record.fields);
    return {
      currentValue: serializeMoney(fields.currentValue),
      id: record.id,
      priority: fields.priority,
      targetAmount: serializeMoney(fields.targetAmount),
      targetDate: fields.targetDate,
      title: fields.title,
      type: fields.type,
    };
  }).sort(
    (left, right) =>
      left.priority - right.priority || left.title.localeCompare(right.title),
  );
}

function eventView(point: FinancialTimelinePoint): DashboardEventView | null {
  if (point.kind === "margin_boundary") {
    return null;
  }
  if (point.source === "policy") {
    throw new RangeError("A financial event cannot use the policy source.");
  }

  return {
    amount: serializeMoney(point.amount),
    calendarDate: point.calendarDate,
    confirmedBalance: serializeMoney(point.confirmedBalance),
    eventId: point.eventId,
    expectedBalance: serializeMoney(point.expectedBalance),
    kind: point.kind,
    safeCapacity: serializeMoney(point.safeCapacity),
    safetyMargin: serializeMoney(point.safetyMargin),
    source: point.source,
  };
}

function eventsWithin(
  timeline: readonly FinancialTimelinePoint[],
  start: string,
  days: number,
): DashboardTimelineWindowView {
  const end = addCalendarDays(start, days - 1);
  const events = timeline.flatMap((point) => {
    if (point.calendarDate < start || point.calendarDate > end) {
      return [];
    }
    const view = eventView(point);
    return view === null ? [] : [view];
  });

  return {
    events: events.slice(0, 100),
    truncated: events.length > 100,
  };
}

function limitingPoint(
  availableCash: Money,
  safetyMargin: Money,
  evaluationDate: string,
  timeline: readonly FinancialTimelinePoint[],
): DashboardLimitingPointView {
  let minimum = subtractMoney(availableCash, safetyMargin);
  let limiting: FinancialTimelinePoint | null = null;

  for (const point of timeline) {
    if (point.safeCapacity.amountMinor < minimum.amountMinor) {
      minimum = point.safeCapacity;
      limiting = point;
    }
  }

  return limiting === null
    ? {
        calendarDate: evaluationDate,
        kind: "current_liquidity",
        safeCapacity: serializeMoney(minimum),
        source: "policy",
      }
    : {
        calendarDate: limiting.calendarDate,
        kind: limiting.kind,
        safeCapacity: serializeMoney(limiting.safeCapacity),
        source: limiting.source,
      };
}

function alertCodes(
  safeToSpend: Money,
  shortfall: Money,
  uncertainIncome: Money,
  utilizationBasisPoints: string | null,
): readonly DashboardAlertCode[] {
  const alerts: DashboardAlertCode[] = [];

  if (shortfall.amountMinor > 0n) {
    alerts.push("projected_shortfall");
  } else if (safeToSpend.amountMinor === 0n) {
    alerts.push("no_safe_to_spend");
  }
  if (
    utilizationBasisPoints !== null &&
    BigInt(utilizationBasisPoints) >= 9_000n
  ) {
    alerts.push("high_credit_utilization");
  }
  if (uncertainIncome.amountMinor > 0n) {
    alerts.push("uncertain_income");
  }

  return alerts;
}

async function repositoryFor(
  section: ManualSection,
  dependencies?: DashboardDependencies,
): Promise<ManualRecordRepository> {
  return (
    dependencies?.sourceRepositories?.[section] ??
    (await getManualRecordRepository(section))
  );
}

export async function loadDashboard(
  actor: Actor,
  dependencies?: DashboardDependencies,
): Promise<DashboardView> {
  const profileRepository =
    dependencies?.profileRepository ?? (await getUserProfileRepository());
  const profile = await profileRepository.findForActor(actor);
  const goalsRepository = await repositoryFor("goals", dependencies);
  const allGoals = goalViews(await goalsRepository.listAllForActor(actor));
  const goals = allGoals.slice(0, 20);
  const goalsTruncated = allGoals.length > 20;

  if (profile === null) {
    return { goals, goalsTruncated, kind: "empty" };
  }

  const engineRepository =
    dependencies?.engineRepository ??
    (await getFinancialEngineSnapshotRepository());
  const page = await engineRepository.listForActor(actor, { limit: 2 });
  const snapshot = page.snapshots[0];
  if (snapshot === undefined) {
    return { goals, goalsTruncated, kind: "empty" };
  }

  const manifestRepository =
    dependencies?.manifestRepository ??
    (await getFinancialSnapshotRepository());
  const manifest = await manifestRepository.findForActor(
    actor,
    snapshot.sourceManifestId,
  );
  const freshnessReasons: DashboardFreshnessReason[] = [];

  if (manifest === null) {
    freshnessReasons.push("manifest_unavailable");
  } else {
    const manifestBySection = new Map(
      manifest.sources.map((source) => [source.section, source] as const),
    );
    const changed = await Promise.all(
      financialEngineSourceSections.map(async (section) => {
        const repository = await repositoryFor(section, dependencies);
        const records = await repository.listAllForActor(actor);
        const source = manifestBySection.get(section);
        return (
          source === undefined || !compareRecords(records, source.records)
        );
      }),
    );
    if (changed.some(Boolean)) {
      freshnessReasons.push("source_changed");
    }
  }

  if (profile.updatedAt.getTime() > snapshot.calculatedAt.getTime()) {
    freshnessReasons.push("profile_changed");
  }
  const now = (dependencies?.now ?? (() => new Date()))();
  const currentCalendarDate = calendarDateAtInstant(
    now.toISOString(),
    profile.fields.timeZone,
  );
  if (currentCalendarDate !== snapshot.result.evaluationDate) {
    freshnessReasons.push("new_calendar_day");
  }

  const previous = page.snapshots[1];
  const changeAmount =
    previous !== undefined &&
    previous.result.safeToSpend.currency === snapshot.result.safeToSpend.currency
      ? subtractMoney(
          snapshot.result.safeToSpend,
          previous.result.safeToSpend,
        )
      : null;

  return {
    alerts: alertCodes(
      snapshot.result.safeToSpend,
      snapshot.result.shortfall,
      snapshot.result.totals.uncertainIncome,
      snapshot.result.credit.utilizationBasisPoints,
    ),
    calculatedAt: snapshot.calculatedAt.toISOString(),
    change:
      changeAmount === null
        ? null
        : {
            amount: serializeMoney(changeAmount),
            direction:
              changeAmount.amountMinor > 0n
                ? "up"
                : changeAmount.amountMinor < 0n
                  ? "down"
                  : "same",
          },
    credit: {
      limit: serializeMoney(snapshot.result.credit.limit),
      used: serializeMoney(snapshot.result.credit.used),
      utilizationBasisPoints:
        snapshot.result.credit.utilizationBasisPoints,
    },
    evaluationDate: snapshot.result.evaluationDate,
    freshnessReasons,
    goals,
    goalsTruncated,
    horizonDays: snapshot.result.horizonDays,
    horizonEndDate: snapshot.result.horizonEndDate,
    kind: "ready",
    limitingPoint: limitingPoint(
      snapshot.result.availableCash,
      snapshot.result.safetyMarginAtEvaluation,
      snapshot.result.evaluationDate,
      snapshot.result.timeline,
    ),
    monthly: {
      actualExpenses: serializeMoney(snapshot.result.monthly.actualExpenses),
      actualIncome: serializeMoney(snapshot.result.monthly.actualIncome),
      actualNetCashFlow: serializeMoney(
        snapshot.result.monthly.actualNetCashFlow,
      ),
      calendarMonth: snapshot.result.monthly.calendarMonth,
      confirmedForecastIncome: serializeMoney(
        snapshot.result.monthly.confirmedForecastIncome,
      ),
      scheduledObligations: serializeMoney(
        snapshot.result.monthly.scheduledObligations,
      ),
      uncertainForecastIncome: serializeMoney(
        snapshot.result.monthly.uncertainForecastIncome,
      ),
    },
    safeToSpend: serializeMoney(snapshot.result.safeToSpend),
    safetyMargin: serializeMoney(
      snapshot.result.safetyMarginAtEvaluation,
    ),
    snapshotId: snapshot.id,
    stale: freshnessReasons.length > 0,
    summary: {
      accountBalance: serializeMoney(snapshot.result.accountBalance),
      availableCash: serializeMoney(snapshot.result.availableCash),
      debtBalance: serializeMoney(snapshot.result.debtBalance),
      futureConfirmedBalance: serializeMoney(
        snapshot.result.futureConfirmedBalance,
      ),
      futureExpectedBalance: serializeMoney(
        snapshot.result.futureExpectedBalance,
      ),
      savingsBalance: serializeMoney(snapshot.result.savingsBalance),
      shortfall: serializeMoney(snapshot.result.shortfall),
    },
    timeZone: profile.fields.timeZone,
    timeline: {
      fourteenDays: eventsWithin(
        snapshot.result.timeline,
        snapshot.result.evaluationDate,
        14,
      ),
      sevenDays: eventsWithin(
        snapshot.result.timeline,
        snapshot.result.evaluationDate,
        7,
      ),
      thirtyDays: eventsWithin(
        snapshot.result.timeline,
        snapshot.result.evaluationDate,
        30,
      ),
    },
  };
}
