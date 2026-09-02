import "server-only";

import { randomUUID } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import { loadBudgetView } from "@/lib/budgets/budget-service";
import { getConfigurationStatus, getServerEnv } from "@/lib/config/server-env";
import { calendarDateAtInstant, calendarMonth } from "@/lib/domain/financial-engine/financial-calendar";
import {
  NOTIFICATION_COOLDOWN_MS,
  evaluateNotificationFacts,
  isInQuietHours,
  nextQuietHoursEnd,
  type NotificationSourceFact,
} from "@/lib/domain/notifications/notification-policy";
import { ConflictError, InputValidationError } from "@/lib/errors/application-error";
import { loadForecastCenter } from "@/lib/forecasts/forecast-service";
import type { ForecastCenterView } from "@/lib/forecasts/forecast";
import { loadGoalCenterView } from "@/lib/goals/goal-service";
import type { GoalCenterView } from "@/lib/goals/goal";
import { createConfiguredResendProvider, ResendProviderError } from "@/lib/adapters/resend/resend-notification-email-provider";
import { buildNotificationEmailCommand } from "@/lib/notifications/notification-email-content";
import type { NotificationEmailProvider } from "@/lib/notifications/notification-email-provider";
import {
  getNotificationRepository,
  type NotificationRepository,
} from "@/lib/notifications/notification-repository";
import {
  defaultNotificationPreference,
  toNotificationPreferenceView,
  toNotificationView,
  type NotificationCenterView,
  type NotificationPreference,
  type NotificationRecord,
  type UpdateNotificationCommand,
  type UpdateNotificationPreferencesCommand,
} from "@/lib/notifications/notification";
import { loadProfile } from "@/lib/profiles/profile-service";
import type { UserProfile } from "@/lib/profiles/profile";

const MAX_DELIVERIES_PER_RUN = 20;
const RETRY_DELAY_MS = 5 * 60_000;

export type NotificationDependencies = Readonly<{
  applicationOrigin?: string;
  budgetLoader?: typeof loadBudgetView;
  forecastLoader?: (actor: Actor) => Promise<ForecastCenterView>;
  goalLoader?: (actor: Actor) => Promise<GoalCenterView>;
  emailCapabilityReady?: boolean;
  now?: () => Date;
  profileLoader?: (actor: Actor) => Promise<UserProfile | null>;
  provider?: NotificationEmailProvider;
  repository?: NotificationRepository;
}>;

async function resolveRepository(dependencies?: NotificationDependencies): Promise<NotificationRepository> {
  return dependencies?.repository ?? getNotificationRepository();
}

function effectivePreference(preference: NotificationPreference | null) {
  return preference ?? {
    createdAt: new Date(0),
    emailEnabled: defaultNotificationPreference.emailEnabled,
    inAppEnabled: defaultNotificationPreference.inAppEnabled,
    quietHours: defaultNotificationPreference.quietHours,
    updatedAt: new Date(0),
    version: 0,
  };
}

function goalStatus(value: string): "completed" | "other" | "regressed" | "target_reached_pending_confirmation" {
  return value === "completed" || value === "regressed" || value === "target_reached_pending_confirmation"
    ? value : "other";
}

async function loadSourceFacts(
  actor: Actor,
  profile: UserProfile,
  now: Date,
  dependencies?: NotificationDependencies,
): Promise<readonly NotificationSourceFact[]> {
  const currentMonth = calendarMonth(calendarDateAtInstant(now.toISOString(), profile.fields.timeZone));
  const [forecastResult, budgetResult, goalResult] = await Promise.allSettled([
    (dependencies?.forecastLoader ?? loadForecastCenter)(actor),
    (dependencies?.budgetLoader ?? loadBudgetView)(actor, currentMonth),
    (dependencies?.goalLoader ?? loadGoalCenterView)(actor),
  ]);
  for (const result of [forecastResult, budgetResult, goalResult]) {
    if (result.status === "rejected" && !(result.reason instanceof ConflictError) && !(result.reason instanceof InputValidationError)) {
      throw result.reason;
    }
  }
  const facts: NotificationSourceFact[] = [];
  const forecast = forecastResult.status === "fulfilled" ? forecastResult.value.forecasts[0] : undefined;
  if (forecast !== undefined) {
    facts.push({
      dataFreshness: forecast.dataFreshness,
      kind: "forecast",
      materialObligationCount: forecast.materialObligations.length,
      sourceReference: forecast.id,
      sourceVersion: [forecast.engineVersion, forecast.policyVersion, forecast.calculatedAt].join("/"),
      timeline: forecast.timeline.map((point) => ({
        calendarDate: point.calendarDate,
        confirmedBalanceMinor: BigInt(point.confirmedBalance.amountMinor),
        safetyMarginMinor: BigInt(point.safetyMargin.amountMinor),
      })),
    });
  }
  if (budgetResult.status === "fulfilled") {
    const budget = budgetResult.value;
    facts.push({
      kind: "budget",
      sourceReference: budget.period.id ?? `period:${budget.currentCalendarMonth}`,
      sourceVersion: `${budget.period.version ?? 0}/${budget.calculation.calendarMonth}`,
      unallocatedMinor: BigInt(budget.calculation.unallocated.amountMinor),
    });
  }
  const goals = goalResult.status === "fulfilled" ? goalResult.value.goals : [];
  for (const goal of goals) {
    if (goal.latestProgress !== null && goal.latestProgress.milestonesCrossed.length > 0) {
      facts.push({
        kind: "goal_progress",
        milestonesCrossed: goal.latestProgress.milestonesCrossed,
        sourceReference: goal.latestProgress.id,
        sourceVersion: [goal.latestProgress.engineVersion, goal.latestProgress.policyVersion, goal.latestProgress.evaluatedAt].join("/"),
        status: goalStatus(goal.latestProgress.result.status),
      });
    }
  }
  return facts;
}

async function emailDisposition(
  actor: Actor,
  repository: NotificationRepository,
  preference: ReturnType<typeof effectivePreference>,
  candidate: ReturnType<typeof evaluateNotificationFacts>[number],
  profile: UserProfile,
  now: Date,
) {
  if (!preference.emailEnabled) return { notBeforeAt: null, state: "not_requested" as const };
  if (!candidate.allowQuietHoursBypass && isInQuietHours(now, profile.fields.timeZone, preference.quietHours)) {
    return { notBeforeAt: nextQuietHoursEnd(now, profile.fields.timeZone, preference.quietHours), state: "deferred" as const };
  }
  const recent = await repository.findRecentAcceptedForCooldown(
    actor,
    candidate.cooldownKey,
    new Date(now.getTime() - NOTIFICATION_COOLDOWN_MS),
  );
  if (recent?.email.acceptedAt !== null && recent?.email.acceptedAt !== undefined) {
    return { notBeforeAt: new Date(recent.email.acceptedAt.getTime() + NOTIFICATION_COOLDOWN_MS), state: "deferred" as const };
  }
  return { notBeforeAt: null, state: "pending" as const };
}

function providerFor(dependencies?: NotificationDependencies): NotificationEmailProvider {
  return dependencies?.provider ?? createConfiguredResendProvider();
}

async function processDueEmails(
  actor: Actor,
  repository: NotificationRepository,
  preference: ReturnType<typeof effectivePreference>,
  now: Date,
  dependencies?: NotificationDependencies,
): Promise<void> {
  if (!preference.emailEnabled) {
    await repository.revokeQueuedEmailsForActor(actor);
    return;
  }
  const recipient = await repository.findRecipientEmailForActor(actor);
  for (let count = 0; count < MAX_DELIVERIES_PER_RUN; count += 1) {
    const notification = await repository.claimReadyEmailForActor(actor);
    if (notification === null) break;
    if (recipient === null) {
      await repository.markEmailFailed(actor, notification, "MISSING_RECIPIENT", null);
      continue;
    }
    try {
      const origin = dependencies?.applicationOrigin ?? getServerEnv().AUTH_URL;
      if (origin === undefined) throw new InputValidationError([{ field: "AUTH_URL", message: "An application origin is required." }]);
      const accepted = await providerFor(dependencies).send(buildNotificationEmailCommand({
        applicationOrigin: origin,
        idempotencyKey: `financial-os-notification-${notification.candidate.deduplicationKey}`,
        recipient,
        requestId: randomUUID(),
      }));
      await repository.markEmailAccepted(actor, notification, accepted.providerMessageId);
    } catch (error) {
      const category = error instanceof ResendProviderError ? error.providerCategory : "SAFE_FAILURE";
      const retryAt = notification.email.attempts >= 3 ? null : new Date(now.getTime() + RETRY_DELAY_MS);
      await repository.markEmailFailed(actor, notification, category, retryAt);
    }
  }
}

async function refreshProviderStatuses(
  actor: Actor,
  repository: NotificationRepository,
  dependencies?: NotificationDependencies,
): Promise<void> {
  let provider: NotificationEmailProvider | null = null;
  for (const notification of await repository.listSentForActor(actor)) {
    if (notification.email.providerMessageId === null) continue;
    try {
      provider ??= providerFor(dependencies);
      const status = await provider.getDeliveryStatus(notification.email.providerMessageId);
      if (status === "delivered") await repository.markEmailDelivered(actor, notification);
      else if (status === "failed") await repository.markEmailFailed(actor, notification, "PROVIDER_FINAL_FAILURE", null);
    } catch {
      // A status read is advisory. The accepted state remains truthful and retryable later.
    }
  }
}

export async function loadNotificationCenter(
  actor: Actor,
  dependencies?: NotificationDependencies,
): Promise<NotificationCenterView> {
  const repository = await resolveRepository(dependencies);
  const [preference, notifications] = await Promise.all([
    repository.findPreferencesForActor(actor),
    repository.listForActor(actor),
  ]);
  return {
    emailCapabilityReady: dependencies?.emailCapabilityReady ?? getConfigurationStatus().futureAdapters.resendConfigured,
    notifications: notifications.map(toNotificationView),
    phase9ProviderTriggersAvailable: false,
    preferences: toNotificationPreferenceView(preference),
  };
}

export async function saveNotificationPreferences(
  actor: Actor,
  command: UpdateNotificationPreferencesCommand,
  dependencies?: NotificationDependencies,
): Promise<NotificationCenterView> {
  const repository = await resolveRepository(dependencies);
  const previous = await repository.findPreferencesForActor(actor);
  const saved = await repository.savePreferencesForActor(actor, command);
  if (previous?.emailEnabled === true && saved.emailEnabled === false) {
    await repository.revokeQueuedEmailsForActor(actor);
  }
  return loadNotificationCenter(actor, { ...dependencies, repository });
}

export async function evaluateAndDeliverNotifications(
  actor: Actor,
  dependencies?: NotificationDependencies,
): Promise<NotificationCenterView> {
  const repository = await resolveRepository(dependencies);
  const now = (dependencies?.now ?? (() => new Date()))();
  const profile = await (dependencies?.profileLoader ?? loadProfile)(actor);
  if (profile === null) throw new InputValidationError([{ field: "profile", message: "A profile is required for notifications." }]);
  const preference = effectivePreference(await repository.findPreferencesForActor(actor));
  const facts = await loadSourceFacts(actor, profile, now, dependencies);
  for (const candidate of evaluateNotificationFacts(facts)) {
    if (!preference.inAppEnabled && !preference.emailEnabled) continue;
    await repository.createForActor(
      actor,
      candidate,
      await emailDisposition(actor, repository, preference, candidate, profile, now),
    );
  }
  await processDueEmails(actor, repository, preference, now, dependencies);
  await refreshProviderStatuses(actor, repository, dependencies);
  return loadNotificationCenter(actor, { ...dependencies, repository });
}

export async function updateNotificationState(
  actor: Actor,
  command: UpdateNotificationCommand,
  dependencies?: NotificationDependencies,
): Promise<NotificationRecord> {
  return (await resolveRepository(dependencies)).markInAppStateForActor(
    actor,
    command.id,
    command.expectedVersion,
    command.inAppState,
  );
}
