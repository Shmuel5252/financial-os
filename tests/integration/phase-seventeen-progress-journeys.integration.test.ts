import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { progressEventDraft } from "@/lib/domain/progress-journeys/progress-journey-engine";
import { ConflictError } from "@/lib/errors/application-error";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import { evaluateAndDeliverNotifications } from "@/lib/notifications/notification-service";
import { toProgressJourneyEventView, type ProgressObservation } from "@/lib/progress-journeys/progress-journey";
import { progressJourneyRepositoryForDatabase } from "@/lib/progress-journeys/progress-journey-repository";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

function observation(version: string, outcome: ProgressObservation["outcome"] = "achieved"): ProgressObservation {
  return {
    dimension: "within_budget",
    evaluationDate: "2026-08-31",
    origin: "backfill",
    outcome,
    period: { kind: "month", value: "2026-08" },
    ruleId: "closed-budget-without-deficit",
    seriesKey: "personal-budget",
    sourceReferences: [{ kind: "budget_period", sourceId: new ObjectId().toHexString(), version }],
    subjectKey: "2026-08",
    subjectLabel: "2026-08",
    value: null,
  };
}

describeWithMongo("Phase 17 immutable progress evidence and owner isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured");
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  let database: Db;
  let repository: ReturnType<typeof progressJourneyRepositoryForDatabase>;
  let notificationRepository: ReturnType<typeof notificationRepositoryForDatabase>;
  let now = new Date("2026-09-02T12:00:00.000Z");

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    repository = progressJourneyRepositoryForDatabase(database, () => now);
    notificationRepository = notificationRepositoryForDatabase(database, () => now);
    await Promise.all([repository.ensureIndexes(), notificationRepository.ensureIndexes()]);
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("deduplicates identical evidence and appends a correction without rewriting history", async () => {
    const firstObservation = observation("1");
    const first = await repository.appendForActor(firstActor, progressEventDraft(firstObservation, null));
    const retry = await repository.appendForActor(firstActor, progressEventDraft(firstObservation, null));
    expect(retry.id).toBe(first.id);

    now = new Date("2026-09-03T12:00:00.000Z");
    const correctedObservation = { ...firstObservation, outcome: "not_achieved" as const, sourceReferences: [{ ...firstObservation.sourceReferences[0]!, version: "2" }] };
    const correction = await repository.appendForActor(firstActor, progressEventDraft(correctedObservation, "achieved"));
    expect(correction).toMatchObject({ eventKind: "correction", supersedesId: first.id, outcome: "not_achieved" });
    const events = await repository.listEventsForActor(firstActor);
    expect(events).toHaveLength(2);
    expect(events.map((item) => item.id)).toEqual(expect.arrayContaining([first.id, correction.id]));

    const publicView = toProgressJourneyEventView(correction);
    expect(publicView.sourceReferences[0]).not.toHaveProperty("sourceId");
    const raw = await database.collection("progressJourneyEvents").findOne({ _id: new ObjectId(correction.id) });
    expect(raw?.userId).toEqual(new ObjectId(firstActor.userId));
    expect(raw?.auditTrail).toHaveLength(1);
  });

  it("enforces owner-first reads, direct-key isolation, and per-owner deduplication", async () => {
    const first = (await repository.listEventsForActor(firstActor))[0]!;
    expect(await repository.findLatestForStableKey(secondActor, first.stableKey)).toBeNull();
    expect(await repository.listEventsForActor(secondActor)).toEqual([]);

    const secondObservation = observation("owner-two");
    const second = await repository.appendForActor(secondActor, progressEventDraft(secondObservation, null));
    expect(second.id).not.toBe(first.id);
    expect(await repository.listEventsForActor(secondActor)).toHaveLength(1);
    expect(await repository.listEventsForActor(firstActor)).toHaveLength(2);
  });

  it("stores independent audited preferences with optimistic concurrency", async () => {
    const saved = await repository.savePreferencesForActor(firstActor, {
      celebrationsEnabled: false,
      expectedVersion: null,
      progressNotificationsEnabled: false,
      streaksEnabled: false,
    });
    expect(saved).toMatchObject({ celebrationsEnabled: false, progressNotificationsEnabled: false, streaksEnabled: false, version: 1 });
    await expect(repository.savePreferencesForActor(firstActor, {
      celebrationsEnabled: true,
      expectedVersion: 99,
      progressNotificationsEnabled: true,
      streaksEnabled: true,
    })).rejects.toBeInstanceOf(ConflictError);
    expect(await repository.findPreferencesForActor(secondActor)).toBeNull();
    const raw = await database.collection("progressJourneyPreferences").findOne({ userId: new ObjectId(firstActor.userId) });
    expect(raw?.auditTrail).toHaveLength(1);
  });

  it("creates all required owner-first unique and timeline indexes", async () => {
    const eventIndexes = await database.collection("progressJourneyEvents").indexes();
    const preferenceIndexes = await database.collection("progressJourneyPreferences").indexes();
    expect(eventIndexes.map((item) => item.name)).toEqual(expect.arrayContaining([
      "progress_events_owner_evidence", "progress_events_owner_series", "progress_events_owner_stable_history", "progress_events_owner_timeline",
    ]));
    expect(preferenceIndexes.map((item) => item.name)).toContain("progress_preferences_owner");
  });

  it("keeps progress notifications explicitly opt-in while deterministic critical warnings remain active", async () => {
    const forecast = { forecasts: [{
      calculatedAt: now.toISOString(), dataFreshness: "FRESH", engineVersion: "forecast-v1", id: "forecast-critical",
      materialObligations: [], policyVersion: "forecast-policy-v1", timeline: [{
        calendarDate: "2026-09-03", confirmedBalance: { amountMinor: "-1", currency: "ILS" },
        safetyMargin: { amountMinor: "100", currency: "ILS" },
      }],
    }] };
    const goals = { goals: [{ latestProgress: {
      engineVersion: "goal-v1", evaluatedAt: now.toISOString(), id: "goal-progress-source", milestonesCrossed: [2500],
      policyVersion: "goal-policy-v1", result: { status: "active" },
    } }] };
    const base = {
      budgetLoader: async () => ({ calculation: { unallocated: { amountMinor: "0" } }, currentCalendarMonth: "2026-09", period: { id: null, version: null } }) as never,
      emailCapabilityReady: false,
      forecastLoader: async () => forecast as never,
      goalLoader: async () => goals as never,
      now: () => now,
      profileLoader: async () => ({ fields: { timeZone: "Asia/Jerusalem" } }) as never,
      repository: notificationRepository,
    };
    const optedOut = await evaluateAndDeliverNotifications(firstActor, { ...base, progressNotificationsEnabled: false });
    expect(optedOut.notifications.map((item) => item.trigger)).toContain("forecast_confirmed_shortfall");
    expect(optedOut.notifications.map((item) => item.trigger)).not.toContain("goal_milestone");

    const optedIn = await evaluateAndDeliverNotifications(secondActor, { ...base, progressNotificationsEnabled: true });
    expect(optedIn.notifications.map((item) => item.trigger)).toEqual(expect.arrayContaining(["forecast_confirmed_shortfall", "goal_milestone"]));
    expect(optedIn.notifications.find((item) => item.trigger === "goal_milestone")).toMatchObject({ severity: "INFO" });
    const rawGoal = await database.collection("notifications").findOne({ trigger: "goal_milestone", userId: new ObjectId(secondActor.userId) });
    expect(rawGoal?.allowQuietHoursBypass).toBe(false);
  });
});
