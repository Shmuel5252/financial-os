import { z } from "zod";

import type {
  NotificationCandidate,
  NotificationSeverity,
  NotificationTrigger,
} from "@/lib/domain/notifications/notification-policy";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export type NotificationInAppState = "dismissed" | "read" | "unread";
export type NotificationEmailState =
  | "deferred"
  | "delivered"
  | "failed"
  | "not_requested"
  | "pending"
  | "sent";

export type NotificationPreference = Readonly<{
  createdAt: Date;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  quietHours: Readonly<{ enabled: boolean; endHour: number; startHour: number }>;
  updatedAt: Date;
  version: number;
}>;

export type NotificationRecord = Readonly<{
  candidate: NotificationCandidate;
  createdAt: Date;
  email: Readonly<{
    acceptedAt: Date | null;
    attempts: number;
    deliveredAt: Date | null;
    errorCategory: string | null;
    notBeforeAt: Date | null;
    providerMessageId: string | null;
    state: NotificationEmailState;
  }>;
  id: string;
  inAppState: NotificationInAppState;
  updatedAt: Date;
  version: number;
}>;

export type NotificationPreferenceView = Readonly<{
  emailEnabled: boolean;
  inAppEnabled: boolean;
  quietHours: Readonly<{ enabled: boolean; endHour: number; startHour: number }>;
  updatedAt: string | null;
  version: number | null;
}>;

export type NotificationView = Readonly<{
  createdAt: string;
  email: Readonly<{
    acceptedAt: string | null;
    attempts: number;
    deliveredAt: string | null;
    notBeforeAt: string | null;
    state: NotificationEmailState;
  }>;
  id: string;
  inAppState: NotificationInAppState;
  messageKey: NotificationTrigger;
  policyVersion: string;
  severity: NotificationSeverity;
  sourceKind: NotificationCandidate["sourceKind"];
  targetPath: NotificationCandidate["targetPath"];
  trigger: NotificationTrigger;
  updatedAt: string;
  version: number;
}>;

export type NotificationCenterView = Readonly<{
  emailCapabilityReady: boolean;
  notifications: readonly NotificationView[];
  phase9ProviderTriggersAvailable: false;
  preferences: NotificationPreferenceView;
}>;

const quietHoursSchema = z.object({
  enabled: z.boolean(),
  endHour: z.number().int().min(0).max(23),
  startHour: z.number().int().min(0).max(23),
}).strict();

export const updateNotificationPreferencesCommandSchema = z.object({
  emailEnabled: z.boolean(),
  expectedVersion: z.number().int().positive().nullable(),
  inAppEnabled: z.boolean(),
  quietHours: quietHoursSchema,
}).strict();

export const evaluateNotificationsCommandSchema = z.object({}).strict();

export const updateNotificationCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  id: z.string().regex(/^[0-9a-f]{24}$/i),
  inAppState: z.enum(["dismissed", "read"]),
}).strict();

export type UpdateNotificationPreferencesCommand = z.infer<typeof updateNotificationPreferencesCommandSchema>;
export type UpdateNotificationCommand = z.infer<typeof updateNotificationCommandSchema>;

export const defaultNotificationPreference: NotificationPreferenceView = {
  emailEnabled: false,
  inAppEnabled: true,
  quietHours: { enabled: true, endHour: 8, startHour: 22 },
  updatedAt: null,
  version: null,
};

export function toNotificationPreferenceView(value: NotificationPreference | null): NotificationPreferenceView {
  return value === null ? defaultNotificationPreference : {
    emailEnabled: value.emailEnabled,
    inAppEnabled: value.inAppEnabled,
    quietHours: value.quietHours,
    updatedAt: value.updatedAt.toISOString(),
    version: value.version,
  };
}

export function toNotificationView(value: NotificationRecord): NotificationView {
  return {
    createdAt: value.createdAt.toISOString(),
    email: {
      acceptedAt: value.email.acceptedAt?.toISOString() ?? null,
      attempts: value.email.attempts,
      deliveredAt: value.email.deliveredAt?.toISOString() ?? null,
      notBeforeAt: value.email.notBeforeAt?.toISOString() ?? null,
      state: value.email.state,
    },
    id: value.id,
    inAppState: value.inAppState,
    messageKey: value.candidate.messageKey,
    policyVersion: value.candidate.policyVersion,
    severity: value.candidate.severity,
    sourceKind: value.candidate.sourceKind,
    targetPath: value.candidate.targetPath,
    trigger: value.candidate.trigger,
    updatedAt: value.updatedAt.toISOString(),
    version: value.version,
  };
}

export function parseNotificationCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseUntrusted(schema, input);
}
