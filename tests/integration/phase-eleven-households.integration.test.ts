import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAiPreparedContext, toAiProviderContext } from "@/lib/ai/ai-context-service";
import type { Actor } from "@/lib/auth/actor";
import {
  calculateFinancialEngine,
  type FinancialEngineInput,
} from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";
import { ConflictError, NotFoundError } from "@/lib/errors/application-error";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import { goalRepositoryForDatabase, type GoalRepository } from "@/lib/goals/goal-repository";
import {
  householdIdentityRepositoryForDatabase,
  type HouseholdIdentityRepository,
} from "@/lib/households/household-identity-repository";
import {
  householdRepositoryForDatabase,
  type HouseholdRepository,
} from "@/lib/households/household-repository";
import {
  acceptHouseholdInvitation,
  changeHouseholdResourceShare,
  createHousehold,
  createHouseholdInvitation,
  dissolveHousehold,
  leaveHousehold,
  loadHouseholdCenter,
  removeHouseholdMember,
  revokeHouseholdInvitation,
  updateHousehold,
  type HouseholdServiceDependencies,
} from "@/lib/households/household-service";
import {
  manualRecordRepositoryForDatabase,
  type ManualRecordRepository,
} from "@/lib/onboarding/manual-record-repository";
import { createManualRecord } from "@/lib/onboarding/manual-record-service";
import {
  profileRepositoryForDatabase,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 11 private-by-default households and permissions", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(
    testUri ?? "mongodb://integration-test-not-configured",
    { promoteLongs: false },
  );
  const owner: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const member: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const intruder: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const revokedInvitee: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  const expiredInvitee: Actor = {
    kind: "user",
    userId: new ObjectId().toHexString(),
  };
  let now = new Date("2026-09-01T09:00:00.000Z");
  let database: Db;
  let accountRepository: ManualRecordRepository;
  let goalRecordRepository: ManualRecordRepository;
  let goalRepository: GoalRepository;
  let householdRepository: HouseholdRepository;
  let identityRepository: HouseholdIdentityRepository;
  let profileRepository: UserProfileRepository;
  let householdId: string;
  let ownerAccountId: string;
  let ownerFutureAccountId: string;
  let memberAccountId: string;
  let intruderAccountId: string;
  let ownerGoalId: string;
  let memberInvitationToken: string;

  function dependencies(
    overrides: Partial<HouseholdServiceDependencies> = {},
  ): HouseholdServiceDependencies {
    return {
      accountRepository,
      goalRecordRepository,
      goalRepository,
      identityRepository,
      now: () => now,
      repository: householdRepository,
      ...overrides,
    };
  }

  async function createAccount(
    actor: Actor,
    name: string,
    amount: string,
  ): Promise<string> {
    const record = await createManualRecord(
      actor,
      "accounts",
      { balance: { amount, currency: "ILS" }, name, type: "bank" },
      randomUUID(),
      { profileRepository, repository: accountRepository },
    );
    return record.id;
  }

  function engineSnapshotFor(actor: Actor): FinancialEngineSnapshot {
    if (actor.userId !== member.userId) {
      throw new Error("Copilot context attempted to load another household actor.");
    }
    const input: FinancialEngineInput = {
      accountBalance: money(222_22n, "ILS"),
      actualMonthlyExpenses: money(20_00n, "ILS"),
      actualMonthlyIncome: money(100_00n, "ILS"),
      asOf: "2026-09-10T09:00:00.000Z",
      availableCash: money(222_22n, "ILS"),
      creditLimit: money(0n, "ILS"),
      creditUsed: money(0n, "ILS"),
      currency: "ILS",
      debtBalance: money(0n, "ILS"),
      events: [],
      horizonDays: 30,
      monthlyConfirmedIncomeBasis: [],
      safetyMargin: { amount: money(10_00n, "ILS"), kind: "fixed" },
      savingsBalance: money(0n, "ILS"),
      timeZone: "Asia/Jerusalem",
    };
    return {
      calculatedAt: new Date("2026-09-10T09:00:01.000Z"),
      engineVersion: "financial-engine/1.0.0",
      id: new ObjectId().toHexString(),
      inputHash: "a".repeat(64),
      kind: "engine_result",
      policyVersion: "financial-policy/2026-08-31",
      result: calculateFinancialEngine(input),
      schemaVersion: 1,
      sourceManifestId: new ObjectId().toHexString(),
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    accountRepository = manualRecordRepositoryForDatabase(database, "accounts");
    goalRecordRepository = manualRecordRepositoryForDatabase(database, "goals");
    goalRepository = goalRepositoryForDatabase(database);
    householdRepository = householdRepositoryForDatabase(database, () => now);
    identityRepository = householdIdentityRepositoryForDatabase(database);
    profileRepository = profileRepositoryForDatabase(database);
    await Promise.all([
      accountRepository.ensureIndexes(),
      goalRecordRepository.ensureIndexes(),
      goalRepository.ensureIndexes(),
      householdRepository.ensureIndexes(),
      profileRepository.ensureIndexes(),
    ]);

    const identities = [
      [owner, "owner@example.com", "שמואל"],
      [member, "member@example.com", "נועה"],
      [intruder, "intruder@example.com", "משתמש זר"],
      [revokedInvitee, "revoked@example.com", "מוזמנת שבוטלה"],
      [expiredInvitee, "expired@example.com", "מוזמן שפג"],
    ] as const;
    await database.collection("authUsers").insertMany(
      identities.map(([actor, email, name]) => ({
        _id: new ObjectId(actor.userId),
        email,
        name,
      })),
    );
    for (const [actor, , displayName] of identities) {
      await saveProfile(
        actor,
        {
          countryCode: "IL",
          displayName,
          expectedVersion: null,
          householdType: "single",
          primaryCurrency: "ILS",
          timeZone: "Asia/Jerusalem",
        },
        { repository: profileRepository },
      );
    }
    ownerAccountId = await createAccount(owner, "חשבון בעלים", "1234.56");
    memberAccountId = await createAccount(member, "חשבון חברה", "222.22");
    intruderAccountId = await createAccount(intruder, "חשבון זר", "999999.99");
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("creates an idempotent household without exposing pre-existing or future data", async () => {
    const idempotencyKey = randomUUID();
    const created = await createHousehold(
      owner,
      { idempotencyKey, name: "הבית שלנו" },
      dependencies(),
    );
    householdId = created.id;
    const retry = await createHousehold(
      owner,
      { idempotencyKey, name: "הבית שלנו" },
      dependencies(),
    );
    expect(retry.id).toBe(householdId);

    ownerFutureAccountId = await createAccount(
      owner,
      "חשבון שנוצר אחרי משק הבית",
      "876543.21",
    );
    const center = await loadHouseholdCenter(owner, householdId, dependencies());
    expect(center.selected).toMatchObject({ memberCount: 1, role: "owner" });
    expect(center.sharedAccounts).toHaveLength(0);
    expect(center.sharedGoals).toHaveLength(0);
    expect(center.totals).toHaveLength(0);
    expect(center.eligibleResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: ownerAccountId, shared: false }),
        expect.objectContaining({ resourceId: ownerFutureAccountId, shared: false }),
      ]),
    );
    expect(center.eligibleResources.some((item) => item.resourceId === intruderAccountId)).toBe(
      false,
    );
    await expect(
      loadHouseholdCenter(member, householdId, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);

    const indexNames = new Set(
      (await Promise.all([
        database.collection("households").indexes(),
        database.collection("householdMemberships").indexes(),
        database.collection("householdInvitations").indexes(),
        database.collection("householdResourceShares").indexes(),
      ])).flatMap((indexes) => indexes.map((index) => index.name)),
    );
    expect(indexNames.has("households_owner_idempotency")).toBe(true);
    expect(indexNames.has("household_members_unique")).toBe(true);
    expect(indexNames.has("household_invitations_one_active")).toBe(true);
    expect(indexNames.has("household_shares_unique_resource")).toBe(true);
  });

  it("enforces email-bound, expiring, revocable, single-use invitations", async () => {
    await expect(
      createHouseholdInvitation(
        owner,
        householdId,
        { email: "owner@example.com" },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const expiring = await createHouseholdInvitation(
      owner,
      householdId,
      { email: "expired@example.com" },
      dependencies({ tokenFactory: () => "x".repeat(43) }),
    );
    const storedExpiring = await database
      .collection("householdInvitations")
      .findOne({ _id: new ObjectId(expiring.invitation.id) });
    expect(storedExpiring?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedExpiring?.tokenHash).not.toBe(expiring.token);
    expect(storedExpiring).not.toHaveProperty("token");
    expect(JSON.stringify(storedExpiring)).not.toContain("expired@example.com");

    now = new Date("2026-09-09T09:00:00.000Z");
    await expect(
      acceptHouseholdInvitation(expiredInvitee, expiring.token, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await database.collection("householdInvitations").findOne({
        _id: new ObjectId(expiring.invitation.id),
      }),
    ).toMatchObject({ status: "expired" });

    const revoked = await createHouseholdInvitation(
      owner,
      householdId,
      { email: "revoked@example.com" },
      dependencies({ tokenFactory: () => "r".repeat(43) }),
    );
    await revokeHouseholdInvitation(
      owner,
      householdId,
      revoked.invitation.id,
      revoked.invitation.version,
      dependencies(),
    );
    await expect(
      acceptHouseholdInvitation(revokedInvitee, revoked.token, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);

    const invitation = await createHouseholdInvitation(
      owner,
      householdId,
      { email: "member@example.com" },
      dependencies({ tokenFactory: () => "m".repeat(43) }),
    );
    memberInvitationToken = invitation.token;
    await expect(
      createHouseholdInvitation(
        owner,
        householdId,
        { email: "member@example.com" },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      acceptHouseholdInvitation(intruder, memberInvitationToken, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);

    const accepted = await acceptHouseholdInvitation(
      member,
      memberInvitationToken,
      dependencies(),
    );
    expect(accepted).toMatchObject({ id: householdId, role: "member" });
    await expect(
      acceptHouseholdInvitation(member, memberInvitationToken, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shares only owner-authorized resources with exact projections and strict isolation", async () => {
    const goalRecord = await createManualRecord(
      owner,
      "goals",
      {
        currentValue: { amount: "250", currency: "ILS" },
        priority: 1,
        startingValue: { amount: "100", currency: "ILS" },
        targetAmount: { amount: "1000", currency: "ILS" },
        targetDate: "2026-12-31",
        title: "יעד משפחתי",
        type: "custom",
      },
      randomUUID(),
      { profileRepository, repository: goalRecordRepository },
    );
    ownerGoalId = goalRecord.id;
    await goalRepository.createDefinitionVersionForActor(
      owner,
      {
        configuration: {
          direction: "increase",
          kind: "custom",
          metricLabel: "חיסכון מדווח",
          targetAmount: money(1000_00n, "ILS"),
        },
        expectedDefinitionVersion: null,
        goalId: ownerGoalId,
        reportedEvidence: {
          capturedAt: now,
          currentValue: money(250_00n, "ILS"),
          goalRecordVersion: goalRecord.version,
          startingValue: money(100_00n, "ILS"),
          targetAmount: money(1000_00n, "ILS"),
        },
        targetDate: "2026-12-31",
      },
      randomUUID(),
    );

    await changeHouseholdResourceShare(
      owner,
      householdId,
      {
        action: "share",
        expectedVersion: null,
        resourceId: ownerAccountId,
        resourceKind: "account",
      },
      dependencies(),
    );
    await changeHouseholdResourceShare(
      owner,
      householdId,
      {
        action: "share",
        expectedVersion: null,
        resourceId: ownerGoalId,
        resourceKind: "goal",
      },
      dependencies(),
    );
    const memberBeforeOwnShare = await loadHouseholdCenter(
      member,
      householdId,
      dependencies(),
    );
    expect(memberBeforeOwnShare.sharedAccounts).toEqual([
      expect.objectContaining({
        balance: { amountMinor: "123456", currency: "ILS" },
        label: "חשבון בעלים",
      }),
    ]);
    expect(memberBeforeOwnShare.sharedGoals).toEqual([
      expect.objectContaining({
        currentValue: null,
        label: "יעד משפחתי",
        targetValue: { amountMinor: "100000", currency: "ILS" },
      }),
    ]);
    expect(memberBeforeOwnShare.sharedAccounts.some((item) => item.label.includes("אחרי"))).toBe(
      false,
    );
    expect(memberBeforeOwnShare.eligibleResources).toEqual([
      expect.objectContaining({ resourceId: memberAccountId, shared: false }),
    ]);

    await expect(
      changeHouseholdResourceShare(
        member,
        householdId,
        {
          action: "share",
          expectedVersion: null,
          resourceId: ownerFutureAccountId,
          resourceKind: "account",
        },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      changeHouseholdResourceShare(
        owner,
        householdId,
        {
          action: "share",
          expectedVersion: null,
          resourceId: memberAccountId,
          resourceKind: "account",
        },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    await changeHouseholdResourceShare(
      member,
      householdId,
      {
        action: "share",
        expectedVersion: null,
        resourceId: memberAccountId,
        resourceKind: "account",
      },
      dependencies(),
    );
    const ownerView = await loadHouseholdCenter(owner, householdId, dependencies());
    expect(ownerView.totals).toEqual([
      {
        amount: { amountMinor: "145678", currency: "ILS" },
        contributionCount: 2,
      },
    ]);
    expect(ownerView.sharedAccounts.map((account) => account.label)).toEqual([
      "חשבון בעלים",
      "חשבון חברה",
    ]);

    const storedOwnerAccount = await database
      .collection("accounts")
      .findOne({ _id: new ObjectId(ownerAccountId) });
    expect(storedOwnerAccount?.fields.balance.amountMinor).toBeInstanceOf(Long);
    const storedShare = await database.collection("householdResourceShares").findOne({
      householdId: new ObjectId(householdId),
      resourceId: new ObjectId(ownerAccountId),
    });
    expect(storedShare).not.toHaveProperty("balance");
    expect(storedShare).not.toHaveProperty("fields");

    await expect(
      loadHouseholdCenter(intruder, householdId, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    const otherHousehold = await createHousehold(
      intruder,
      { idempotencyKey: randomUUID(), name: "משק בית זר" },
      dependencies(),
    );
    await expect(
      loadHouseholdCenter(member, otherHousehold.id, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateHousehold(
        member,
        householdId,
        { expectedVersion: 1, name: "ניסיון שינוי" },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createHouseholdInvitation(
        member,
        householdId,
        { email: "another@example.com" },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      dissolveHousehold(member, householdId, 1, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps Copilot context strictly actor-owned despite household sharing", async () => {
    const prepared = await buildAiPreparedContext(
      member,
      "safe_to_spend",
      "מה מצב הכסף הבטוח שלי?",
      [],
      { loadLatestEngine: async (actor) => engineSnapshotFor(actor) },
    );
    const providerContext = toAiProviderContext(prepared);
    const serialized = JSON.stringify(providerContext);
    expect(serialized).toContain("22222");
    expect(serialized).not.toContain("87654321");
    expect(serialized).not.toContain(owner.userId);
    expect(serialized).not.toContain(member.userId);
    expect(serialized).not.toContain(householdId);
  });

  it("revokes on removal, requires explicit re-share after rejoin, and preserves ownership", async () => {
    const memberView = await loadHouseholdCenter(owner, householdId, dependencies());
    const membership = memberView.members.find((item) => item.role === "member");
    expect(membership?.membershipId).not.toBeNull();
    const concurrent = await Promise.allSettled([
      removeHouseholdMember(
        owner,
        householdId,
        membership!.membershipId!,
        membership!.version,
        dependencies(),
      ),
      removeHouseholdMember(
        owner,
        householdId,
        membership!.membershipId!,
        membership!.version,
        dependencies(),
      ),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      loadHouseholdCenter(member, householdId, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await accountRepository.findForActor(member, memberAccountId)).not.toBeNull();
    expect((await loadHouseholdCenter(owner, householdId, dependencies())).totals).toEqual([
      {
        amount: { amountMinor: "123456", currency: "ILS" },
        contributionCount: 1,
      },
    ]);

    now = new Date("2026-09-10T09:00:00.000Z");
    const rejoinInvitation = await createHouseholdInvitation(
      owner,
      householdId,
      { email: "member@example.com" },
      dependencies({ tokenFactory: () => "j".repeat(43) }),
    );
    await acceptHouseholdInvitation(member, rejoinInvitation.token, dependencies());
    const rejoined = await loadHouseholdCenter(member, householdId, dependencies());
    const memberResource = rejoined.eligibleResources.find(
      (resource) => resource.resourceId === memberAccountId,
    );
    expect(memberResource).toMatchObject({ shareVersion: 1, shared: false });
    const storedMembership = await householdRepository.findActiveMembershipForUser(
      householdId,
      member.userId,
    );
    expect(storedMembership?.membershipEpoch).toBe(2);

    await changeHouseholdResourceShare(
      member,
      householdId,
      {
        action: "share",
        expectedVersion: memberResource!.shareVersion,
        resourceId: memberAccountId,
        resourceKind: "account",
      },
      dependencies(),
    );
    expect((await loadHouseholdCenter(owner, householdId, dependencies())).totals[0]).toEqual({
      amount: { amountMinor: "145678", currency: "ILS" },
      contributionCount: 2,
    });

    const currentMembership = await householdRepository.findActiveMembershipForUser(
      householdId,
      member.userId,
    );
    await leaveHousehold(
      member,
      householdId,
      currentMembership!.version,
      dependencies(),
    );
    await expect(
      loadHouseholdCenter(member, householdId, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await accountRepository.findForActor(member, memberAccountId)).not.toBeNull();
  });

  it("dissolves with immediate denial while preserving financial truth and audit evidence", async () => {
    now = new Date("2026-09-11T09:00:00.000Z");
    const finalInvitation = await createHouseholdInvitation(
      owner,
      householdId,
      { email: "member@example.com" },
      dependencies({ tokenFactory: () => "z".repeat(43) }),
    );
    await acceptHouseholdInvitation(member, finalInvitation.token, dependencies());
    const beforeDissolve = await loadHouseholdCenter(owner, householdId, dependencies());
    await dissolveHousehold(
      owner,
      householdId,
      beforeDissolve.selected!.version,
      dependencies(),
    );
    await expect(
      loadHouseholdCenter(owner, householdId, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      loadHouseholdCenter(member, householdId, dependencies()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await accountRepository.findForActor(owner, ownerAccountId)).not.toBeNull();
    expect(await accountRepository.findForActor(member, memberAccountId)).not.toBeNull();
    expect(await householdRepository.findHousehold(householdId)).toMatchObject({
      status: "dissolved",
    });

    const audit = await householdRepository.listAudit(householdId);
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "household_created",
        "household_dissolved",
        "invitation_accepted",
        "invitation_created",
        "invitation_expired",
        "invitation_revoked",
        "member_left",
        "member_removed",
        "resource_shared",
      ]),
    );
    expect(await database.collection("householdInvitations").countDocuments({ token: { $exists: true } })).toBe(0);
    expect(await database.listCollections({ name: "bankConnections" }).hasNext()).toBe(false);
    expect(await database.listCollections({ name: "bankSyncRuns" }).hasNext()).toBe(false);
  });
});
