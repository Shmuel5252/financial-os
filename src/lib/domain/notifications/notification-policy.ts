import { createHash } from "node:crypto";

import { ianaTimeZoneSchema } from "@/lib/domain/time/financial-time";

export const NOTIFICATION_POLICY_VERSION = "notification-policy-v1" as const;
export const NOTIFICATION_SEVERITY_VERSION = "notification-severity-v1" as const;
export const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

export type NotificationSeverity = "CRITICAL" | "INFO" | "WARNING";
export type NotificationTrigger =
  | "budget_deficit"
  | "forecast_below_safety_margin"
  | "forecast_confirmed_shortfall"
  | "goal_milestone"
  | "material_obligation_risk"
  | "stale_financial_data";

export type NotificationSourceFact =
  | Readonly<{
      dataFreshness: "FRESH" | "STALE";
      kind: "forecast";
      materialObligationCount: number;
      sourceReference: string;
      sourceVersion: string;
      timeline: readonly Readonly<{
        calendarDate: string;
        confirmedBalanceMinor: bigint;
        safetyMarginMinor: bigint;
      }>[];
    }>
  | Readonly<{
      kind: "budget";
      sourceReference: string;
      sourceVersion: string;
      unallocatedMinor: bigint;
    }>
  | Readonly<{
      kind: "goal_progress";
      milestonesCrossed: readonly number[];
      sourceReference: string;
      sourceVersion: string;
      status: "completed" | "regressed" | "target_reached_pending_confirmation" | "other";
    }>;

export type NotificationCandidate = Readonly<{
  allowQuietHoursBypass: boolean;
  conditionFingerprint: string;
  cooldownKey: string;
  deduplicationKey: string;
  messageKey: NotificationTrigger;
  policyVersion: typeof NOTIFICATION_POLICY_VERSION;
  severity: NotificationSeverity;
  severityVersion: typeof NOTIFICATION_SEVERITY_VERSION;
  sourceKind: NotificationSourceFact["kind"];
  sourceReference: string;
  sourceVersion: string;
  targetPath: "/budgets" | "/forecasts" | "/goals";
  trigger: NotificationTrigger;
}>;

export type QuietHours = Readonly<{
  enabled: boolean;
  endHour: number;
  startHour: number;
}>;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function candidate(
  fact: NotificationSourceFact,
  trigger: NotificationTrigger,
  severity: NotificationSeverity,
  targetPath: NotificationCandidate["targetPath"],
  condition: unknown,
  allowQuietHoursBypass = false,
): NotificationCandidate {
  const conditionFingerprint = hash(JSON.stringify(condition));
  return {
    allowQuietHoursBypass,
    conditionFingerprint,
    cooldownKey: hash([fact.kind, fact.sourceReference, trigger].join("|")),
    deduplicationKey: hash([
      NOTIFICATION_POLICY_VERSION,
      fact.kind,
      fact.sourceReference,
      fact.sourceVersion,
      trigger,
      conditionFingerprint,
    ].join("|")),
    messageKey: trigger,
    policyVersion: NOTIFICATION_POLICY_VERSION,
    severity,
    severityVersion: NOTIFICATION_SEVERITY_VERSION,
    sourceKind: fact.kind,
    sourceReference: fact.sourceReference,
    sourceVersion: fact.sourceVersion,
    targetPath,
    trigger,
  };
}

export function evaluateNotificationFacts(
  facts: readonly NotificationSourceFact[],
): readonly NotificationCandidate[] {
  const result: NotificationCandidate[] = [];
  for (const fact of facts) {
    if (fact.kind === "forecast") {
      const firstBelowZero = fact.timeline.find((point) => point.confirmedBalanceMinor < 0n);
      const firstBelowMargin = fact.timeline.find(
        (point) => point.confirmedBalanceMinor >= 0n && point.confirmedBalanceMinor < point.safetyMarginMinor,
      );
      if (firstBelowZero !== undefined) {
        result.push(candidate(
          fact,
          "forecast_confirmed_shortfall",
          "CRITICAL",
          "/forecasts",
          { calendarDate: firstBelowZero.calendarDate },
          true,
        ));
      } else if (firstBelowMargin !== undefined) {
        result.push(candidate(
          fact,
          "forecast_below_safety_margin",
          "WARNING",
          "/forecasts",
          { calendarDate: firstBelowMargin.calendarDate },
        ));
      }
      if (fact.materialObligationCount > 0 && firstBelowZero === undefined && firstBelowMargin !== undefined) {
        result.push(candidate(
          fact,
          "material_obligation_risk",
          "WARNING",
          "/forecasts",
          {
            calendarDate: firstBelowMargin.calendarDate,
            materialObligationCount: fact.materialObligationCount,
          },
        ));
      }
      if (fact.dataFreshness === "STALE") {
        result.push(candidate(
          fact,
          "stale_financial_data",
          "INFO",
          "/forecasts",
          { freshness: fact.dataFreshness },
        ));
      }
    } else if (fact.kind === "budget" && fact.unallocatedMinor < 0n) {
      result.push(candidate(
        fact,
        "budget_deficit",
        "WARNING",
        "/budgets",
        { deficit: fact.unallocatedMinor.toString() },
      ));
    } else if (fact.kind === "goal_progress" && fact.milestonesCrossed.length > 0) {
      result.push(candidate(
        fact,
        "goal_milestone",
        "INFO",
        "/goals",
        { milestones: [...fact.milestonesCrossed].sort((left, right) => left - right), status: fact.status },
      ));
    }
  }
  return result;
}

function localMinutes(at: Date, timeZone: string): number {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: ianaTimeZoneSchema.parse(timeZone),
  }).formatToParts(at).map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function isInQuietHours(at: Date, timeZone: string, quiet: QuietHours): boolean {
  if (!quiet.enabled || quiet.startHour === quiet.endHour) return false;
  const minute = localMinutes(at, timeZone);
  const start = quiet.startHour * 60;
  const end = quiet.endHour * 60;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function nextQuietHoursEnd(at: Date, timeZone: string, quiet: QuietHours): Date | null {
  if (!isInQuietHours(at, timeZone, quiet)) return null;
  const candidate = new Date(at);
  candidate.setUTCSeconds(0, 0);
  for (let index = 1; index <= 36 * 60; index += 1) {
    const next = new Date(candidate.getTime() + index * 60_000);
    if (!isInQuietHours(next, timeZone, quiet)) return next;
  }
  throw new RangeError("Quiet-hours end could not be resolved.");
}
