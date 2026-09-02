import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  ResendNotificationEmailProvider,
  ResendProviderError,
} from "@/lib/adapters/resend/resend-notification-email-provider";
import { buildNotificationEmailCommand } from "@/lib/notifications/notification-email-content";
import type { Actor } from "@/lib/auth/actor";
import type { BudgetView } from "@/lib/budgets/budget";
import type { ForecastCenterView } from "@/lib/forecasts/forecast";
import type { GoalCenterView } from "@/lib/goals/goal";
import type { NotificationEmailProvider } from "@/lib/notifications/notification-email-provider";
import { notificationRepositoryForDatabase } from "@/lib/notifications/notification-repository";
import { evaluateAndDeliverNotifications, saveNotificationPreferences } from "@/lib/notifications/notification-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { loadProfile, saveProfile } from "@/lib/profiles/profile-service";

const runRealResend =
  process.env.RUN_REAL_RESEND_TESTS === "1" &&
  typeof process.env.RESEND_API_KEY === "string" &&
  process.env.RESEND_API_KEY.length > 0;
const describeWithResend = runRealResend ? describe : describe.skip;

describeWithResend("Phase 15 real Resend official test-mode contract", () => {
  it("accepts one real idempotent privacy-minimized notification request", async () => {
    const provider = new ResendNotificationEmailProvider({
      apiKey: process.env.RESEND_API_KEY!,
      fromEmail: "Financial OS <onboarding@resend.dev>",
    });
    const idempotencyKey = `financial-os-phase15-${randomUUID()}`;
    const command = buildNotificationEmailCommand({
      applicationOrigin: "http://localhost:3001",
      idempotencyKey,
      recipient: `delivered+financial-os-${randomUUID()}@resend.dev`,
      requestId: randomUUID(),
    });
    let first;
    try {
      first = await provider.send(command);
    } catch (error) {
      if (error instanceof ResendProviderError) {
        throw new Error(`Real Resend acceptance failed safely: ${error.providerCategory}`);
      }
      throw error;
    }
    const retry = await provider.send(command);
    expect(first.providerMessageId).toBeTruthy();
    expect(retry.providerMessageId).toBe(first.providerMessageId);
    // The configured key is send-scoped. API acceptance is intentionally not
    // promoted to inbox delivery without separate provider evidence.
  }, 45_000);
});

const runRealService = runRealResend && typeof process.env.MONGODB_TEST_URI === "string";
const describeRealService = runRealService ? describe : describe.skip;

describeRealService("Phase 15 real Financial OS to Resend service path", () => {
  it("persists one owner-scoped sent record from an explicit opted-in evaluation", async () => {
    const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
    const client = new MongoClient(process.env.MONGODB_TEST_URI!);
    await client.connect();
    const database = client.db(databaseName);
    const actor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
    const now = new Date("2026-09-02T09:00:00.000Z");
    try {
      const repository = notificationRepositoryForDatabase(database, () => now);
      const profiles = profileRepositoryForDatabase(database);
      await Promise.all([repository.ensureIndexes(), profiles.ensureIndexes()]);
      await database.collection("authUsers").insertOne({
        _id: new ObjectId(actor.userId),
        email: `delivered+fos-${randomUUID().slice(0, 8)}@resend.dev`,
      });
      await saveProfile(actor, { countryCode: "IL", displayName: "בדיקת Resend", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profiles });
      const realProvider = new ResendNotificationEmailProvider({ apiKey: process.env.RESEND_API_KEY!, fromEmail: "Financial OS <onboarding@resend.dev>" });
      const provider: NotificationEmailProvider = {
        getDeliveryStatus: async () => "accepted",
        send: (command) => realProvider.send(command),
      };
      const forecast = {
        currency: "ILS", defaultHorizonDays: 30, scenarios: [], supportedHorizons: [7, 30, 60, 90],
        forecasts: [{
          calculatedAt: now.toISOString(), dataFreshness: "FRESH", engineVersion: "forecast/1.0.0", id: new ObjectId().toHexString(), materialObligations: [], policyVersion: "forecast-policy/1",
          timeline: [{ amount: { amountMinor: "0", currency: "ILS" }, calendarDate: "2026-09-03", confirmedBalance: { amountMinor: "0", currency: "ILS" }, eventId: "boundary", projectedBalance: { amountMinor: "0", currency: "ILS" }, safetyMargin: { amountMinor: "1", currency: "ILS" }, truthStatus: "confirmed", type: "margin_boundary" }],
        } as unknown as ForecastCenterView["forecasts"][number]],
      } as ForecastCenterView;
      const budget = {
        activities: [], categories: [], coreForecast: null, currentCalendarMonth: "2026-09",
        calculation: { allocated: { amountMinor: "0", currency: "ILS" }, calendarMonth: "2026-09", categorizedForecastSpent: { amountMinor: "0", currency: "ILS" }, categorizedSpent: { amountMinor: "0", currency: "ILS" }, confirmedIncome: { amountMinor: "0", currency: "ILS" }, lines: [], totalForecastSpent: { amountMinor: "0", currency: "ILS" }, totalSpent: { amountMinor: "0", currency: "ILS" }, unallocated: { amountMinor: "0", currency: "ILS" }, uncategorizedForecastSpent: { amountMinor: "0", currency: "ILS" }, uncategorizedSpent: { amountMinor: "0", currency: "ILS" }, uncertainIncome: { amountMinor: "0", currency: "ILS" } },
        period: { allocations: [], calendarMonth: "2026-09", carryIn: [], closedAt: null, closingSnapshot: null, currency: "ILS", id: null, status: "open", version: null },
      } satisfies BudgetView;
      const goals = { categories: [], currency: "ILS", goals: [], sources: { accounts: [], cards: [], liabilities: [], savings: [] } } satisfies GoalCenterView;
      const dependencies = {
        applicationOrigin: "http://localhost:3001", budgetLoader: async () => budget, emailCapabilityReady: true,
        forecastLoader: async () => forecast, goalLoader: async () => goals, now: () => now,
        profileLoader: (owner: Actor) => loadProfile(owner, { repository: profiles }), provider, repository,
      };
      await saveNotificationPreferences(actor, { emailEnabled: true, expectedVersion: null, inAppEnabled: true, quietHours: { enabled: false, endHour: 8, startHour: 22 } }, dependencies);
      const first = await evaluateAndDeliverNotifications(actor, dependencies);
      const retry = await evaluateAndDeliverNotifications(actor, dependencies);
      expect(first.notifications).toHaveLength(1);
      expect(first.notifications[0]).toMatchObject({ email: { attempts: 1, state: "sent" }, severity: "WARNING" });
      expect(retry.notifications[0]?.id).toBe(first.notifications[0]?.id);
      expect(await database.collection("notifications").countDocuments({ userId: new ObjectId(actor.userId) })).toBe(1);
      expect(await database.collection("bankConnections").countDocuments({})).toBe(0);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  }, 45_000);
});
