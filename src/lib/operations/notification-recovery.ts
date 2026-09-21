/** Strict notification artifact projection and quarantine-only replay suppression. */
import "server-only";
import { BSON, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { NOTIFICATION_POLICY_VERSION, NOTIFICATION_SEVERITY_VERSION } from "@/lib/domain/notifications/notification-policy";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const trigger = z.enum(["budget_deficit", "forecast_below_safety_margin", "forecast_confirmed_shortfall", "goal_milestone", "material_obligation_risk", "stale_financial_data"]);
const schema = z.object({
  _id: z.instanceof(ObjectId), userId: z.instanceof(ObjectId), createdAt: z.date(), updatedAt: z.date(), version: revision, schemaVersion: z.literal(1),
  allowQuietHoursBypass: z.boolean(), conditionFingerprint: hash, cooldownKey: hash, deduplicationKey: hash,
  messageKey: trigger, trigger, policyVersion: z.literal(NOTIFICATION_POLICY_VERSION), severityVersion: z.literal(NOTIFICATION_SEVERITY_VERSION),
  severity: z.enum(["CRITICAL", "INFO", "WARNING"]), sourceKind: z.enum(["budget", "forecast", "goal_progress"]),
  sourceReference: z.string().min(1).max(200), sourceVersion: z.string().min(1).max(200),
  targetPath: z.enum(["/budgets", "/forecasts", "/goals"]), inAppState: z.enum(["dismissed", "read", "unread"]),
  auditTrail: z.array(z.object({ action: z.enum(["created", "email_deferred", "email_delivered", "email_failed", "email_pending", "email_revoked", "email_sent", "in_app_dismissed", "in_app_read"]),
    actorUserId: z.instanceof(ObjectId), at: z.date(), revision }).strict()),
  email: z.object({ acceptedAt: z.date().nullable(), attempts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    claimExpiresAt: z.date().nullable(), deliveredAt: z.date().nullable(), notBeforeAt: z.date().nullable(),
    errorCategory: z.enum(["MISSING_RECIPIENT", "PROVIDER_FINAL_FAILURE", "SAFE_FAILURE", "AUTHENTICATION", "CONFIGURATION", "PROVIDER", "RATE_LIMIT", "RESPONSE"]).nullable(),
    providerMessageId: z.string().min(1).max(200).nullable().optional(),
    state: z.enum(["deferred", "delivered", "failed", "not_requested", "pending", "sent", "sending"]),
  }).strict(),
}).strict();
const fail = (): never => { throw new Error("Notification recovery requires review"); };

export function projectRecoveryNotification(row: Document): Document {
  const parsed = schema.safeParse(row); if (!parsed.success) return fail();
  if (parsed.data.auditTrail.some(event => !event.actorUserId.equals(parsed.data.userId))) return fail();
  // Provider delivery identifiers are not needed to retain historical delivery evidence.
  const email = Object.fromEntries(Object.entries(row.email).filter(([key]) => key !== "providerMessageId"));
  const projected = { ...row, email }; assertRecoveryContent(projected); return projected;
}

/** Applies current owner suppression and disables resends/status polling; no DB/provider operation.
 * Still requires source-reference closure and final release fencing before application use.
 */
export function quarantineNotifications(rows: readonly Document[], authUsers: readonly Document[], ledger: RestorationLedgerContext) {
  const { isSuppressed } = restorationSuppression(ledger); const users = new Set<string>();
  for (const user of authUsers) {
    if (!(user._id instanceof ObjectId) || users.has(user._id.toHexString())) return fail(); users.add(user._id.toHexString());
  }
  const ids = new Set<string>(); const dedupes = new Set<string>(); const preserved: Document[] = [];
  let excluded = 0; let replayDisabled = 0;
  for (const input of rows) {
    const row = projectRecoveryNotification(input); const id = row._id.toHexString(); const owner = row.userId.toHexString();
    const dedupe = `${owner}:${row.deduplicationKey}`;
    if (!users.has(owner) || ids.has(id) || dedupes.has(dedupe)) return fail(); ids.add(id); dedupes.add(dedupe);
    if (isSuppressed(owner)) { excluded++; continue; }
    const copy = BSON.deserialize(BSON.serialize(row), { promoteLongs: false });
    const active = ["deferred", "failed", "pending", "sending"].includes(copy.email.state);
    const changed = active || copy.email.claimExpiresAt !== null || copy.email.notBeforeAt !== null;
    if (changed) {
      if (copy.version >= Number.MAX_SAFE_INTEGER || ledger.now < copy.updatedAt.getTime()) return fail();
      copy.version++; copy.updatedAt = new Date(ledger.now); replayDisabled++;
    }
    copy.email.providerMessageId = null; copy.email.claimExpiresAt = null; copy.email.notBeforeAt = null;
    if (active) copy.email.state = "not_requested";
    // Preserve source audit as history; separate evidence records system recovery, not a forged user action.
    preserved.push(copy);
  }
  return { releaseAllowed: false as const, preserved, evidence: { policy: "notification-quarantine-v1" as const,
    ledgerRevision: ledger.authoritativeRevision, evaluatedAt: ledger.now, excluded, replayDisabled } };
}
