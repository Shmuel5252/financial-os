import "server-only";

import {
  type Collection,
  type Db,
  MongoServerError,
  ObjectId,
} from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import {
  NOTIFICATION_POLICY_VERSION,
  NOTIFICATION_SEVERITY_VERSION,
  type NotificationCandidate,
} from "@/lib/domain/notifications/notification-policy";
import {
  ConflictError,
  DependencyUnavailableError,
  NotFoundError,
} from "@/lib/errors/application-error";
import type {
  NotificationEmailState,
  NotificationInAppState,
  NotificationPreference,
  NotificationRecord,
} from "@/lib/notifications/notification";

type NotificationAuditAction =
  | "created"
  | "email_deferred"
  | "email_delivered"
  | "email_failed"
  | "email_pending"
  | "email_revoked"
  | "email_sent"
  | "in_app_dismissed"
  | "in_app_read";

type NotificationAuditDocument = {
  action: NotificationAuditAction;
  actorUserId: ObjectId;
  at: Date;
  revision: number;
};

type NotificationDocument = {
  _id: ObjectId;
  allowQuietHoursBypass: boolean;
  auditTrail: NotificationAuditDocument[];
  conditionFingerprint: string;
  cooldownKey: string;
  createdAt: Date;
  deduplicationKey: string;
  email: {
    acceptedAt: Date | null;
    attempts: number;
    claimExpiresAt: Date | null;
    deliveredAt: Date | null;
    errorCategory: string | null;
    notBeforeAt: Date | null;
    providerMessageId: string | null;
    state: NotificationEmailState | "sending";
  };
  inAppState: NotificationInAppState;
  messageKey: NotificationCandidate["messageKey"];
  policyVersion: typeof NOTIFICATION_POLICY_VERSION;
  schemaVersion: 1;
  severity: NotificationCandidate["severity"];
  severityVersion: typeof NOTIFICATION_SEVERITY_VERSION;
  sourceKind: NotificationCandidate["sourceKind"];
  sourceReference: string;
  sourceVersion: string;
  targetPath: NotificationCandidate["targetPath"];
  trigger: NotificationCandidate["trigger"];
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type NotificationPreferenceDocument = {
  _id: ObjectId;
  auditTrail: Array<{
    action: "created" | "updated";
    actorUserId: ObjectId;
    at: Date;
    changedFields: string[];
    revision: number;
  }>;
  createdAt: Date;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  quietHours: { enabled: boolean; endHour: number; startHour: number };
  schemaVersion: 1;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type AuthUserDocument = { _id: ObjectId; email?: string | null };

const candidateSchema = z.object({
  allowQuietHoursBypass: z.boolean(),
  conditionFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  cooldownKey: z.string().regex(/^[0-9a-f]{64}$/),
  deduplicationKey: z.string().regex(/^[0-9a-f]{64}$/),
  messageKey: z.enum(["budget_deficit", "forecast_below_safety_margin", "forecast_confirmed_shortfall", "goal_milestone", "material_obligation_risk", "stale_financial_data"]),
  policyVersion: z.literal(NOTIFICATION_POLICY_VERSION),
  severity: z.enum(["CRITICAL", "INFO", "WARNING"]),
  severityVersion: z.literal(NOTIFICATION_SEVERITY_VERSION),
  sourceKind: z.enum(["budget", "forecast", "goal_progress"]),
  sourceReference: z.string().min(1).max(200),
  sourceVersion: z.string().min(1).max(200),
  targetPath: z.enum(["/budgets", "/forecasts", "/goals"]),
  trigger: z.enum(["budget_deficit", "forecast_below_safety_margin", "forecast_confirmed_shortfall", "goal_milestone", "material_obligation_risk", "stale_financial_data"]),
}).passthrough();

function mapNotification(document: NotificationDocument): NotificationRecord {
  const parsed = candidateSchema.safeParse(document);
  if (
    !parsed.success ||
    !(document._id instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !(document.updatedAt instanceof Date) ||
    !Number.isInteger(document.version) ||
    document.version < 1
  ) throw new DependencyUnavailableError("Stored notification data is invalid.");
  return {
    candidate: parsed.data,
    createdAt: document.createdAt,
    email: {
      acceptedAt: document.email.acceptedAt,
      attempts: document.email.attempts,
      deliveredAt: document.email.deliveredAt,
      errorCategory: document.email.errorCategory,
      notBeforeAt: document.email.notBeforeAt,
      providerMessageId: document.email.providerMessageId,
      state: document.email.state === "sending" ? "pending" : document.email.state,
    },
    id: document._id.toHexString(),
    inAppState: document.inAppState,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

function mapPreference(document: NotificationPreferenceDocument): NotificationPreference {
  if (!(document.createdAt instanceof Date) || !(document.updatedAt instanceof Date) || document.version < 1) {
    throw new DependencyUnavailableError("Stored notification preferences are invalid.");
  }
  return {
    createdAt: document.createdAt,
    emailEnabled: document.emailEnabled,
    inAppEnabled: document.inAppEnabled,
    quietHours: document.quietHours,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

export class NotificationRepository {
  constructor(
    private readonly notifications: Collection<NotificationDocument>,
    private readonly preferences: Collection<NotificationPreferenceDocument>,
    private readonly authUsers: Collection<AuthUserDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.notifications.createIndex({ userId: 1, deduplicationKey: 1 }, { name: "notifications_owner_dedupe", unique: true }),
      this.notifications.createIndex({ userId: 1, createdAt: -1, _id: -1 }, { name: "notifications_owner_page" }),
      this.notifications.createIndex({ userId: 1, cooldownKey: 1, "email.acceptedAt": -1 }, { name: "notifications_owner_cooldown" }),
      this.notifications.createIndex({ userId: 1, "email.state": 1, "email.notBeforeAt": 1 }, { name: "notifications_owner_delivery" }),
      this.preferences.createIndex({ userId: 1 }, { name: "notification_preferences_owner", unique: true }),
    ]);
  }

  async findPreferencesForActor(actor: Actor): Promise<NotificationPreference | null> {
    const document = await this.preferences.findOne({ userId: parseObjectId(actor.userId, "actor.userId") });
    return document === null ? null : mapPreference(document);
  }

  async savePreferencesForActor(
    actor: Actor,
    input: Readonly<{
      emailEnabled: boolean;
      expectedVersion: number | null;
      inAppEnabled: boolean;
      quietHours: Readonly<{ enabled: boolean; endHour: number; startHour: number }>;
    }>,
  ): Promise<NotificationPreference> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    if (input.expectedVersion === null) {
      const document: NotificationPreferenceDocument = {
        _id: new ObjectId(),
        auditTrail: [{ action: "created", actorUserId: userId, at, changedFields: ["emailEnabled", "inAppEnabled", "quietHours"], revision: 1 }],
        createdAt: at,
        emailEnabled: input.emailEnabled,
        inAppEnabled: input.inAppEnabled,
        quietHours: { ...input.quietHours },
        schemaVersion: 1,
        updatedAt: at,
        userId,
        version: 1,
      };
      try { await this.preferences.insertOne(document); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError();
        throw error;
      }
      return mapPreference(document);
    }
    const revision = input.expectedVersion + 1;
    const updated = await this.preferences.findOneAndUpdate(
      { userId, version: input.expectedVersion },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: "updated", actorUserId: userId, at, changedFields: ["emailEnabled", "inAppEnabled", "quietHours"], revision } },
        $set: { emailEnabled: input.emailEnabled, inAppEnabled: input.inAppEnabled, quietHours: { ...input.quietHours }, updatedAt: at },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapPreference(updated);
  }

  async listForActor(actor: Actor, limit = 100): Promise<readonly NotificationRecord[]> {
    const documents = await this.notifications.find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
    return documents.map(mapNotification);
  }

  async createForActor(
    actor: Actor,
    candidate: NotificationCandidate,
    email: Readonly<{ notBeforeAt: Date | null; state: "deferred" | "not_requested" | "pending" }>,
  ): Promise<Readonly<{ created: boolean; notification: NotificationRecord }>> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const existing = await this.notifications.findOne({ deduplicationKey: candidate.deduplicationKey, userId });
    if (existing !== null) return { created: false, notification: mapNotification(existing) };
    const at = this.now();
    const document: NotificationDocument = {
      _id: new ObjectId(),
      ...candidate,
      auditTrail: [{ action: "created", actorUserId: userId, at, revision: 1 }],
      createdAt: at,
      email: { acceptedAt: null, attempts: 0, claimExpiresAt: null, deliveredAt: null, errorCategory: null, notBeforeAt: email.notBeforeAt, providerMessageId: null, state: email.state },
      inAppState: "unread",
      schemaVersion: 1,
      updatedAt: at,
      userId,
      version: 1,
    };
    try { await this.notifications.insertOne(document); }
    catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const retry = await this.notifications.findOne({ deduplicationKey: candidate.deduplicationKey, userId });
        if (retry !== null) return { created: false, notification: mapNotification(retry) };
      }
      throw error;
    }
    return { created: true, notification: mapNotification(document) };
  }

  async findRecentAcceptedForCooldown(actor: Actor, cooldownKey: string, after: Date): Promise<NotificationRecord | null> {
    const document = await this.notifications.findOne({
      cooldownKey,
      "email.acceptedAt": { $gte: after },
      userId: parseObjectId(actor.userId, "actor.userId"),
    }, { sort: { "email.acceptedAt": -1 } });
    return document === null ? null : mapNotification(document);
  }

  async findRecipientEmailForActor(actor: Actor): Promise<string | null> {
    const document = await this.authUsers.findOne({ _id: parseObjectId(actor.userId, "actor.userId") }, { projection: { email: 1 } });
    return typeof document?.email === "string" && z.string().email().safeParse(document.email).success ? document.email : null;
  }

  async claimReadyEmailForActor(actor: Actor): Promise<NotificationRecord | null> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    const candidate = await this.notifications.findOne({
      userId,
      $or: [
        { "email.state": "pending" },
        { "email.notBeforeAt": { $lte: at }, "email.state": { $in: ["deferred", "failed"] } },
        { "email.claimExpiresAt": { $lte: at }, "email.state": "sending" },
      ],
      "email.attempts": { $lt: 3 },
    }, { sort: { createdAt: 1, _id: 1 } });
    if (candidate === null) return null;
    const revision = candidate.version + 1;
    const updated = await this.notifications.findOneAndUpdate(
      { _id: candidate._id, userId, version: candidate.version },
      {
        $inc: { "email.attempts": 1, version: 1 },
        $push: { auditTrail: { action: "email_pending", actorUserId: userId, at, revision } },
        $set: { "email.claimExpiresAt": new Date(at.getTime() + 60_000), "email.errorCategory": null, "email.state": "sending", updatedAt: at },
      },
      { returnDocument: "after" },
    );
    return updated === null ? null : mapNotification(updated);
  }

  private async updateEmail(
    actor: Actor,
    notification: NotificationRecord,
    action: NotificationAuditAction,
    set: Record<string, unknown>,
  ): Promise<NotificationRecord> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    const revision = notification.version + 1;
    const updated = await this.notifications.findOneAndUpdate(
      { _id: parseObjectId(notification.id, "notificationId"), userId, version: notification.version },
      { $inc: { version: 1 }, $push: { auditTrail: { action, actorUserId: userId, at, revision } }, $set: { ...set, updatedAt: at } },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapNotification(updated);
  }

  markEmailAccepted(actor: Actor, notification: NotificationRecord, providerMessageId: string): Promise<NotificationRecord> {
    return this.updateEmail(actor, notification, "email_sent", { "email.acceptedAt": this.now(), "email.claimExpiresAt": null, "email.notBeforeAt": null, "email.providerMessageId": providerMessageId, "email.state": "sent" });
  }

  markEmailDelivered(actor: Actor, notification: NotificationRecord): Promise<NotificationRecord> {
    return this.updateEmail(actor, notification, "email_delivered", { "email.deliveredAt": this.now(), "email.state": "delivered" });
  }

  markEmailFailed(actor: Actor, notification: NotificationRecord, errorCategory: string, retryAt: Date | null): Promise<NotificationRecord> {
    return this.updateEmail(actor, notification, "email_failed", { "email.claimExpiresAt": null, "email.errorCategory": errorCategory, "email.notBeforeAt": retryAt, "email.state": "failed" });
  }

  async revokeQueuedEmailsForActor(actor: Actor): Promise<void> {
    const records = await this.notifications.find({ userId: parseObjectId(actor.userId, "actor.userId"), "email.state": { $in: ["deferred", "failed", "pending", "sending"] } }).limit(500).toArray();
    for (const document of records) {
      await this.updateEmail(actor, mapNotification(document), "email_revoked", { "email.claimExpiresAt": null, "email.notBeforeAt": null, "email.state": "not_requested" });
    }
  }

  async markInAppStateForActor(actor: Actor, id: string, expectedVersion: number, state: "dismissed" | "read"): Promise<NotificationRecord> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    const updated = await this.notifications.findOneAndUpdate(
      { _id: parseObjectId(id, "notificationId"), userId, version: expectedVersion },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: state === "read" ? "in_app_read" : "in_app_dismissed", actorUserId: userId, at, revision: expectedVersion + 1 } },
        $set: { inAppState: state, updatedAt: at },
      },
      { returnDocument: "after" },
    );
    if (updated === null) {
      const exists = await this.notifications.countDocuments({ _id: parseObjectId(id, "notificationId"), userId }, { limit: 1 });
      if (exists === 0) throw new NotFoundError();
      throw new ConflictError();
    }
    return mapNotification(updated);
  }

  async listSentForActor(actor: Actor, limit = 50): Promise<readonly NotificationRecord[]> {
    const documents = await this.notifications.find({ userId: parseObjectId(actor.userId, "actor.userId"), "email.state": "sent" }).sort({ updatedAt: 1 }).limit(limit).toArray();
    return documents.map(mapNotification);
  }
}

export function notificationRepositoryForDatabase(database: Db, now?: () => Date): NotificationRepository {
  return new NotificationRepository(
    database.collection<NotificationDocument>("notifications"),
    database.collection<NotificationPreferenceDocument>("notificationPreferences"),
    database.collection<AuthUserDocument>("authUsers"),
    now,
  );
}

export async function getNotificationRepository(): Promise<NotificationRepository> {
  const repository = notificationRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
