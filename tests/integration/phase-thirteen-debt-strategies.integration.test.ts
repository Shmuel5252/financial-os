import { randomUUID } from "node:crypto";

import { Long, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { toSavedDebtStrategyView, type EvaluateDebtStrategyCommand } from "@/lib/debt-strategies/debt-strategy";
import { debtStrategyRepositoryForDatabase } from "@/lib/debt-strategies/debt-strategy-repository";
import {
  evaluateDebtStrategy,
  loadDebtStrategyCenter,
  saveDebtStrategy,
  type DebtStrategyDependencies,
} from "@/lib/debt-strategies/debt-strategy-service";
import { ConflictError, NotFoundError } from "@/lib/errors/application-error";
import { householdRepositoryForDatabase } from "@/lib/households/household-repository";
import { manualRecordRepositoryForDatabase, type ManualRecordRepository } from "@/lib/onboarding/manual-record-repository";
import { createManualRecord, updateManualRecord } from "@/lib/onboarding/manual-record-service";
import { profileRepositoryForDatabase, type UserProfileRepository } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 13 debt strategy persistence and isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured", { promoteLongs: false });
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  let database: Db;
  let profileRepository: UserProfileRepository;
  let loanRepository: ManualRecordRepository;
  let strategyRepository: ReturnType<typeof debtStrategyRepositoryForDatabase>;
  let householdRepository: ReturnType<typeof householdRepositoryForDatabase>;
  let householdId: string;
  let firstLoanId: string;
  let secondLoanId: string;

  function dependencies(): DebtStrategyDependencies {
    return {
      loanRepository,
      now: () => new Date("2026-09-01T09:00:00.000Z"),
      profileRepository,
      strategyRepository,
    };
  }

  function command(loanId = firstLoanId): EvaluateDebtStrategyCommand {
    const provenance = { kind: "contract" as const, note: "signed agreement" };
    return {
      customPriority: [loanId],
      debtTerms: [{
        allocationOrder: { order: ["fees", "interest", "principal"], provenance },
        fees: [],
        feesKnown: true,
        feesProvenance: provenance,
        firstPaymentDate: "2026-10-01",
        interest: {
          accrualConvention: "monthly_compounded" as const,
          kind: "fixed_rate" as const,
          rateApplication: "payment_date" as const,
          rates: [{ annualRateBps: 1_200, effectiveDate: "2026-09-01", provenance }],
        },
        loanId,
        minimumPayment: { amount: { amount: "100.00", currency: "ILS" }, kind: "fixed" as const, provenance },
        prepayment: { kind: "free" as const, provenance },
      }],
      extraPayment: { amount: "50.00", currency: "ILS" },
      extraPaymentStartDate: "2026-10-15",
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    profileRepository = profileRepositoryForDatabase(database);
    loanRepository = manualRecordRepositoryForDatabase(database, "loans");
    strategyRepository = debtStrategyRepositoryForDatabase(database, () => new Date("2026-09-01T10:00:00.000Z"));
    householdRepository = householdRepositoryForDatabase(database, () => new Date("2026-09-01T10:00:00.000Z"));
    await Promise.all([profileRepository.ensureIndexes(), loanRepository.ensureIndexes(), strategyRepository.ensureIndexes(), householdRepository.ensureIndexes()]);
    await saveProfile(firstActor, { countryCode: "IL", displayName: "Owner", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profileRepository });
    await saveProfile(secondActor, { countryCode: "IL", displayName: "Other", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profileRepository });
    firstLoanId = (await createManualRecord(firstActor, "loans", {
      annualInterestRateBps: 1_200, endDate: null,
      monthlyPayment: { amount: "100.00", currency: "ILS" }, name: "Owner loan",
      nextPaymentDate: "2026-10-01", originalAmount: { amount: "2000.00", currency: "ILS" },
      remainingBalance: { amount: "1000.00", currency: "ILS" },
    }, randomUUID(), { profileRepository, repository: loanRepository })).id;
    secondLoanId = (await createManualRecord(secondActor, "loans", {
      annualInterestRateBps: 500, endDate: null,
      monthlyPayment: { amount: "20.00", currency: "ILS" }, name: "Private other loan",
      nextPaymentDate: "2026-10-01", originalAmount: { amount: "500.00", currency: "ILS" },
      remainingBalance: { amount: "300.00", currency: "ILS" },
    }, randomUUID(), { profileRepository, repository: loanRepository })).id;
    const household = await householdRepository.createHouseholdForActor(firstActor, "Shared household", randomUUID());
    householdId = household.id;
    const invitation = await householdRepository.createInvitation({
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      householdId,
      inviteeEmailHash: "a".repeat(64),
      inviteeHint: "m***@example.com",
      invitedByUserId: firstActor.userId,
      tokenHash: "b".repeat(64),
    });
    await householdRepository.activateMembership(invitation, secondActor.userId, "Household member");
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("keeps evaluation ephemeral and derives current owned debt evidence server-side", async () => {
    const before = await database.collection("debtStrategyScenarios").countDocuments({});
    const evaluated = await evaluateDebtStrategy(firstActor, command(), dependencies());
    expect(evaluated.input.debts[0]!.balance.amountMinor).toBe(100_000n);
    expect(evaluated.input.debts[0]!.sourceVersion).toBe(1);
    expect(evaluated.comparison.calculationCompleteness).toBe("verified");
    expect(await database.collection("debtStrategyScenarios").countDocuments({})).toBe(before);
    const source = await database.collection("loans").findOne({ _id: new ObjectId(firstLoanId) });
    expect((source?.fields as { remainingBalance: { amountMinor: Long } }).remainingBalance.amountMinor).toBeInstanceOf(Long);
  });

  it("denies cross-user debt selection without revealing private debt", async () => {
    expect(await householdRepository.findActiveMembershipForUser(householdId, secondActor.userId)).not.toBeNull();
    await expect(evaluateDebtStrategy(firstActor, command(secondLoanId), dependencies())).rejects.toBeInstanceOf(NotFoundError);
    await expect(evaluateDebtStrategy(secondActor, command(firstLoanId), dependencies())).rejects.toBeInstanceOf(NotFoundError);
    const center = await loadDebtStrategyCenter(firstActor, dependencies());
    expect(center.loans.map((loan) => loan.id)).toEqual([firstLoanId]);
    expect(JSON.stringify(center)).not.toContain("Private other loan");
  });

  it("saves immutable exact evidence idempotently without mutating canonical debt", async () => {
    const beforeLoan = await database.collection("loans").findOne({ _id: new ObjectId(firstLoanId) });
    const idempotencyKey = randomUUID();
    const first = await saveDebtStrategy(firstActor, { ...command(), idempotencyKey, name: "Contract comparison", note: null }, dependencies());
    const second = await saveDebtStrategy(firstActor, { ...command(), idempotencyKey, name: "Contract comparison", note: null }, dependencies());
    expect(second.id).toBe(first.id);
    const stored = await database.collection("debtStrategyScenarios").findOne({ _id: new ObjectId(first.id) });
    const storedInput = stored?.input as { debts: Array<{ balance: { amountMinor: unknown } }>; extraPayment: { amountMinor: unknown } };
    expect(storedInput.debts[0]!.balance.amountMinor).toBeInstanceOf(Long);
    expect(storedInput.extraPayment.amountMinor).toBeInstanceOf(Long);
    const exported = (await strategyRepository.listAllForActor(firstActor)).map(toSavedDebtStrategyView);
    expect(exported).toHaveLength(1);
    expect(() => JSON.stringify(exported)).not.toThrow();
    expect(exported[0]!.input.extraPayment.amountMinor).toBe("5000");
    const afterLoan = await database.collection("loans").findOne({ _id: new ObjectId(firstLoanId) });
    expect(afterLoan).toEqual(beforeLoan);
    expect(await database.collection("transactions").countDocuments({})).toBe(0);
    expect(await database.collection("financialSnapshots").countDocuments({})).toBe(0);
  });

  it("rejects stale debt revisions at the persistence boundary", async () => {
    const original = await loanRepository.findForActor(firstActor, firstLoanId);
    expect(original).not.toBeNull();
    const evaluated = await evaluateDebtStrategy(firstActor, command(), dependencies());
    await updateManualRecord(firstActor, "loans", firstLoanId, original!.version, {
      annualInterestRateBps: 1_200, endDate: null,
      monthlyPayment: { amount: "100.00", currency: "ILS" }, name: "Owner loan updated",
      nextPaymentDate: "2026-10-01", originalAmount: { amount: "2000.00", currency: "ILS" },
      remainingBalance: { amount: "900.00", currency: "ILS" },
    }, { profileRepository, repository: loanRepository });
    await expect(strategyRepository.saveForActor(firstActor, evaluated.input, evaluated.comparison, {
      idempotencyKey: randomUUID(), name: null, note: null,
    })).rejects.toBeInstanceOf(ConflictError);
  });
});
