/** Preserve stored progress evidence/settings; never regenerate achievements or notifications. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { PROGRESS_JOURNEY_ENGINE_VERSION, PROGRESS_JOURNEY_POLICY_VERSION, PROGRESS_JOURNEY_RULE_VERSION,
  progressDimensionSchema, progressEventKindSchema, progressOriginSchema, progressOutcomeSchema,
  progressPeriodSchema, progressSourceReferenceSchema } from "@/lib/progress-journeys/progress-journey";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const event = z.object({ _id: id, userId: id, createdAt: z.date(), schemaVersion: z.literal(1),
  dimension: progressDimensionSchema, engineVersion: z.literal(PROGRESS_JOURNEY_ENGINE_VERSION), evaluationDate: calendarDateSchema,
  eventKind: progressEventKindSchema, evidenceFingerprint: hash, origin: progressOriginSchema, outcome: progressOutcomeSchema,
  period: progressPeriodSchema, policyVersion: z.literal(PROGRESS_JOURNEY_POLICY_VERSION), ruleId: z.string().min(1).max(100),
  ruleVersion: z.literal(PROGRESS_JOURNEY_RULE_VERSION), seriesKey: hash, stableKey: hash,
  sourceReferences: z.array(progressSourceReferenceSchema).min(1).max(50), subjectLabel: z.string().min(1).max(200),
  supersedesId: id.nullable(), value: z.number().int().min(0).max(10000).nullable(),
  auditTrail: z.array(z.object({ action: z.literal("appended"), actorUserId: id, at: z.date(), revision: z.literal(1) }).strict()).length(1),
}).strict();
const preference = z.object({ _id: id, userId: id, createdAt: z.date(), updatedAt: z.date(), schemaVersion: z.literal(1), version: revision,
  celebrationsEnabled: z.boolean(), progressNotificationsEnabled: z.boolean(), streaksEnabled: z.boolean(),
  auditTrail: z.array(z.object({ action: z.enum(["created", "updated"]), actorUserId: id, at: z.date(), revision,
    changedFields: z.tuple([z.literal("celebrationsEnabled"), z.literal("progressNotificationsEnabled"), z.literal("streaksEnabled")]) }).strict()).min(1),
}).strict();
const fail = (): never => { throw new Error("Progress recovery requires review"); };
export function projectRecoveryProgressEvent(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = event.parse(input); const audit = row.auditTrail[0]!;
    if (!audit.actorUserId.equals(row.userId) || audit.at.getTime() !== row.createdAt.getTime()
      || (row.eventKind === "correction") !== (row.supersedesId !== null)
      || row.supersedesId?.equals(row._id)) return fail();
    // Original subject/series keys are not stored; preserve hashes without pretending to reconstruct their preimages.
    // Source ownership, correction lineage and historical outcome validity are separate quarantine gates.
    return input;
  } catch { return fail(); }
}
export function projectRecoveryProgressPreference(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = preference.parse(input);
    if (row.auditTrail.length !== row.version) return fail();
    for (const [index, audit] of row.auditTrail.entries()) {
      if (!audit.actorUserId.equals(row.userId) || audit.revision !== index + 1
        || audit.action !== (index === 0 ? "created" : "updated")) return fail();
    }
    if (row.auditTrail[0]!.at.getTime() !== row.createdAt.getTime()
      || row.auditTrail[row.auditTrail.length - 1]!.at.getTime() !== row.updatedAt.getTime()) return fail();
    // Preserve current choices only; restore does not issue consent or enable delivery/jobs.
    return input;
  } catch { return fail(); }
}
