/** Quarantine-only preferences; restored consent never enables email automatically. */
import "server-only";
import { BSON, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { updateNotificationPreferencesCommandSchema } from "@/lib/notifications/notification";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const schema = updateNotificationPreferencesCommandSchema.omit({ expectedVersion: true }).extend({
  _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId), schemaVersion: z.literal(1), version: revision,
  createdAt: z.date(), updatedAt: z.date(), auditTrail: z.array(z.object({
    action: z.enum(["created", "updated"]), actorUserId: z.instanceof(ObjectId), at: z.date(),
    changedFields: z.array(z.enum(["emailEnabled", "inAppEnabled", "quietHours"])), revision,
  }).strict()),
}).strict();
const fail = (): never => { throw new Error("Notification preference recovery requires review"); };

export function projectRecoveryNotificationPreference(row: Document): Document {
  assertRecoveryContent(row);
  const parsed = schema.safeParse(row); if (!parsed.success) return fail();
  if (parsed.data.auditTrail.some(event => !event.actorUserId.equals(parsed.data.userId))) return fail();
  return row;
}

/** Complete owner inventory must come from the verified package. Current ledger is independent.
 * This does not restore notification jobs or claim a provider revocation. No fabricated user audit action.
 */
export function quarantineNotificationPreferences(rows: readonly Document[], authUsers: readonly Document[], ledger: RestorationLedgerContext) {
  const { isSuppressed } = restorationSuppression(ledger);
  const users = new Set<string>();
  for (const row of authUsers) {
    if (!(row._id instanceof ObjectId) || users.has(row._id.toHexString())) return fail();
    users.add(row._id.toHexString());
  }
  const ids = new Set<string>(); const owners = new Set<string>(); const preserved: Document[] = [];
  let excluded = 0; let emailDisabled = 0;
  for (const input of rows) {
    const row = projectRecoveryNotificationPreference(input); const owner = row.userId.toHexString(); const id = row._id.toHexString();
    if (!users.has(owner) || ids.has(id) || owners.has(owner)) return fail(); ids.add(id); owners.add(owner);
    if (isSuppressed(owner)) { excluded++; continue; }
    const copy = BSON.deserialize(BSON.serialize(row), { promoteLongs: false });
    if (copy.emailEnabled) {
      if (copy.version >= Number.MAX_SAFE_INTEGER || ledger.now < copy.updatedAt.getTime()) return fail();
      copy.emailEnabled = false; copy.version++; copy.updatedAt = new Date(ledger.now); emailDisabled++;
    }
    preserved.push(copy);
  }
  return { releaseAllowed: false as const, preserved, evidence: { policy: "notification-preference-quarantine-v1" as const,
    ledgerRevision: ledger.authoritativeRevision, evaluatedAt: ledger.now, excluded, emailDisabled } };
}
