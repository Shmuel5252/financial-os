/** Quarantine-only schema coverage. This does not authorize shared-data release or erasure. */
import "server-only";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { HOUSEHOLD_POLICY_VERSION, HOUSEHOLD_SCHEMA_VERSION, householdStatusSchema,
  householdMembershipStatusSchema, householdResourceKindSchema, householdShareStatusSchema } from "@/lib/households/household";
import type { RecoverySchemas } from "@/lib/operations/backup-package";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId);
const positive = z.number().int().positive();
const audit = z.object({ action: z.enum(["household_created", "household_dissolved", "household_settings_updated",
  "invitation_accepted", "invitation_created", "invitation_expired", "invitation_revoked", "member_left",
  "member_removed", "resource_shared", "resource_unshared"]), actorUserId: id.nullable(), at: z.date(),
  changedFields: z.array(z.string()), resourceId: id.nullable(), resourceKind: householdResourceKindSchema.nullable(),
  revision: positive, targetUserId: id.nullable() }).strict();
const common = { _id: id, auditTrail: z.array(audit), createdAt: z.date(), updatedAt: z.date(), version: positive,
  policyVersion: z.literal(HOUSEHOLD_POLICY_VERSION), schemaVersion: z.literal(HOUSEHOLD_SCHEMA_VERSION) };
const definitions = {
  households: z.object({ ...common, idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyPayloadHash: z.string().regex(/^[a-f0-9]{64}$/), name: z.string(), ownerUserId: id,
    status: householdStatusSchema }).strict(),
  householdMemberships: z.object({ ...common, activatedByInvitationId: id, displayNameSnapshot: z.string(),
    endedAt: z.date().nullable(), householdId: id, joinedAt: z.date(), membershipEpoch: positive,
    status: householdMembershipStatusSchema, userId: id }).strict(),
  householdResourceShares: z.object({ ...common, householdId: id, ownerMembershipEpoch: positive,
    ownerUserId: id, resourceId: id, resourceKind: householdResourceKindSchema, status: householdShareStatusSchema }).strict(),
};
/** Invitations remain unsupported: removing their unique token hash needs a separate inert restore contract. */
export const householdRecoverySchemas: RecoverySchemas = Object.fromEntries(Object.entries(definitions).map(([name, schema]) =>
  [name, { version: "household-quarantine-v1", project: (row: import("mongodb").Document) => {
    assertRecoveryContent(row);
    if (!schema.safeParse(row).success) throw new Error("Recovery schema requires review");
    // Preserve original BSON ordering and audit evidence; never normalize or silently redact shared history.
    return row;
  } }]));
