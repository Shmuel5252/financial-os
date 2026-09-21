/** Reviewed initial adapters only. Unsupported nonempty classes/provider variants fail closed. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { fromStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { manualSectionDomainSchemas, manualSectionSchema } from "@/lib/onboarding/manual-record";
import { sectionCollections } from "@/lib/onboarding/manual-record-repository";
import { storedProfileSchema } from "@/lib/profiles/profile-repository";
import type { RecoverySchemas } from "@/lib/operations/backup-package";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { householdRecoverySchemas } from "@/lib/operations/household-recovery-schemas";
import { projectRecoveryInvitation } from "@/lib/operations/invitation-recovery";
import { projectRecoveryReport } from "@/lib/operations/report-recovery-schema";
import { projectRecoveryNotificationPreference } from "@/lib/operations/notification-preference-recovery";

const fail = (): never => { throw new Error("Recovery schema requires review"); };
const manualSchema = z.object({ _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId),
  createdAt: z.date(), updatedAt: z.date(), deletedAt: z.date().nullable(), version: z.number().int().positive(),
  schemaVersion: z.literal(2), source: z.object({ kind: z.literal("manual") }).strict(),
  idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  idempotencyPayloadHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), fields: z.record(z.string(), z.unknown()),
  auditTrail: z.array(z.object({ action: z.enum(["created", "updated", "deleted"]), actorUserId: z.instanceof(ObjectId),
    at: z.date(), changedFields: z.array(z.string()), revision: z.number().int().positive(), source: z.literal("manual") }).strict()),
}).strict();
const authUserSchema = z.object({ _id: z.instanceof(ObjectId), name: z.string().max(500).nullable().optional(),
  email: z.string().max(254).optional(), emailVerified: z.date().nullable().optional(), image: z.string().max(2048).nullable().optional(),
}).strict();
function unchanged(before: unknown, after: unknown) {
  if (JSON.stringify(stableSerializableDomainValue(before)) !== JSON.stringify(stableSerializableDomainValue(after))) return fail();
}
function validate<T>(schema: z.ZodType<T>, row: Document): T {
  assertRecoveryContent(row);
  const result = schema.safeParse(row); if (!result.success) return fail();
  unchanged(row, result.data); return result.data;
}
export const initialRecoverySchemas: RecoverySchemas = {
  ...householdRecoverySchemas,
  householdInvitations: { version: "invitation-minimized-v2", project: projectRecoveryInvitation },
  financialReports: { version: "saved-report-v1", project: projectRecoveryReport },
  notificationPreferences: { version: "notification-preference-v1", project: projectRecoveryNotificationPreference },
  authUsers: { version: "auth-user-v1", project: row => { validate(authUserSchema, row); return row; } },
  profiles: { version: "profile-v1", project: row => { validate(storedProfileSchema.strict(), row); return row; } },
  ...Object.fromEntries(manualSectionSchema.options.map(section => [sectionCollections[section], {
    version: "manual-v2", project: (row: Document) => {
      const stored = validate(manualSchema, row);
      if (stored.auditTrail.some(event => !event.actorUserId.equals(stored.userId))) return fail();
      const fields = fromStoredDomainValue(stored.fields);
      const result = manualSectionDomainSchemas[section].safeParse(fields);
      if (!result.success) return fail();
      unchanged(fields, result.data);
      return row;
    },
  }])),
};
