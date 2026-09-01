import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Actor } from "@/lib/auth/actor";
import { money, serializeMoney } from "@/lib/domain/money/money";
import {
  ConflictError,
  NotFoundError,
} from "@/lib/errors/application-error";
import {
  type CreatedHouseholdInvitationView,
  type CreateHouseholdCommand,
  type CreateHouseholdInvitationCommand,
  HOUSEHOLD_INVITATION_TTL_MS,
  type Household,
  type HouseholdAction,
  householdActionAllowed,
  type HouseholdAuditEvidence,
  type HouseholdCenterView,
  type HouseholdEligibleResourceView,
  type HouseholdInvitation,
  type HouseholdInvitationView,
  type HouseholdListItemView,
  type HouseholdMemberView,
  type HouseholdPrincipal,
  type HouseholdResourceShare,
  type HouseholdShareCommand,
  type UpdateHouseholdCommand,
} from "@/lib/households/household";
import {
  getHouseholdIdentityRepository,
  hashHouseholdEmail,
  maskHouseholdEmail,
  type HouseholdIdentityRepository,
} from "@/lib/households/household-identity-repository";
import {
  getHouseholdRepository,
  type HouseholdRepository,
} from "@/lib/households/household-repository";
import {
  getGoalRepository,
  type GoalRepository,
} from "@/lib/goals/goal-repository";
import {
  manualSectionDomainSchemas,
  type ManualRecord,
} from "@/lib/onboarding/manual-record";
import {
  getManualRecordRepository,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";

export type HouseholdServiceDependencies = Readonly<{
  accountRepository?: ManualRecordRepository;
  goalRecordRepository?: ManualRecordRepository;
  goalRepository?: GoalRepository;
  identityRepository?: HouseholdIdentityRepository;
  now?: () => Date;
  repository?: HouseholdRepository;
  tokenFactory?: () => string;
}>;

type ResolvedHouseholdDependencies = Readonly<{
  accountRepository: ManualRecordRepository;
  goalRecordRepository: ManualRecordRepository;
  goalRepository: GoalRepository;
  identityRepository: HouseholdIdentityRepository;
  now: () => Date;
  repository: HouseholdRepository;
  tokenFactory: () => string;
}>;

async function resolveDependencies(
  dependencies?: HouseholdServiceDependencies,
): Promise<ResolvedHouseholdDependencies> {
  return {
    accountRepository:
      dependencies?.accountRepository ?? (await getManualRecordRepository("accounts")),
    goalRecordRepository:
      dependencies?.goalRecordRepository ?? (await getManualRecordRepository("goals")),
    goalRepository: dependencies?.goalRepository ?? (await getGoalRepository()),
    identityRepository:
      dependencies?.identityRepository ?? (await getHouseholdIdentityRepository()),
    now: dependencies?.now ?? (() => new Date()),
    repository: dependencies?.repository ?? (await getHouseholdRepository()),
    tokenFactory:
      dependencies?.tokenFactory ?? (() => randomBytes(32).toString("base64url")),
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function actorForUserId(userId: string): Actor {
  return { kind: "user", userId };
}

async function requirePrincipal(
  actor: Actor,
  householdId: string,
  action: HouseholdAction,
  repository: HouseholdRepository,
): Promise<Readonly<{ household: Household; principal: HouseholdPrincipal }>> {
  const resolved = await repository.principalForActor(actor, householdId);
  if (resolved === null || !householdActionAllowed(resolved.principal, action)) {
    throw new NotFoundError();
  }
  return resolved;
}

async function listItem(
  actor: Actor,
  household: Household,
  repository: HouseholdRepository,
): Promise<HouseholdListItemView> {
  const principal = await repository.principalForActor(actor, household.id);
  if (principal === null) throw new NotFoundError();
  return {
    createdAt: household.createdAt.toISOString(),
    id: household.id,
    memberCount: 1 + (await repository.listActiveMemberships(household.id)).length,
    name: household.name,
    role: principal.principal.role,
    version: household.version,
  };
}

function invitationView(invitation: HouseholdInvitation): HouseholdInvitationView {
  return {
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    id: invitation.id,
    inviteeHint: invitation.inviteeHint,
    status: invitation.status,
    version: invitation.version,
  };
}

function accountFields(record: ManualRecord) {
  return manualSectionDomainSchemas.accounts.parse(record.fields);
}

function goalFields(record: ManualRecord) {
  return manualSectionDomainSchemas.goals.parse(record.fields);
}

function activeOwnedShare(
  shares: readonly HouseholdResourceShare[],
  actor: Actor,
  resourceId: string,
  resourceKind: "account" | "goal",
): HouseholdResourceShare | null {
  return (
    shares.find(
      (share) =>
        share.ownerUserId === actor.userId &&
        share.resourceId === resourceId &&
        share.resourceKind === resourceKind,
    ) ?? null
  );
}

async function eligibleResources(
  actor: Actor,
  membershipEpoch: number,
  shares: readonly HouseholdResourceShare[],
  dependencies: ResolvedHouseholdDependencies,
): Promise<readonly HouseholdEligibleResourceView[]> {
  const [accounts, definitions] = await Promise.all([
    dependencies.accountRepository.listForActor(actor),
    dependencies.goalRepository.listLatestDefinitionsForActor(actor),
  ]);
  const goalRecords = new Map(
    (await dependencies.goalRecordRepository.listForActor(actor)).map((record) => [
      record.id,
      record,
    ]),
  );
  const accountViews = accounts.map((account) => {
    const share = activeOwnedShare(
      shares,
      actor,
      account.id,
      "account",
    );
    return {
      label: accountFields(account).name,
      resourceId: account.id,
      resourceKind: "account" as const,
      shareId: share?.id ?? null,
      shareVersion: share?.version ?? null,
      shared:
        share?.status === "shared" &&
        share.ownerMembershipEpoch === membershipEpoch,
    };
  });
  const goalViews = definitions.flatMap((definition) => {
    const record = goalRecords.get(definition.goalId);
    if (record === undefined) return [];
    const share = activeOwnedShare(
      shares,
      actor,
      definition.goalId,
      "goal",
    );
    return [
      {
        label: goalFields(record).title,
        resourceId: definition.goalId,
        resourceKind: "goal" as const,
        shareId: share?.id ?? null,
        shareVersion: share?.version ?? null,
        shared:
          share?.status === "shared" &&
          share.ownerMembershipEpoch === membershipEpoch,
      },
    ];
  });
  return [...accountViews, ...goalViews];
}

async function memberEpochs(
  household: Household,
  repository: HouseholdRepository,
): Promise<ReadonlyMap<string, number>> {
  return new Map([
    [household.ownerUserId, 1],
    ...(await repository.listActiveMemberships(household.id)).map(
      (member) => [member.userId, member.membershipEpoch] as const,
    ),
  ]);
}

async function sharedProjection(
  household: Household,
  shares: readonly HouseholdResourceShare[],
  names: ReadonlyMap<string, string>,
  dependencies: ResolvedHouseholdDependencies,
): Promise<Pick<HouseholdCenterView, "sharedAccounts" | "sharedGoals" | "totals">> {
  const epochs = await memberEpochs(household, dependencies.repository);
  const activeShares = shares.filter(
    (share) =>
      share.status === "shared" &&
      epochs.get(share.ownerUserId) === share.ownerMembershipEpoch,
  );
  const totals = new Map<string, Readonly<{ amountMinor: bigint; count: number }>>();
  const sharedAccounts: HouseholdCenterView["sharedAccounts"][number][] = [];
  const sharedGoals: HouseholdCenterView["sharedGoals"][number][] = [];
  let accountAlias = 0;
  let goalAlias = 0;
  for (const share of activeShares) {
    const resourceActor = actorForUserId(share.ownerUserId);
    const ownerLabel = names.get(share.ownerUserId) ?? "חבר/ת משק הבית";
    if (share.resourceKind === "account") {
      const account = await dependencies.accountRepository.findForActor(
        resourceActor,
        share.resourceId,
      );
      if (account === null) continue;
      const fields = accountFields(account);
      const previous = totals.get(fields.balance.currency) ?? { amountMinor: 0n, count: 0 };
      totals.set(fields.balance.currency, {
        amountMinor: previous.amountMinor + fields.balance.amountMinor,
        count: previous.count + 1,
      });
      accountAlias += 1;
      sharedAccounts.push({
        balance: serializeMoney(fields.balance),
        label: fields.name,
        ownerLabel,
        provenanceAlias: `household.account.${accountAlias}`,
      });
      continue;
    }
    const definition = await dependencies.goalRepository.findLatestDefinitionForActor(
      resourceActor,
      share.resourceId,
    );
    const goalRecord = await dependencies.goalRecordRepository.findForActor(
      resourceActor,
      share.resourceId,
    );
    if (definition === null || goalRecord === null) continue;
    const progress = await dependencies.goalRepository.findLatestProgressForActor(
      resourceActor,
      definition.goalId,
      definition.version,
    );
    const fields = goalFields(goalRecord);
    goalAlias += 1;
    sharedGoals.push({
      currentValue:
        progress === null ? null : serializeMoney(progress.result.currentValue),
      label: fields.title,
      normalizedProgressBasisPoints:
        progress?.result.normalizedProgressBasisPoints ?? null,
      ownerLabel,
      provenanceAlias: `household.goal.${goalAlias}`,
      status: progress?.result.status ?? "not_evaluated",
      targetValue: serializeMoney(definition.reportedEvidence.targetAmount),
    });
  }
  return {
    sharedAccounts,
    sharedGoals,
    totals: [...totals.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([currency, total]) => ({
        amount: serializeMoney(money(total.amountMinor, currency)),
        contributionCount: total.count,
      })),
  };
}

function auditViews(
  audit: readonly HouseholdAuditEvidence[],
  names: ReadonlyMap<string, string>,
): HouseholdCenterView["audit"] {
  return audit.map((evidence) => ({
    action: evidence.action,
    actorLabel:
      evidence.actorUserId === null
        ? "מערכת Financial OS"
        : (names.get(evidence.actorUserId) ?? "חבר/ת משק הבית"),
    at: evidence.at.toISOString(),
    resourceLabel:
      evidence.resourceKind === "account"
        ? "חשבון משותף"
        : evidence.resourceKind === "goal"
          ? "יעד משותף"
          : null,
    targetLabel:
      evidence.targetUserId === null ||
      evidence.targetUserId === evidence.actorUserId
        ? null
        : (names.get(evidence.targetUserId) ?? "חבר/ת משק הבית"),
  }));
}

export async function createHousehold(
  actor: Actor,
  command: CreateHouseholdCommand,
  dependencies?: HouseholdServiceDependencies,
): Promise<HouseholdListItemView> {
  const resolved = await resolveDependencies(dependencies);
  await resolved.identityRepository.resolveActor(actor);
  const household = await resolved.repository.createHouseholdForActor(
    actor,
    command.name,
    command.idempotencyKey,
  );
  return listItem(actor, household, resolved.repository);
}

export async function updateHousehold(
  actor: Actor,
  householdId: string,
  command: UpdateHouseholdCommand,
  dependencies?: HouseholdServiceDependencies,
): Promise<HouseholdListItemView> {
  const resolved = await resolveDependencies(dependencies);
  await requirePrincipal(actor, householdId, "manage_settings", resolved.repository);
  return listItem(
    actor,
    await resolved.repository.updateHousehold(
      actor,
      householdId,
      command.name,
      command.expectedVersion,
    ),
    resolved.repository,
  );
}

export async function dissolveHousehold(
  actor: Actor,
  householdId: string,
  expectedVersion: number,
  dependencies?: HouseholdServiceDependencies,
): Promise<void> {
  const resolved = await resolveDependencies(dependencies);
  await requirePrincipal(actor, householdId, "dissolve", resolved.repository);
  await resolved.repository.dissolveHousehold(actor, householdId, expectedVersion);
}

export async function createHouseholdInvitation(
  actor: Actor,
  householdId: string,
  command: CreateHouseholdInvitationCommand,
  dependencies?: HouseholdServiceDependencies,
): Promise<CreatedHouseholdInvitationView> {
  const resolved = await resolveDependencies(dependencies);
  await requirePrincipal(actor, householdId, "invite", resolved.repository);
  const [ownerIdentity, existingUserId] = await Promise.all([
    resolved.identityRepository.resolveActor(actor),
    resolved.identityRepository.findUserIdByEmail(command.email),
  ]);
  const inviteeEmailHash = hashHouseholdEmail(command.email);
  if (inviteeEmailHash === ownerIdentity.emailHash) {
    throw new ConflictError("A household owner cannot invite themselves.");
  }
  if (
    existingUserId !== null &&
    (await resolved.repository.findActiveMembershipForUser(householdId, existingUserId)) !== null
  ) {
    throw new ConflictError("The user is already an active household member.");
  }
  const token = resolved.tokenFactory();
  const invitation = await resolved.repository.createInvitation({
    expiresAt: new Date(resolved.now().getTime() + HOUSEHOLD_INVITATION_TTL_MS),
    householdId,
    inviteeEmailHash,
    inviteeHint: maskHouseholdEmail(command.email),
    invitedByUserId: actor.userId,
    tokenHash: tokenHash(token),
  });
  return { invitation: invitationView(invitation), token };
}

export async function acceptHouseholdInvitation(
  actor: Actor,
  token: string,
  dependencies?: HouseholdServiceDependencies,
): Promise<HouseholdListItemView> {
  const resolved = await resolveDependencies(dependencies);
  const [identity, invitation] = await Promise.all([
    resolved.identityRepository.resolveActor(actor),
    resolved.repository.findInvitationByTokenHash(tokenHash(token)),
  ]);
  if (invitation === null || invitation.inviteeEmailHash !== identity.emailHash) {
    throw new NotFoundError();
  }
  const alreadyAcceptedByActor =
    invitation.status === "accepted" && invitation.acceptedByUserId === actor.userId;
  const availablePendingInvitation =
    invitation.status === "pending" &&
    invitation.expiresAt.getTime() > resolved.now().getTime();
  if (!availablePendingInvitation && !alreadyAcceptedByActor) throw new NotFoundError();
  const household = await resolved.repository.findHousehold(invitation.householdId);
  if (
    household === null ||
    household.status !== "active" ||
    household.ownerUserId === actor.userId
  ) {
    throw new NotFoundError();
  }
  if (
    alreadyAcceptedByActor &&
    (await resolved.repository.findActiveMembershipForUser(
      invitation.householdId,
      actor.userId,
    )) !== null
  ) {
    throw new NotFoundError();
  }
  const acceptedInvitation = availablePendingInvitation
    ? await resolved.repository.markInvitationAccepted(
        invitation.id,
        actor.userId,
        invitation.version,
      )
    : invitation;
  const membership = await resolved.repository.activateMembership(
    acceptedInvitation,
    actor.userId,
    identity.displayName,
  );
  if (membership.activatedByInvitationId !== acceptedInvitation.id) {
    throw new ConflictError();
  }
  return listItem(actor, household, resolved.repository);
}

export async function revokeHouseholdInvitation(
  actor: Actor,
  householdId: string,
  invitationId: string,
  expectedVersion: number,
  dependencies?: HouseholdServiceDependencies,
): Promise<void> {
  const resolved = await resolveDependencies(dependencies);
  await requirePrincipal(actor, householdId, "revoke_invitation", resolved.repository);
  await resolved.repository.revokeInvitation(
    actor,
    householdId,
    invitationId,
    expectedVersion,
  );
}

export async function removeHouseholdMember(
  actor: Actor,
  householdId: string,
  membershipId: string,
  expectedVersion: number,
  dependencies?: HouseholdServiceDependencies,
): Promise<void> {
  const resolved = await resolveDependencies(dependencies);
  await requirePrincipal(actor, householdId, "remove_member", resolved.repository);
  const membership = await resolved.repository.findMembershipById(householdId, membershipId);
  if (membership === null || membership.status !== "active") throw new NotFoundError();
  await resolved.repository.endMembership({
    action: "member_removed",
    actorUserId: actor.userId,
    expectedVersion,
    householdId,
    membershipId,
    status: "removed",
  });
}

export async function leaveHousehold(
  actor: Actor,
  householdId: string,
  expectedVersion: number,
  dependencies?: HouseholdServiceDependencies,
): Promise<void> {
  const resolved = await resolveDependencies(dependencies);
  await requirePrincipal(actor, householdId, "leave", resolved.repository);
  const membership = await resolved.repository.findActiveMembershipForUser(
    householdId,
    actor.userId,
  );
  if (membership === null || membership.version !== expectedVersion) throw new NotFoundError();
  await resolved.repository.endMembership({
    action: "member_left",
    actorUserId: actor.userId,
    expectedVersion,
    householdId,
    membershipId: membership.id,
    status: "left",
  });
}

async function validateOwnedResource(
  actor: Actor,
  command: HouseholdShareCommand,
  dependencies: ResolvedHouseholdDependencies,
): Promise<void> {
  if (command.resourceKind === "account") {
    if (!(await dependencies.accountRepository.existsForActor(actor, command.resourceId))) {
      throw new NotFoundError();
    }
    return;
  }
  if ((await dependencies.goalRepository.findLatestDefinitionForActor(actor, command.resourceId)) === null) {
    throw new NotFoundError();
  }
}

export async function changeHouseholdResourceShare(
  actor: Actor,
  householdId: string,
  command: HouseholdShareCommand,
  dependencies?: HouseholdServiceDependencies,
): Promise<void> {
  const resolved = await resolveDependencies(dependencies);
  const { principal } = await requirePrincipal(
    actor,
    householdId,
    command.action === "share" ? "share_own_resource" : "unshare_own_resource",
    resolved.repository,
  );
  await validateOwnedResource(actor, command, resolved);
  await resolved.repository.setShare({
    action: command.action,
    actorUserId: actor.userId,
    expectedVersion: command.expectedVersion,
    householdId,
    ownerMembershipEpoch: principal.membershipEpoch,
    resourceId: command.resourceId,
    resourceKind: command.resourceKind,
  });
}

export async function loadHouseholdCenter(
  actor: Actor,
  householdId?: string,
  dependencies?: HouseholdServiceDependencies,
): Promise<HouseholdCenterView> {
  const resolved = await resolveDependencies(dependencies);
  const actorIdentity = await resolved.identityRepository.resolveActor(actor);
  const households = await resolved.repository.listActiveForActor(actor);
  const listItems = await Promise.all(
    households.map((household) => listItem(actor, household, resolved.repository)),
  );
  const selectedId = householdId ?? households[0]?.id;
  if (selectedId === undefined) {
    return {
      audit: [],
      eligibleResources: [],
      households: listItems,
      invitations: [],
      members: [],
      selected: null,
      sharedAccounts: [],
      sharedGoals: [],
      totals: [],
    };
  }
  const { household, principal } = await requirePrincipal(
    actor,
    selectedId,
    "view_household",
    resolved.repository,
  );
  const [memberships, shares, rawAudit] = await Promise.all([
    resolved.repository.listActiveMemberships(selectedId),
    resolved.repository.listShares(selectedId),
    resolved.repository.listAudit(selectedId),
  ]);
  const allUserIds = [
    household.ownerUserId,
    ...memberships.map((membership) => membership.userId),
    ...rawAudit.flatMap((event) =>
      [event.actorUserId, event.targetUserId].filter(
        (value): value is string => value !== null,
      ),
    ),
  ];
  const persistedNames = await resolved.identityRepository.displayNames(allUserIds);
  const names = new Map(persistedNames);
  names.set(actor.userId, actorIdentity.displayName);
  for (const membership of memberships) {
    if (!names.has(membership.userId)) names.set(membership.userId, membership.displayNameSnapshot);
  }
  const projection = await sharedProjection(household, shares, names, resolved);
  const ownerName = names.get(household.ownerUserId) ?? "בעל/ת משק הבית";
  const memberViews: HouseholdMemberView[] = [
    {
      displayName: ownerName,
      isCurrentActor: household.ownerUserId === actor.userId,
      joinedAt: household.createdAt.toISOString(),
      membershipId: null,
      role: "owner",
      version: household.version,
    },
    ...memberships.map((membership) => ({
      displayName: names.get(membership.userId) ?? membership.displayNameSnapshot,
      isCurrentActor: membership.userId === actor.userId,
      joinedAt: membership.joinedAt.toISOString(),
      membershipId: membership.id,
      role: "member" as const,
      version: membership.version,
    })),
  ];
  const selected = listItems.find((item) => item.id === selectedId) ?? null;
  if (selected === null) throw new NotFoundError();
  return {
    audit: auditViews(rawAudit, names),
    eligibleResources: await eligibleResources(
      actor,
      principal.membershipEpoch,
      shares,
      resolved,
    ),
    households: listItems,
    invitations:
      principal.role === "owner"
        ? (await resolved.repository.listInvitations(selectedId)).map(invitationView)
        : [],
    members: memberViews,
    selected,
    ...projection,
  };
}
