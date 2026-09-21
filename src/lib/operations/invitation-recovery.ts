/** Pure quarantine transformations only; no database access or application release. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { HOUSEHOLD_INVITATION_POLICY_VERSION, HOUSEHOLD_SCHEMA_VERSION, householdInvitationStatusSchema } from "@/lib/households/household";
import { recoveryHouseholdAuditSchema } from "@/lib/operations/household-recovery-schemas";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ _id: id, acceptedByUserId: id.nullable(), auditTrail: z.array(recoveryHouseholdAuditSchema),
  createdAt: z.date(), expiresAt: z.date(), householdId: id, invitationPolicyVersion: z.literal(HOUSEHOLD_INVITATION_POLICY_VERSION),
  inviteeEmailHash: z.string().optional(), inviteeHint: z.string().optional(), invitedByUserId: id, schemaVersion: z.literal(HOUSEHOLD_SCHEMA_VERSION),
  status: householdInvitationStatusSchema, updatedAt: z.date(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  tokenHash: z.string().optional(), activeInviteKey: z.string().optional(),
}).strict();
const fail = (): never => { throw new Error("Invitation recovery validation failed"); };

export function projectRecoveryInvitation(row: Document): Document {
  const parsed = schema.safeParse(row); if (!parsed.success) return fail();
  const r = parsed.data;
  const marker = `restored-inert:${r._id.toHexString()}`;
  if ((r.inviteeEmailHash === undefined) !== (r.inviteeHint === undefined)) return fail();
  if (r.inviteeEmailHash !== undefined && !hash.safeParse(r.inviteeEmailHash).success && r.inviteeEmailHash !== marker) return fail();
  // Accept source SHA-256 or our known non-replayable restored marker, never arbitrary credential material.
  if (r.tokenHash !== undefined && !hash.safeParse(r.tokenHash).success && r.tokenHash !== `restored-inert:${r._id.toHexString()}`) return fail();
  if (r.activeInviteKey !== undefined && (!r.inviteeEmailHash || r.activeInviteKey !== `${r.householdId.toHexString()}:${r.inviteeEmailHash}`)) return fail();
  // Recipient hints/digests are unnecessary for inert historical linkage and could retain an erased invitee.
  const projected = Object.fromEntries(Object.entries(row).filter(([key]) => !["tokenHash", "activeInviteKey", "inviteeEmailHash", "inviteeHint"].includes(key)));
  assertRecoveryContent(projected);
  return projected;
}

/** Inert index-compatible record for an isolated restore. Caller must still apply the CURRENT deletion ledger.
 * Marker is outside SHA-256 output space used by invitation lookup; no token can hash to it.
 */
export function materializeInertRecoveryInvitation(filtered: Document, restoredAt: Date): Document {
  if (["tokenHash", "activeInviteKey", "inviteeEmailHash", "inviteeHint"].some(key => Object.hasOwn(filtered, key))) return fail();
  const row = projectRecoveryInvitation(filtered);
  if (!Number.isFinite(restoredAt.getTime()) || restoredAt < row.updatedAt || restoredAt < row.createdAt) return fail();
  const pending = row.status === "pending";
  if (pending && row.version >= Number.MAX_SAFE_INTEGER) return fail();
  return { ...row, tokenHash: `restored-inert:${row._id.toHexString()}`,
    inviteeEmailHash: `restored-inert:${row._id.toHexString()}`, inviteeHint: "פרטי הנמען הוסרו בשחזור",
    ...(pending ? { status: "revoked", updatedAt: restoredAt, version: row.version + 1,
      auditTrail: [...row.auditTrail, { action: "invitation_revoked", actorUserId: null, at: restoredAt,
        changedFields: ["status", "recoveryReplayDisabled"], resourceId: null, resourceKind: null,
        revision: row.version + 1, targetUserId: null }] } : {}) };
}
