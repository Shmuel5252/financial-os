import { z } from "zod";

import type { SerializedMoney } from "@/lib/domain/money/money";

export const HOUSEHOLD_SCHEMA_VERSION = 1 as const;
export const HOUSEHOLD_POLICY_VERSION = "household-policy-v1" as const;
export const HOUSEHOLD_INVITATION_POLICY_VERSION = "household-invitation-v1" as const;
export const HOUSEHOLD_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export const householdRoleSchema = z.enum(["owner", "member"]);
export const householdStatusSchema = z.enum(["active", "dissolved"]);
export const householdMembershipStatusSchema = z.enum(["active", "left", "removed"]);
export const householdInvitationStatusSchema = z.enum([
  "accepted",
  "expired",
  "pending",
  "revoked",
]);
export const householdResourceKindSchema = z.enum(["account", "goal"]);
export const householdShareStatusSchema = z.enum(["shared", "unshared"]);

export type HouseholdRole = z.infer<typeof householdRoleSchema>;
export type HouseholdStatus = z.infer<typeof householdStatusSchema>;
export type HouseholdMembershipStatus = z.infer<typeof householdMembershipStatusSchema>;
export type HouseholdInvitationStatus = z.infer<typeof householdInvitationStatusSchema>;
export type HouseholdResourceKind = z.infer<typeof householdResourceKindSchema>;
export type HouseholdShareStatus = z.infer<typeof householdShareStatusSchema>;

export type HouseholdAuditAction =
  | "household_created"
  | "household_dissolved"
  | "household_settings_updated"
  | "invitation_accepted"
  | "invitation_created"
  | "invitation_expired"
  | "invitation_revoked"
  | "member_left"
  | "member_removed"
  | "resource_shared"
  | "resource_unshared";

export type HouseholdAuditEvidence = Readonly<{
  action: HouseholdAuditAction;
  actorUserId: string | null;
  at: Date;
  changedFields: readonly string[];
  resourceId: string | null;
  resourceKind: HouseholdResourceKind | null;
  revision: number;
  targetUserId: string | null;
}>;

export type Household = Readonly<{
  auditTrail: readonly HouseholdAuditEvidence[];
  createdAt: Date;
  id: string;
  name: string;
  ownerUserId: string;
  status: HouseholdStatus;
  updatedAt: Date;
  version: number;
}>;

export type HouseholdMembership = Readonly<{
  activatedByInvitationId: string;
  auditTrail: readonly HouseholdAuditEvidence[];
  createdAt: Date;
  displayNameSnapshot: string;
  endedAt: Date | null;
  householdId: string;
  id: string;
  joinedAt: Date;
  membershipEpoch: number;
  status: HouseholdMembershipStatus;
  updatedAt: Date;
  userId: string;
  version: number;
}>;

export type HouseholdInvitation = Readonly<{
  acceptedByUserId: string | null;
  auditTrail: readonly HouseholdAuditEvidence[];
  createdAt: Date;
  expiresAt: Date;
  householdId: string;
  id: string;
  inviteeEmailHash: string;
  inviteeHint: string;
  invitedByUserId: string;
  status: HouseholdInvitationStatus;
  updatedAt: Date;
  version: number;
}>;

export type HouseholdResourceShare = Readonly<{
  auditTrail: readonly HouseholdAuditEvidence[];
  createdAt: Date;
  householdId: string;
  id: string;
  ownerMembershipEpoch: number;
  ownerUserId: string;
  resourceId: string;
  resourceKind: HouseholdResourceKind;
  status: HouseholdShareStatus;
  updatedAt: Date;
  version: number;
}>;

export type HouseholdPrincipal = Readonly<{
  householdId: string;
  membershipEpoch: number;
  role: HouseholdRole;
  userId: string;
}>;

export type HouseholdAction =
  | "dissolve"
  | "invite"
  | "leave"
  | "manage_settings"
  | "remove_member"
  | "revoke_invitation"
  | "share_own_resource"
  | "unshare_own_resource"
  | "view_household"
  | "view_shared_resource";

const ownerActions = new Set<HouseholdAction>([
  "dissolve",
  "invite",
  "manage_settings",
  "remove_member",
  "revoke_invitation",
]);

export function householdActionAllowed(
  principal: Pick<HouseholdPrincipal, "role">,
  action: HouseholdAction,
): boolean {
  if (ownerActions.has(action)) return principal.role === "owner";
  if (action === "leave") return principal.role === "member";
  return true;
}

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const versionSchema = z.number().int().positive();

export const createHouseholdCommandSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export const updateHouseholdCommandSchema = z
  .object({
    expectedVersion: versionSchema,
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export const dissolveHouseholdCommandSchema = z
  .object({ expectedVersion: versionSchema })
  .strict();

export const createHouseholdInvitationCommandSchema = z
  .object({ email: z.string().trim().email().max(254) })
  .strict();

export const acceptHouseholdInvitationCommandSchema = z
  .object({
    token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export const versionedHouseholdMutationSchema = z
  .object({ expectedVersion: versionSchema })
  .strict();

export const householdShareCommandSchema = z
  .object({
    action: z.enum(["share", "unshare"]),
    expectedVersion: versionSchema.nullable(),
    resourceId: objectIdSchema,
    resourceKind: householdResourceKindSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "unshare" && value.expectedVersion === null) {
      context.addIssue({
        code: "custom",
        message: "Unsharing requires the current share version.",
        path: ["expectedVersion"],
      });
    }
  });

export type CreateHouseholdCommand = z.infer<typeof createHouseholdCommandSchema>;
export type UpdateHouseholdCommand = z.infer<typeof updateHouseholdCommandSchema>;
export type CreateHouseholdInvitationCommand = z.infer<
  typeof createHouseholdInvitationCommandSchema
>;
export type AcceptHouseholdInvitationCommand = z.infer<
  typeof acceptHouseholdInvitationCommandSchema
>;
export type HouseholdShareCommand = z.infer<typeof householdShareCommandSchema>;

export type HouseholdListItemView = Readonly<{
  createdAt: string;
  id: string;
  memberCount: number;
  name: string;
  role: HouseholdRole;
  version: number;
}>;

export type HouseholdMemberView = Readonly<{
  displayName: string;
  isCurrentActor: boolean;
  joinedAt: string;
  membershipId: string | null;
  role: HouseholdRole;
  version: number;
}>;

export type HouseholdInvitationView = Readonly<{
  createdAt: string;
  expiresAt: string;
  id: string;
  inviteeHint: string;
  status: HouseholdInvitationStatus;
  version: number;
}>;

export type HouseholdEligibleResourceView = Readonly<{
  label: string;
  resourceId: string;
  resourceKind: HouseholdResourceKind;
  shareId: string | null;
  shareVersion: number | null;
  shared: boolean;
}>;

export type HouseholdSharedAccountView = Readonly<{
  balance: SerializedMoney;
  label: string;
  ownerLabel: string;
  provenanceAlias: string;
}>;

export type HouseholdSharedGoalView = Readonly<{
  currentValue: SerializedMoney | null;
  label: string;
  normalizedProgressBasisPoints: number | null;
  ownerLabel: string;
  provenanceAlias: string;
  status: string;
  targetValue: SerializedMoney;
}>;

export type HouseholdAuditView = Readonly<{
  action: HouseholdAuditAction;
  actorLabel: string;
  at: string;
  resourceLabel: string | null;
  targetLabel: string | null;
}>;

export type HouseholdCenterView = Readonly<{
  audit: readonly HouseholdAuditView[];
  eligibleResources: readonly HouseholdEligibleResourceView[];
  households: readonly HouseholdListItemView[];
  invitations: readonly HouseholdInvitationView[];
  members: readonly HouseholdMemberView[];
  selected: HouseholdListItemView | null;
  sharedAccounts: readonly HouseholdSharedAccountView[];
  sharedGoals: readonly HouseholdSharedGoalView[];
  totals: readonly Readonly<{
    amount: SerializedMoney;
    contributionCount: number;
  }>[];
}>;

export type CreatedHouseholdInvitationView = Readonly<{
  invitation: HouseholdInvitationView;
  token: string;
}>;
