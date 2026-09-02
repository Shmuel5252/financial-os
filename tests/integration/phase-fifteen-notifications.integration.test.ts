import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import type { BudgetView } from "@/lib/budgets/budget";
import type { ForecastCenterView } from "@/lib/forecasts/forecast";
import type { GoalCenterView } from "@/lib/goals/goal";
import { ConflictError } from "@/lib/errors/application-error";
import { householdRepositoryForDatabase } from "@/lib/households/household-repository";
import type {
  NotificationEmailCommand,
  NotificationEmailDeliveryStatus,
  NotificationEmailProvider,
} from "@/lib/notifications/notification-email-provider";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import {
  evaluateAndDeliverNotifications,
  loadNotificationCenter,
  saveNotificationPreferences,
  updateNotificationState,
  type NotificationDependencies,
} from "@/lib/notifications/notification-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { loadProfile, saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

class CapturingProvider implements NotificationEmailProvider {
  readonly commands: NotificationEmailCommand[] = [];
  failNext = false;
  status: NotificationEmailDeliveryStatus = "accepted";

  async send(command: NotificationEmailCommand) {
    this.commands.push(command);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("raw provider details must not escape");
    }
    return { providerMessageId: `provider-${this.commands.length}` };
  }

  async getDeliveryStatus() { return this.status; }
}

describeWithMongo("Phase 15 notification persistence, consent, delivery, and isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured");
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const thirdActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const provider = new CapturingProvider();
  let database: Db;
  let repository: ReturnType<typeof notificationRepositoryForDatabase>;
  let profileRepository: ReturnType<typeof profileRepositoryForDatabase>;
  let now = new Date("2026-09-02T09:00:00.000Z");
  let forecastReference = "forecast-1";
  let forecastVersion = "forecast/1";
  let confirmedBalance = 99n;
  let safetyMargin = 100n;
  const freshness: "FRESH" | "STALE" = "FRESH";
  const materialObligations = 0;

  function forecastCenter(): ForecastCenterView {
    return {
      currency: "ILS",
      defaultHorizonDays: 30,
      forecasts: [{
        calculatedAt: "2026-09-02T08:00:00.000Z",
        dataFreshness: freshness,
        engineVersion: "forecast/1.0.0",
        id: forecastReference,
        materialObligations: Array.from({ length: materialObligations }, () => ({ amount: { amountMinor: "1", currency: "ILS" }, calendarDate: "2026-09-03", provenanceAlias: "מקור" })),
        policyVersion: forecastVersion,
        timeline: [{
          amount: { amountMinor: "0", currency: "ILS" },
          calendarDate: "2026-09-03",
          confirmedBalance: { amountMinor: confirmedBalance.toString(), currency: "ILS" },
          eventId: "boundary",
          projectedBalance: { amountMinor: confirmedBalance.toString(), currency: "ILS" },
          safetyMargin: { amountMinor: safetyMargin.toString(), currency: "ILS" },
          truthStatus: "confirmed",
          type: "margin_boundary",
        }],
      } as unknown as ForecastCenterView["forecasts"][number]],
      scenarios: [],
      supportedHorizons: [7, 30, 60, 90],
    };
  }

  function budgetView(): BudgetView {
    return {
      calculation: {
        allocated: { amountMinor: "0", currency: "ILS" }, calendarMonth: "2026-09", categorizedForecastSpent: { amountMinor: "0", currency: "ILS" }, categorizedSpent: { amountMinor: "0", currency: "ILS" }, confirmedIncome: { amountMinor: "0", currency: "ILS" }, lines: [], totalForecastSpent: { amountMinor: "0", currency: "ILS" }, totalSpent: { amountMinor: "0", currency: "ILS" }, unallocated: { amountMinor: "0", currency: "ILS" }, uncategorizedForecastSpent: { amountMinor: "0", currency: "ILS" }, uncategorizedSpent: { amountMinor: "0", currency: "ILS" }, uncertainIncome: { amountMinor: "0", currency: "ILS" },
      },
      activities: [], categories: [], coreForecast: null, currentCalendarMonth: "2026-09",
      period: { allocations: [], calendarMonth: "2026-09", carryIn: [], closedAt: null, closingSnapshot: null, currency: "ILS", id: null, status: "open", version: null },
    };
  }

  function goalCenter(): GoalCenterView {
    return { categories: [], currency: "ILS", goals: [], sources: { accounts: [], cards: [], liabilities: [], savings: [] } };
  }

  function dependencies(): NotificationDependencies {
    return {
      applicationOrigin: "http://localhost:3001",
      budgetLoader: async () => budgetView(),
      emailCapabilityReady: true,
      forecastLoader: async () => forecastCenter(),
      goalLoader: async () => goalCenter(),
      now: () => now,
      profileLoader: (actor) => loadProfile(actor, { repository: profileRepository }),
      provider,
      repository,
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    repository = notificationRepositoryForDatabase(database, () => now);
    profileRepository = profileRepositoryForDatabase(database);
    await Promise.all([repository.ensureIndexes(), profileRepository.ensureIndexes()]);
    await database.collection("authUsers").insertMany([
      { _id: new ObjectId(firstActor.userId), email: "first@example.com" },
      { _id: new ObjectId(secondActor.userId), email: "second@example.com" },
      { _id: new ObjectId(thirdActor.userId), email: "third@example.com" },
    ]);
    for (const [actor, name] of [[firstActor, "ראשון"], [secondActor, "שני"], [thirdActor, "שלישי"]] as const) {
      await saveProfile(actor, { countryCode: "IL", displayName: name, expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profileRepository });
    }
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("defaults email off, creates in-app evidence, and deduplicates unchanged evaluation", async () => {
    const initial = await loadNotificationCenter(firstActor, dependencies());
    expect(initial.preferences).toMatchObject({ emailEnabled: false, inAppEnabled: true, version: null });
    const first = await evaluateAndDeliverNotifications(firstActor, dependencies());
    const retry = await evaluateAndDeliverNotifications(firstActor, dependencies());
    expect(first.notifications).toHaveLength(1);
    expect(retry.notifications).toHaveLength(1);
    expect(first.notifications[0]).toMatchObject({ email: { state: "not_requested" }, severity: "WARNING" });
    expect(provider.commands).toHaveLength(0);
  });

  it("uses explicit opt-in, server-derived recipient, accepted/delivered truth, and cooldown", async () => {
    await saveNotificationPreferences(firstActor, {
      emailEnabled: true, expectedVersion: null, inAppEnabled: true,
      quietHours: { enabled: true, endHour: 8, startHour: 22 },
    }, dependencies());
    forecastReference = "forecast-cooldown";
    forecastVersion = "forecast/2";
    let center = await evaluateAndDeliverNotifications(firstActor, dependencies());
    expect(provider.commands).toHaveLength(1);
    expect(provider.commands[0]?.recipient).toBe("first@example.com");
    expect(JSON.stringify(provider.commands[0])).not.toMatch(/99|100|userId|merchant|second@example\.com/);
    expect(center.notifications.find((item) => item.email.state === "sent")).toBeDefined();

    provider.status = "delivered";
    center = await evaluateAndDeliverNotifications(firstActor, dependencies());
    expect(center.notifications.find((item) => item.email.state === "delivered")).toBeDefined();
    expect(provider.commands).toHaveLength(1);

    forecastVersion = "forecast/3";
    confirmedBalance = 98n;
    center = await evaluateAndDeliverNotifications(firstActor, dependencies());
    expect(center.notifications.find((item) => item.email.state === "deferred")).toBeDefined();
    expect(provider.commands).toHaveLength(1);
  });

  it("defers non-critical email in quiet hours and revocation immediately cancels the queue", async () => {
    now = new Date("2026-09-02T20:30:00.000Z"); // 23:30 Asia/Jerusalem
    forecastReference = "forecast-quiet";
    forecastVersion = "forecast/quiet";
    confirmedBalance = 90n;
    let center = await evaluateAndDeliverNotifications(firstActor, dependencies());
    const deferred = center.notifications.find((item) => item.trigger === "forecast_below_safety_margin" && item.email.state === "deferred");
    expect(deferred?.email.notBeforeAt).toBe("2026-09-03T05:00:00.000Z");
    center = await saveNotificationPreferences(firstActor, {
      emailEnabled: false, expectedVersion: center.preferences.version, inAppEnabled: true,
      quietHours: { enabled: true, endHour: 8, startHour: 22 },
    }, dependencies());
    expect(center.notifications.find((item) => item.id === deferred?.id)?.email.state).toBe("not_requested");
  });

  it("permits only confirmed-shortfall critical bypass and retries without duplicate logical records", async () => {
    let center = await saveNotificationPreferences(firstActor, {
      emailEnabled: true, expectedVersion: (await loadNotificationCenter(firstActor, dependencies())).preferences.version,
      inAppEnabled: true, quietHours: { enabled: true, endHour: 8, startHour: 22 },
    }, dependencies());
    forecastReference = "forecast-critical";
    forecastVersion = "forecast/critical";
    confirmedBalance = -1n;
    safetyMargin = 0n;
    provider.status = "accepted";
    provider.failNext = true;
    const beforeCount = center.notifications.length;
    center = await evaluateAndDeliverNotifications(firstActor, dependencies());
    const failed = center.notifications.find((item) => item.trigger === "forecast_confirmed_shortfall" && item.email.state === "failed");
    expect(failed).toBeDefined();
    expect(provider.commands.at(-1)?.recipient).toBe("first@example.com");
    const retryKey = provider.commands.at(-1)?.idempotencyKey;

    now = new Date(now.getTime() + 5 * 60_000);
    center = await evaluateAndDeliverNotifications(firstActor, dependencies());
    expect(center.notifications.length).toBe(beforeCount + 1);
    expect(provider.commands.at(-1)?.idempotencyKey).toBe(retryKey);
    expect(center.notifications.find((item) => item.id === failed?.id)?.email).toMatchObject({ attempts: 2, state: "sent" });
  });

  it("keeps direct IDs, same-household and cross-household users isolated without mutating truth", async () => {
    const household = householdRepositoryForDatabase(database, () => now);
    await household.ensureIndexes();
    const created = await household.createHouseholdForActor(firstActor, "משק בדיקה", randomUUID());
    const invitation = await household.createInvitation({ expiresAt: new Date(now.getTime() + 86_400_000), householdId: created.id, inviteeEmailHash: "a".repeat(64), inviteeHint: "s***@example.com", invitedByUserId: firstActor.userId, tokenHash: "b".repeat(64) });
    await household.activateMembership(invitation, secondActor.userId, "שני");
    await household.createHouseholdForActor(thirdActor, "משק נפרד", randomUUID());
    const firstCenter = await loadNotificationCenter(firstActor, dependencies());
    expect((await loadNotificationCenter(secondActor, dependencies())).notifications).toHaveLength(0);
    await expect(updateNotificationState(secondActor, {
      expectedVersion: firstCenter.notifications[0]!.version,
      id: firstCenter.notifications[0]!.id,
      inAppState: "read",
    }, dependencies())).rejects.toMatchObject({ name: "NotFoundError" });

    const thirdCenter = await evaluateAndDeliverNotifications(thirdActor, dependencies());
    expect(thirdCenter.notifications).toHaveLength(1);
    await expect(updateNotificationState(firstActor, {
      expectedVersion: thirdCenter.notifications[0]!.version,
      id: thirdCenter.notifications[0]!.id,
      inAppState: "read",
    }, dependencies())).rejects.toMatchObject({ name: "NotFoundError" });

    const financialCollections = ["accounts", "transactions", "budgetPeriods", "financialSnapshots", "goalProgress", "debtStrategyScenarios", "netWorthItems", "aiConversations", "bankConnections"];
    const before = Object.fromEntries(await Promise.all(financialCollections.map(async (name) => [name, await database.collection(name).countDocuments({})])));
    forecastReference = "forecast-nonmutation";
    forecastVersion = "forecast/nonmutation";
    confirmedBalance = 99n;
    safetyMargin = 100n;
    await evaluateAndDeliverNotifications(firstActor, dependencies());
    const after = Object.fromEntries(await Promise.all(financialCollections.map(async (name) => [name, await database.collection(name).countDocuments({})])));
    expect(after).toEqual(before);
    expect(after.bankConnections).toBe(0);
    const raw = await database.collection("notifications").findOne({ userId: new ObjectId(firstActor.userId) });
    expect(JSON.stringify(raw)).not.toMatch(/amountMinor|confirmedBalance|safetyMargin|merchant|second@example\.com|third@example\.com/);
  });

  it("continues with available deterministic sources when a budget period is not yet evaluable", async () => {
    forecastReference = "forecast-partial-sources";
    forecastVersion = "forecast/partial";
    confirmedBalance = 99n;
    safetyMargin = 100n;
    const center = await evaluateAndDeliverNotifications(secondActor, {
      ...dependencies(),
      budgetLoader: async () => { throw new ConflictError("The preceding budget period is still open."); },
    });
    expect(center.notifications).toHaveLength(1);
    expect(center.notifications[0]).toMatchObject({
      email: { state: "not_requested" },
      trigger: "forecast_below_safety_margin",
    });
  });
});
