import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { goalRepositoryForDatabase } from "@/lib/goals/goal-repository";
import { householdRepositoryForDatabase } from "@/lib/households/household-repository";
import { netWorthRepositoryForDatabase } from "@/lib/net-worth/net-worth-repository";
import {
  captureExplicitNetWorthSnapshot,
  createNetWorthItem,
  deleteNetWorthItem,
  loadNetWorthCenter,
  updateNetWorthItem,
  type NetWorthDependencies,
} from "@/lib/net-worth/net-worth-service";
import { manualRecordRepositoryForDatabase, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { createManualRecord } from "@/lib/onboarding/manual-record-service";
import { profileRepositoryForDatabase, type UserProfileRepository } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 14 net-worth persistence, history, and isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  let database: Db;
  let profileRepository: UserProfileRepository;
  let accounts: ManualRecordRepository;
  let cards: ManualRecordRepository;
  let loans: ManualRecordRepository;
  let savings: ManualRecordRepository;
  let goals: ReturnType<typeof goalRepositoryForDatabase>;
  let netWorth: ReturnType<typeof netWorthRepositoryForDatabase>;
  let household: ReturnType<typeof householdRepositoryForDatabase>;
  let investmentAccountId: string;
  let firstLoanId: string;
  let firstCardId: string;

  function dependencies(): NetWorthDependencies {
    return {
      accountRepository: accounts,
      cardRepository: cards,
      goalRepository: goals,
      loanRepository: loans,
      netWorthRepository: netWorth,
      now: () => new Date("2026-09-02T09:00:00.000Z"),
      profileRepository,
      savingsRepository: savings,
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    const manualEvidenceNow = () => new Date("2026-09-02T08:00:00.000Z");
    profileRepository = profileRepositoryForDatabase(database);
    accounts = manualRecordRepositoryForDatabase(database, "accounts", manualEvidenceNow);
    cards = manualRecordRepositoryForDatabase(database, "cards", manualEvidenceNow);
    loans = manualRecordRepositoryForDatabase(database, "loans", manualEvidenceNow);
    savings = manualRecordRepositoryForDatabase(database, "savings", manualEvidenceNow);
    goals = goalRepositoryForDatabase(database);
    netWorth = netWorthRepositoryForDatabase(database, () => new Date("2026-09-02T09:05:00.000Z"));
    household = householdRepositoryForDatabase(database, () => new Date("2026-09-02T09:00:00.000Z"));
    await Promise.all([
      profileRepository.ensureIndexes(), accounts.ensureIndexes(), cards.ensureIndexes(), loans.ensureIndexes(), savings.ensureIndexes(),
      goals.ensureIndexes(), netWorth.ensureIndexes(), household.ensureIndexes(),
    ]);
    for (const [actor, name] of [[firstActor, "Owner"], [secondActor, "Other"]] as const) {
      await saveProfile(actor, { countryCode: "IL", displayName: name, expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profileRepository });
    }
    investmentAccountId = (await createManualRecord(firstActor, "accounts", { balance: { amount: "1000.00", currency: "ILS" }, name: "Investment account", type: "investments" }, randomUUID(), { profileRepository, repository: accounts })).id;
    await createManualRecord(firstActor, "accounts", { balance: { amount: "500.00", currency: "ILS" }, name: "Savings fallback", type: "savings" }, randomUUID(), { profileRepository, repository: accounts });
    await createManualRecord(firstActor, "accounts", { balance: { amount: "-100.00", currency: "ILS" }, name: "Overdraft", type: "bank" }, randomUUID(), { profileRepository, repository: accounts });
    await createManualRecord(firstActor, "savings", { accountIdentifierLast4: null, availability: "liquid", balance: { amount: "600.00", currency: "ILS" }, institution: null, maturityDate: null, name: "Detailed savings" }, randomUUID(), { profileRepository, repository: savings });
    firstLoanId = (await createManualRecord(firstActor, "loans", { annualInterestRateBps: 1_000, endDate: null, monthlyPayment: { amount: "100.00", currency: "ILS" }, name: "Owner loan", nextPaymentDate: "2026-10-01", originalAmount: { amount: "1000.00", currency: "ILS" }, remainingBalance: { amount: "400.00", currency: "ILS" } }, randomUUID(), { profileRepository, repository: loans })).id;
    firstCardId = (await createManualRecord(firstActor, "cards", { billingDay: 10, issuer: "Issuer", limit: { amount: "1000.00", currency: "ILS" }, name: "Owner card", used: { amount: "200.00", currency: "ILS" } }, randomUUID(), { profileRepository, repository: cards })).id;
    await createManualRecord(secondActor, "accounts", { balance: { amount: "9999.99", currency: "ILS" }, name: "Private other account", type: "bank" }, randomUUID(), { profileRepository, repository: accounts });
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("reconciles canonical sources exactly without savings or card/debt duplication", async () => {
    const center = await loadNetWorthCenter(firstActor, dependencies());
    expect(center.current.totals).toEqual([expect.objectContaining({
      assets: { amountMinor: "160000", currency: "ILS" },
      liabilities: { amountMinor: "70000", currency: "ILS" },
      netWorth: { amountMinor: "90000", currency: "ILS" },
    })]);
    expect(center.current.excluded.some((entry) => entry.reason === "fallback_replaced")).toBe(true);
    expect(center.current.included.filter((entry) => entry.sourceKind === "credit_card")).toHaveLength(1);
    expect(JSON.stringify(center)).not.toContain("Private other account");
  });

  it("uses explicit holding aggregation and liability evidence while persisting exact BSON int64", async () => {
    const holding = await createNetWorthItem(firstActor, {
      amount: { amount: "1100.00", currency: "ILS" }, category: "investment", effectiveAt: "2026-09-02T08:00:00.000Z",
      label: "Authoritative holdings", provenanceNote: "manual statement", relationship: { accountId: investmentAccountId, aggregationMode: "detail_authoritative", kind: "account_detail" },
      side: "asset", valuationType: "market_value",
    }, randomUUID(), dependencies());
    const payoff = await createNetWorthItem(firstActor, {
      amount: { amount: "420.00", currency: "ILS" }, category: "loan", effectiveAt: "2026-09-02T08:30:00.000Z",
      label: "Reported payoff", provenanceNote: "manual lender statement", relationship: { kind: "liability_evidence", recordId: firstLoanId, recordKind: "loan" },
      side: "liability", valuationType: "settlement_balance",
    }, randomUUID(), dependencies());
    const center = await loadNetWorthCenter(firstActor, dependencies());
    expect(center.current.totals[0]?.assets.amountMinor).toBe("170000");
    expect(center.current.totals[0]?.liabilities.amountMinor).toBe("72000");
    expect(center.current.excluded.some((entry) => entry.reason === "detail_authoritative")).toBe(true);
    expect(center.current.excluded.some((entry) => entry.reason === "lower_priority_liability")).toBe(true);
    const stored = await database.collection("netWorthItems").findOne({ _id: new ObjectId(holding.item.id) });
    expect((stored?.fields as { amount: { amountMinor: unknown } }).amount.amountMinor).toBeInstanceOf(Long);
    expect(payoff.snapshot.trigger).toBe("material_change");
    expect(await database.collection("netWorthSnapshots").countDocuments({ automaticDate: "2026-09-02" })).toBe(1);
  });

  it("deduplicates explicit snapshots and preserves immutable history across correction and deletion", async () => {
    const first = await captureExplicitNetWorthSnapshot(firstActor, dependencies());
    const retry = await captureExplicitNetWorthSnapshot(firstActor, dependencies());
    expect(retry.id).toBe(first.id);
    const item = (await netWorth.listItemsForActor(firstActor)).find((entry) => entry.fields.label === "Authoritative holdings");
    expect(item).toBeDefined();
    await updateNetWorthItem(firstActor, item!.id, item!.version, {
      amount: { amount: "1200.00", currency: "ILS" }, category: "investment", effectiveAt: "2026-09-02T10:00:00.000Z",
      label: "Authoritative holdings corrected", provenanceNote: "corrected statement", relationship: item!.fields.relationship,
      side: "asset", valuationType: "market_value",
    }, dependencies());
    const second = await captureExplicitNetWorthSnapshot(firstActor, dependencies());
    expect(second.id).not.toBe(first.id);
    expect(first.statement.totals[0]?.netWorth.amountMinor).toBe(98_000n);
    expect(second.statement.totals[0]?.netWorth.amountMinor).toBe(108_000n);
    const updated = (await netWorth.listItemsForActor(firstActor)).find((entry) => entry.id === item!.id)!;
    await deleteNetWorthItem(firstActor, updated.id, updated.version, dependencies());
    const afterDelete = await loadNetWorthCenter(firstActor, dependencies());
    expect(afterDelete.items.some((entry) => entry.id === updated.id)).toBe(false);
    const history = await netWorth.listAllSnapshotsForActor(firstActor);
    expect(history.find((entry) => entry.id === first.id)?.statement.totals[0]?.netWorth.amountMinor).toBe(98_000n);
    const storedItem = await database.collection("netWorthItems").findOne({ _id: new ObjectId(updated.id) });
    expect(storedItem?.deletedAt).toBeInstanceOf(Date);
    expect((storedItem?.auditTrail as unknown[]).length).toBe(3);
  });

  it("keeps direct IDs, household sharing, snapshots, and holdings isolated by actor", async () => {
    const created = await household.createHouseholdForActor(firstActor, "Shared", randomUUID());
    const invitation = await household.createInvitation({ expiresAt: new Date("2026-09-09T00:00:00.000Z"), householdId: created.id, inviteeEmailHash: "a".repeat(64), inviteeHint: "o***@example.com", invitedByUserId: firstActor.userId, tokenHash: "b".repeat(64) });
    await household.activateMembership(invitation, secondActor.userId, "Other");
    const share = await household.setShare({
      action: "share",
      actorUserId: firstActor.userId,
      expectedVersion: null,
      householdId: created.id,
      ownerMembershipEpoch: 1,
      resourceId: investmentAccountId,
      resourceKind: "account",
    });
    expect(share.resourceId).toBe(investmentAccountId);
    const second = await loadNetWorthCenter(secondActor, dependencies());
    expect(second.current.included.map((entry) => entry.label)).toEqual(["Private other account"]);
    expect(JSON.stringify(second)).not.toContain("Owner loan");
    expect(JSON.stringify(second)).not.toContain("Detailed savings");
    expect(await netWorth.listAllSnapshotsForActor(secondActor)).toHaveLength(0);
  });

  it("rejects foreign relationships and preserves source collections during snapshot commands", async () => {
    await expect(createNetWorthItem(secondActor, {
      amount: { amount: "1.00", currency: "ILS" }, category: "credit_card", effectiveAt: "2026-09-02T08:00:00.000Z", label: "Foreign card",
      provenanceNote: null, relationship: { kind: "liability_evidence", recordId: firstCardId, recordKind: "credit_card" }, side: "liability", valuationType: "outstanding_balance",
    }, randomUUID(), dependencies())).rejects.toMatchObject({ name: "NotFoundError" });
    const before = {
      accounts: await database.collection("accounts").countDocuments({}),
      cards: await database.collection("creditCards").countDocuments({}),
      loans: await database.collection("loans").countDocuments({}),
      goals: await database.collection("goalProgress").countDocuments({}),
    };
    await captureExplicitNetWorthSnapshot(firstActor, dependencies());
    expect({
      accounts: await database.collection("accounts").countDocuments({}),
      cards: await database.collection("creditCards").countDocuments({}),
      loans: await database.collection("loans").countDocuments({}),
      goals: await database.collection("goalProgress").countDocuments({}),
    }).toEqual(before);
    expect(await database.collection("bankConnections").countDocuments({})).toBe(0);
  });
});
