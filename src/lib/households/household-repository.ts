import "server-only";

import { createHash } from "node:crypto";

import {
  type Collection,
  type Db,
  MongoServerError,
  ObjectId,
} from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import {
  ConflictError,
  DependencyUnavailableError,
  NotFoundError,
} from "@/lib/errors/application-error";
import {
  HOUSEHOLD_INVITATION_POLICY_VERSION,
  HOUSEHOLD_POLICY_VERSION,
  HOUSEHOLD_SCHEMA_VERSION,
  type Household,
  type HouseholdAuditAction,
  type HouseholdAuditEvidence,
  type HouseholdInvitation,
  type HouseholdMembership,
  type HouseholdPrincipal,
  type HouseholdResourceKind,
  type HouseholdResourceShare,
  type HouseholdShareStatus,
} from "@/lib/households/household";

type HouseholdAuditEvidenceDocument = {
  action: HouseholdAuditAction;
  actorUserId: ObjectId | null;
  at: Date;
  changedFields: string[];
  resourceId: ObjectId | null;
  resourceKind: HouseholdResourceKind | null;
  revision: number;
  targetUserId: ObjectId | null;
};

type HouseholdDocument = {
  _id: ObjectId;
  auditTrail: HouseholdAuditEvidenceDocument[];
  createdAt: Date;
  idempotencyKeyHash: string;
  idempotencyPayloadHash: string;
  name: string;
  ownerUserId: ObjectId;
  policyVersion: typeof HOUSEHOLD_POLICY_VERSION;
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  status: "active" | "dissolved";
  updatedAt: Date;
  version: number;
};

type HouseholdMembershipDocument = {
  _id: ObjectId;
  activatedByInvitationId: ObjectId;
  auditTrail: HouseholdAuditEvidenceDocument[];
  createdAt: Date;
  displayNameSnapshot: string;
  endedAt: Date | null;
  householdId: ObjectId;
  joinedAt: Date;
  membershipEpoch: number;
  policyVersion: typeof HOUSEHOLD_POLICY_VERSION;
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  status: "active" | "left" | "removed";
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type HouseholdInvitationDocument = {
  _id: ObjectId;
  acceptedByUserId: ObjectId | null;
  activeInviteKey?: string;
  auditTrail: HouseholdAuditEvidenceDocument[];
  createdAt: Date;
  expiresAt: Date;
  householdId: ObjectId;
  invitationPolicyVersion: typeof HOUSEHOLD_INVITATION_POLICY_VERSION;
  inviteeEmailHash: string;
  inviteeHint: string;
  invitedByUserId: ObjectId;
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  status: "accepted" | "expired" | "pending" | "revoked";
  tokenHash: string;
  updatedAt: Date;
  version: number;
};

type HouseholdResourceShareDocument = {
  _id: ObjectId;
  auditTrail: HouseholdAuditEvidenceDocument[];
  createdAt: Date;
  householdId: ObjectId;
  ownerMembershipEpoch: number;
  ownerUserId: ObjectId;
  policyVersion: typeof HOUSEHOLD_POLICY_VERSION;
  resourceId: ObjectId;
  resourceKind: HouseholdResourceKind;
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  status: HouseholdShareStatus;
  updatedAt: Date;
  version: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function auditDocument(input: Readonly<{
  action: HouseholdAuditAction;
  actorUserId: ObjectId | null;
  at: Date;
  changedFields: readonly string[];
  resourceId?: ObjectId | null;
  resourceKind?: HouseholdResourceKind | null;
  revision: number;
  targetUserId?: ObjectId | null;
}>): HouseholdAuditEvidenceDocument {
  return {
    action: input.action,
    actorUserId: input.actorUserId,
    at: input.at,
    changedFields: [...input.changedFields],
    resourceId: input.resourceId ?? null,
    resourceKind: input.resourceKind ?? null,
    revision: input.revision,
    targetUserId: input.targetUserId ?? null,
  };
}

function mapAudit(document: HouseholdAuditEvidenceDocument): HouseholdAuditEvidence {
  return {
    action: document.action,
    actorUserId: document.actorUserId?.toHexString() ?? null,
    at: document.at,
    changedFields: document.changedFields,
    resourceId: document.resourceId?.toHexString() ?? null,
    resourceKind: document.resourceKind,
    revision: document.revision,
    targetUserId: document.targetUserId?.toHexString() ?? null,
  };
}

function assertStoredMetadata(
  id: unknown,
  createdAt: unknown,
  updatedAt: unknown,
  version: unknown,
  message: string,
): asserts id is ObjectId {
  if (
    !(id instanceof ObjectId) ||
    !(createdAt instanceof Date) ||
    !(updatedAt instanceof Date) ||
    !Number.isInteger(version) ||
    (version as number) < 1
  ) {
    throw new DependencyUnavailableError(message);
  }
}

function mapHousehold(document: HouseholdDocument): Household {
  assertStoredMetadata(
    document._id,
    document.createdAt,
    document.updatedAt,
    document.version,
    "Stored household metadata is invalid.",
  );
  if (!(document.ownerUserId instanceof ObjectId)) {
    throw new DependencyUnavailableError("Stored household ownership is invalid.");
  }
  return {
    auditTrail: document.auditTrail.map(mapAudit),
    createdAt: document.createdAt,
    id: document._id.toHexString(),
    name: document.name,
    ownerUserId: document.ownerUserId.toHexString(),
    status: document.status,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

function mapMembership(document: HouseholdMembershipDocument): HouseholdMembership {
  assertStoredMetadata(
    document._id,
    document.createdAt,
    document.updatedAt,
    document.version,
    "Stored household membership metadata is invalid.",
  );
  if (
    !(document.householdId instanceof ObjectId) ||
    !(document.userId instanceof ObjectId) ||
    !(document.activatedByInvitationId instanceof ObjectId) ||
    !(document.joinedAt instanceof Date) ||
    !Number.isInteger(document.membershipEpoch) ||
    document.membershipEpoch < 1
  ) {
    throw new DependencyUnavailableError("Stored household membership is invalid.");
  }
  return {
    activatedByInvitationId: document.activatedByInvitationId.toHexString(),
    auditTrail: document.auditTrail.map(mapAudit),
    createdAt: document.createdAt,
    displayNameSnapshot: document.displayNameSnapshot,
    endedAt: document.endedAt,
    householdId: document.householdId.toHexString(),
    id: document._id.toHexString(),
    joinedAt: document.joinedAt,
    membershipEpoch: document.membershipEpoch,
    status: document.status,
    updatedAt: document.updatedAt,
    userId: document.userId.toHexString(),
    version: document.version,
  };
}

function mapInvitation(document: HouseholdInvitationDocument): HouseholdInvitation {
  assertStoredMetadata(
    document._id,
    document.createdAt,
    document.updatedAt,
    document.version,
    "Stored household invitation metadata is invalid.",
  );
  if (
    !(document.householdId instanceof ObjectId) ||
    !(document.invitedByUserId instanceof ObjectId) ||
    !(document.expiresAt instanceof Date)
  ) {
    throw new DependencyUnavailableError("Stored household invitation is invalid.");
  }
  return {
    acceptedByUserId: document.acceptedByUserId?.toHexString() ?? null,
    auditTrail: document.auditTrail.map(mapAudit),
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    householdId: document.householdId.toHexString(),
    id: document._id.toHexString(),
    inviteeEmailHash: document.inviteeEmailHash,
    inviteeHint: document.inviteeHint,
    invitedByUserId: document.invitedByUserId.toHexString(),
    status: document.status,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

function mapShare(document: HouseholdResourceShareDocument): HouseholdResourceShare {
  assertStoredMetadata(
    document._id,
    document.createdAt,
    document.updatedAt,
    document.version,
    "Stored household share metadata is invalid.",
  );
  if (
    !(document.householdId instanceof ObjectId) ||
    !(document.ownerUserId instanceof ObjectId) ||
    !(document.resourceId instanceof ObjectId) ||
    !Number.isInteger(document.ownerMembershipEpoch) ||
    document.ownerMembershipEpoch < 1
  ) {
    throw new DependencyUnavailableError("Stored household share is invalid.");
  }
  return {
    auditTrail: document.auditTrail.map(mapAudit),
    createdAt: document.createdAt,
    householdId: document.householdId.toHexString(),
    id: document._id.toHexString(),
    ownerMembershipEpoch: document.ownerMembershipEpoch,
    ownerUserId: document.ownerUserId.toHexString(),
    resourceId: document.resourceId.toHexString(),
    resourceKind: document.resourceKind,
    status: document.status,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

export class HouseholdRepository {
  constructor(
    private readonly households: Collection<HouseholdDocument>,
    private readonly memberships: Collection<HouseholdMembershipDocument>,
    private readonly invitations: Collection<HouseholdInvitationDocument>,
    private readonly shares: Collection<HouseholdResourceShareDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.households.createIndex(
        { ownerUserId: 1, status: 1, _id: 1 },
        { name: "households_owner_status" },
      ),
      this.households.createIndex(
        { ownerUserId: 1, idempotencyKeyHash: 1 },
        { name: "households_owner_idempotency", unique: true },
      ),
      this.memberships.createIndex(
        { householdId: 1, userId: 1 },
        { name: "household_members_unique", unique: true },
      ),
      this.memberships.createIndex(
        { userId: 1, status: 1, householdId: 1 },
        { name: "household_members_user_status" },
      ),
      this.memberships.createIndex(
        { householdId: 1, status: 1, _id: 1 },
        { name: "household_members_household_status" },
      ),
      this.invitations.createIndex(
        { tokenHash: 1 },
        { name: "household_invitations_token", unique: true },
      ),
      this.invitations.createIndex(
        { activeInviteKey: 1 },
        {
          name: "household_invitations_one_active",
          partialFilterExpression: { activeInviteKey: { $type: "string" } },
          unique: true,
        },
      ),
      this.invitations.createIndex(
        { householdId: 1, status: 1, expiresAt: 1, _id: 1 },
        { name: "household_invitations_household_status" },
      ),
      this.shares.createIndex(
        { householdId: 1, resourceKind: 1, resourceId: 1 },
        { name: "household_shares_unique_resource", unique: true },
      ),
      this.shares.createIndex(
        { householdId: 1, status: 1, ownerUserId: 1, _id: 1 },
        { name: "household_shares_household_status_owner" },
      ),
    ]);
  }

  async createHouseholdForActor(
    actor: Actor,
    name: string,
    idempotencyKey: string,
  ): Promise<Household> {
    const ownerUserId = parseObjectId(actor.userId, "actor.userId");
    const keyHash = sha256(idempotencyKey);
    const payloadHash = sha256(name);
    const existing = await this.households.findOne({
      idempotencyKeyHash: keyHash,
      ownerUserId,
    });
    if (existing !== null) {
      if (existing.idempotencyPayloadHash !== payloadHash) {
        throw new ConflictError("The idempotency key was used for another household.");
      }
      return mapHousehold(existing);
    }
    const now = this.now();
    const document: HouseholdDocument = {
      _id: new ObjectId(),
      auditTrail: [
        auditDocument({
          action: "household_created",
          actorUserId: ownerUserId,
          at: now,
          changedFields: ["name", "status"],
          revision: 1,
          targetUserId: ownerUserId,
        }),
      ],
      createdAt: now,
      idempotencyKeyHash: keyHash,
      idempotencyPayloadHash: payloadHash,
      name,
      ownerUserId,
      policyVersion: HOUSEHOLD_POLICY_VERSION,
      schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
      status: "active",
      updatedAt: now,
      version: 1,
    };
    try {
      await this.households.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const retry = await this.households.findOne({
          idempotencyKeyHash: keyHash,
          ownerUserId,
        });
        if (retry !== null && retry.idempotencyPayloadHash === payloadHash) {
          return mapHousehold(retry);
        }
        throw new ConflictError();
      }
      throw error;
    }
    return mapHousehold(document);
  }

  async findHousehold(householdId: string): Promise<Household | null> {
    const document = await this.households.findOne({
      _id: parseObjectId(householdId, "householdId"),
    });
    return document === null ? null : mapHousehold(document);
  }

  async listActiveForActor(actor: Actor, maximum = 50): Promise<readonly Household[]> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const memberships = await this.memberships
      .find({ status: "active", userId }, { projection: { householdId: 1 } })
      .limit(maximum + 1)
      .toArray();
    const householdIds = memberships.map((membership) => membership.householdId);
    const documents = await this.households
      .find({
        status: "active",
        $or: [
          { ownerUserId: userId },
          ...(householdIds.length === 0 ? [] : [{ _id: { $in: householdIds } }]),
        ],
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(maximum + 1)
      .toArray();
    if (documents.length > maximum) {
      throw new DependencyUnavailableError("The household list exceeds its bounded result set.");
    }
    return documents.map(mapHousehold);
  }

  async principalForActor(
    actor: Actor,
    householdId: string,
  ): Promise<Readonly<{ household: Household; principal: HouseholdPrincipal }> | null> {
    const household = await this.findHousehold(householdId);
    if (household === null || household.status !== "active") return null;
    if (household.ownerUserId === actor.userId) {
      return {
        household,
        principal: { householdId, membershipEpoch: 1, role: "owner", userId: actor.userId },
      };
    }
    const membership = await this.memberships.findOne({
      householdId: parseObjectId(householdId, "householdId"),
      status: "active",
      userId: parseObjectId(actor.userId, "actor.userId"),
    });
    if (membership === null) return null;
    return {
      household,
      principal: {
        householdId,
        membershipEpoch: membership.membershipEpoch,
        role: "member",
        userId: actor.userId,
      },
    };
  }

  async updateHousehold(
    actor: Actor,
    householdId: string,
    name: string,
    expectedVersion: number,
  ): Promise<Household> {
    const now = this.now();
    const updated = await this.households.findOneAndUpdate(
      {
        _id: parseObjectId(householdId, "householdId"),
        ownerUserId: parseObjectId(actor.userId, "actor.userId"),
        status: "active",
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: "household_settings_updated",
            actorUserId: parseObjectId(actor.userId, "actor.userId"),
            at: now,
            changedFields: ["name"],
            revision: expectedVersion + 1,
          }),
        },
        $set: { name, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapHousehold(updated);
  }

  async dissolveHousehold(
    actor: Actor,
    householdId: string,
    expectedVersion: number,
  ): Promise<Household> {
    const now = this.now();
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const updated = await this.households.findOneAndUpdate(
      {
        _id: parseObjectId(householdId, "householdId"),
        ownerUserId: actorUserId,
        status: "active",
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: "household_dissolved",
            actorUserId,
            at: now,
            changedFields: ["status"],
            revision: expectedVersion + 1,
          }),
        },
        $set: { status: "dissolved", updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapHousehold(updated);
  }

  async listActiveMemberships(
    householdId: string,
    maximum = 50,
  ): Promise<readonly HouseholdMembership[]> {
    const documents = await this.memberships
      .find({ householdId: parseObjectId(householdId, "householdId"), status: "active" })
      .sort({ joinedAt: 1, _id: 1 })
      .limit(maximum + 1)
      .toArray();
    if (documents.length > maximum) {
      throw new DependencyUnavailableError("The member list exceeds its bounded result set.");
    }
    return documents.map(mapMembership);
  }

  async findActiveMembershipForUser(
    householdId: string,
    userId: string,
  ): Promise<HouseholdMembership | null> {
    const document = await this.memberships.findOne({
      householdId: parseObjectId(householdId, "householdId"),
      status: "active",
      userId: parseObjectId(userId, "userId"),
    });
    return document === null ? null : mapMembership(document);
  }

  async findMembershipById(
    householdId: string,
    membershipId: string,
  ): Promise<HouseholdMembership | null> {
    const document = await this.memberships.findOne({
      _id: parseObjectId(membershipId, "membershipId"),
      householdId: parseObjectId(householdId, "householdId"),
    });
    return document === null ? null : mapMembership(document);
  }

  async activateMembership(
    invitation: HouseholdInvitation,
    userId: string,
    displayName: string,
  ): Promise<HouseholdMembership> {
    const householdId = parseObjectId(invitation.householdId, "householdId");
    const memberUserId = parseObjectId(userId, "userId");
    const invitationId = parseObjectId(invitation.id, "invitationId");
    const existing = await this.memberships.findOne({ householdId, userId: memberUserId });
    if (existing?.status === "active") {
      if (existing.activatedByInvitationId.equals(invitationId)) return mapMembership(existing);
      throw new ConflictError("The user is already an active household member.");
    }
    const now = this.now();
    if (existing === null) {
      const document: HouseholdMembershipDocument = {
        _id: new ObjectId(),
        activatedByInvitationId: invitationId,
        auditTrail: [
          auditDocument({
            action: "invitation_accepted",
            actorUserId: memberUserId,
            at: now,
            changedFields: ["status", "membershipEpoch"],
            revision: 1,
            targetUserId: memberUserId,
          }),
        ],
        createdAt: now,
        displayNameSnapshot: displayName,
        endedAt: null,
        householdId,
        joinedAt: now,
        membershipEpoch: 1,
        policyVersion: HOUSEHOLD_POLICY_VERSION,
        schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
        status: "active",
        updatedAt: now,
        userId: memberUserId,
        version: 1,
      };
      try {
        await this.memberships.insertOne(document);
        return mapMembership(document);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          const retry = await this.memberships.findOne({ householdId, userId: memberUserId });
          if (retry !== null && retry.activatedByInvitationId.equals(invitationId)) {
            return mapMembership(retry);
          }
          throw new ConflictError();
        }
        throw error;
      }
    }
    const nextVersion = existing.version + 1;
    const updated = await this.memberships.findOneAndUpdate(
      { _id: existing._id, status: { $ne: "active" }, version: existing.version },
      {
        $inc: { membershipEpoch: 1, version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: "invitation_accepted",
            actorUserId: memberUserId,
            at: now,
            changedFields: ["status", "membershipEpoch"],
            revision: nextVersion,
            targetUserId: memberUserId,
          }),
        },
        $set: {
          activatedByInvitationId: invitationId,
          displayNameSnapshot: displayName,
          endedAt: null,
          joinedAt: now,
          status: "active",
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapMembership(updated);
  }

  async endMembership(input: Readonly<{
    action: "member_left" | "member_removed";
    actorUserId: string;
    expectedVersion: number;
    householdId: string;
    membershipId: string;
    status: "left" | "removed";
  }>): Promise<HouseholdMembership> {
    const now = this.now();
    const updated = await this.memberships.findOneAndUpdate(
      {
        _id: parseObjectId(input.membershipId, "membershipId"),
        householdId: parseObjectId(input.householdId, "householdId"),
        status: "active",
        version: input.expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: input.action,
            actorUserId: parseObjectId(input.actorUserId, "actor.userId"),
            at: now,
            changedFields: ["status", "endedAt"],
            revision: input.expectedVersion + 1,
          }),
        },
        $set: { endedAt: now, status: input.status, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapMembership(updated);
  }

  private async expireInvitationDocument(
    document: HouseholdInvitationDocument,
    at: Date,
  ): Promise<HouseholdInvitation> {
    const updated = await this.invitations.findOneAndUpdate(
      { _id: document._id, status: "pending", version: document.version },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: "invitation_expired",
            actorUserId: null,
            at,
            changedFields: ["status"],
            revision: document.version + 1,
          }),
        },
        $set: { status: "expired", updatedAt: at },
        $unset: { activeInviteKey: "" },
      },
      { returnDocument: "after" },
    );
    return mapInvitation(updated ?? document);
  }

  async expirePendingInvitations(householdId: string): Promise<void> {
    const now = this.now();
    const expired = await this.invitations
      .find({
        expiresAt: { $lte: now },
        householdId: parseObjectId(householdId, "householdId"),
        status: "pending",
      })
      .limit(100)
      .toArray();
    await Promise.all(expired.map((document) => this.expireInvitationDocument(document, now)));
  }

  async createInvitation(input: Readonly<{
    expiresAt: Date;
    householdId: string;
    inviteeEmailHash: string;
    inviteeHint: string;
    invitedByUserId: string;
    tokenHash: string;
  }>): Promise<HouseholdInvitation> {
    await this.expirePendingInvitations(input.householdId);
    const householdId = parseObjectId(input.householdId, "householdId");
    const invitedByUserId = parseObjectId(input.invitedByUserId, "actor.userId");
    const now = this.now();
    const document: HouseholdInvitationDocument = {
      _id: new ObjectId(),
      acceptedByUserId: null,
      activeInviteKey: `${input.householdId}:${input.inviteeEmailHash}`,
      auditTrail: [
        auditDocument({
          action: "invitation_created",
          actorUserId: invitedByUserId,
          at: now,
          changedFields: ["status", "expiresAt"],
          revision: 1,
        }),
      ],
      createdAt: now,
      expiresAt: input.expiresAt,
      householdId,
      invitationPolicyVersion: HOUSEHOLD_INVITATION_POLICY_VERSION,
      inviteeEmailHash: input.inviteeEmailHash,
      inviteeHint: input.inviteeHint,
      invitedByUserId,
      schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
      status: "pending",
      tokenHash: input.tokenHash,
      updatedAt: now,
      version: 1,
    };
    try {
      await this.invitations.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictError("An active invitation already exists.");
      }
      throw error;
    }
    return mapInvitation(document);
  }

  async listInvitations(
    householdId: string,
    maximum = 100,
  ): Promise<readonly HouseholdInvitation[]> {
    await this.expirePendingInvitations(householdId);
    const documents = await this.invitations
      .find({ householdId: parseObjectId(householdId, "householdId") })
      .sort({ createdAt: -1, _id: -1 })
      .limit(maximum + 1)
      .toArray();
    if (documents.length > maximum) {
      throw new DependencyUnavailableError("The invitation history exceeds its bounded result set.");
    }
    return documents.map(mapInvitation);
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<HouseholdInvitation | null> {
    const document = await this.invitations.findOne({ tokenHash });
    if (document === null) return null;
    if (document.status === "pending" && document.expiresAt.getTime() <= this.now().getTime()) {
      return this.expireInvitationDocument(document, this.now());
    }
    return mapInvitation(document);
  }

  async markInvitationAccepted(
    invitationId: string,
    acceptedByUserId: string,
    expectedVersion: number,
  ): Promise<HouseholdInvitation> {
    const now = this.now();
    const acceptedUserId = parseObjectId(acceptedByUserId, "actor.userId");
    const updated = await this.invitations.findOneAndUpdate(
      {
        _id: parseObjectId(invitationId, "invitationId"),
        expiresAt: { $gt: now },
        status: "pending",
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: "invitation_accepted",
            actorUserId: acceptedUserId,
            at: now,
            changedFields: ["status"],
            revision: expectedVersion + 1,
            targetUserId: acceptedUserId,
          }),
        },
        $set: { acceptedByUserId: acceptedUserId, status: "accepted", updatedAt: now },
        $unset: { activeInviteKey: "" },
      },
      { returnDocument: "after" },
    );
    if (updated !== null) return mapInvitation(updated);
    const existing = await this.invitations.findOne({
      _id: parseObjectId(invitationId, "invitationId"),
    });
    if (
      existing?.status === "accepted" &&
      existing.acceptedByUserId?.equals(acceptedUserId) === true
    ) {
      return mapInvitation(existing);
    }
    throw new ConflictError("The invitation is no longer available.");
  }

  async revokeInvitation(
    actor: Actor,
    householdId: string,
    invitationId: string,
    expectedVersion: number,
  ): Promise<HouseholdInvitation> {
    const now = this.now();
    const updated = await this.invitations.findOneAndUpdate(
      {
        _id: parseObjectId(invitationId, "invitationId"),
        householdId: parseObjectId(householdId, "householdId"),
        status: "pending",
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: "invitation_revoked",
            actorUserId: parseObjectId(actor.userId, "actor.userId"),
            at: now,
            changedFields: ["status"],
            revision: expectedVersion + 1,
          }),
        },
        $set: { status: "revoked", updatedAt: now },
        $unset: { activeInviteKey: "" },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapInvitation(updated);
  }

  async findShare(
    householdId: string,
    resourceKind: HouseholdResourceKind,
    resourceId: string,
  ): Promise<HouseholdResourceShare | null> {
    const document = await this.shares.findOne({
      householdId: parseObjectId(householdId, "householdId"),
      resourceId: parseObjectId(resourceId, "resourceId"),
      resourceKind,
    });
    return document === null ? null : mapShare(document);
  }

  async setShare(input: Readonly<{
    action: "share" | "unshare";
    actorUserId: string;
    expectedVersion: number | null;
    householdId: string;
    ownerMembershipEpoch: number;
    resourceId: string;
    resourceKind: HouseholdResourceKind;
  }>): Promise<HouseholdResourceShare> {
    const householdId = parseObjectId(input.householdId, "householdId");
    const ownerUserId = parseObjectId(input.actorUserId, "actor.userId");
    const resourceId = parseObjectId(input.resourceId, "resourceId");
    const existing = await this.shares.findOne({ householdId, resourceId, resourceKind: input.resourceKind });
    const now = this.now();
    if (existing === null) {
      if (input.action !== "share" || input.expectedVersion !== null) throw new ConflictError();
      const document: HouseholdResourceShareDocument = {
        _id: new ObjectId(),
        auditTrail: [
          auditDocument({
            action: "resource_shared",
            actorUserId: ownerUserId,
            at: now,
            changedFields: ["status"],
            resourceId,
            resourceKind: input.resourceKind,
            revision: 1,
          }),
        ],
        createdAt: now,
        householdId,
        ownerMembershipEpoch: input.ownerMembershipEpoch,
        ownerUserId,
        policyVersion: HOUSEHOLD_POLICY_VERSION,
        resourceId,
        resourceKind: input.resourceKind,
        schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
        status: "shared",
        updatedAt: now,
        version: 1,
      };
      try {
        await this.shares.insertOne(document);
        return mapShare(document);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError();
        throw error;
      }
    }
    if (
      input.expectedVersion !== existing.version ||
      !existing.ownerUserId.equals(ownerUserId)
    ) {
      throw new ConflictError();
    }
    const desiredStatus: HouseholdShareStatus = input.action === "share" ? "shared" : "unshared";
    if (
      existing.status === desiredStatus &&
      existing.ownerMembershipEpoch === input.ownerMembershipEpoch
    ) {
      throw new ConflictError();
    }
    const updated = await this.shares.findOneAndUpdate(
      { _id: existing._id, ownerUserId, version: existing.version },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: auditDocument({
            action: input.action === "share" ? "resource_shared" : "resource_unshared",
            actorUserId: ownerUserId,
            at: now,
            changedFields: ["status", "ownerMembershipEpoch"],
            resourceId,
            resourceKind: input.resourceKind,
            revision: existing.version + 1,
          }),
        },
        $set: {
          ownerMembershipEpoch: input.ownerMembershipEpoch,
          status: desiredStatus,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return mapShare(updated);
  }

  async listShares(
    householdId: string,
    maximum = 500,
  ): Promise<readonly HouseholdResourceShare[]> {
    const documents = await this.shares
      .find({ householdId: parseObjectId(householdId, "householdId") })
      .sort({ createdAt: 1, _id: 1 })
      .limit(maximum + 1)
      .toArray();
    if (documents.length > maximum) {
      throw new DependencyUnavailableError("The household share list exceeds its bound.");
    }
    return documents.map(mapShare);
  }

  async listAudit(householdId: string): Promise<readonly HouseholdAuditEvidence[]> {
    const [household, invitations, memberships, shares] = await Promise.all([
      this.findHousehold(householdId),
      this.listInvitations(householdId),
      this.memberships
        .find({ householdId: parseObjectId(householdId, "householdId") })
        .limit(100)
        .toArray(),
      this.listShares(householdId),
    ]);
    if (household === null) throw new NotFoundError();
    return [
      ...household.auditTrail,
      ...invitations.flatMap((invitation) => invitation.auditTrail),
      ...memberships.flatMap((membership) => mapMembership(membership).auditTrail),
      ...shares.flatMap((share) => share.auditTrail),
    ]
      .sort((first, second) => second.at.getTime() - first.at.getTime())
      .slice(0, 200);
  }
}

export function householdRepositoryForDatabase(database: Db, now?: () => Date): HouseholdRepository {
  return new HouseholdRepository(
    database.collection<HouseholdDocument>("households"),
    database.collection<HouseholdMembershipDocument>("householdMemberships"),
    database.collection<HouseholdInvitationDocument>("householdInvitations"),
    database.collection<HouseholdResourceShareDocument>("householdResourceShares"),
    now,
  );
}

export async function getHouseholdRepository(): Promise<HouseholdRepository> {
  const repository = householdRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
