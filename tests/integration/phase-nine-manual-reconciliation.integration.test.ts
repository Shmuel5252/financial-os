import { randomUUID } from "node:crypto";

import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import { money } from "@/lib/domain/money/money";
import { ConflictError, DependencyUnavailableError, ReconciliationRequiredError, UnauthorizedError } from "@/lib/errors/application-error";
import { bankAlias, minimizeAccountIdentity } from "@/lib/open-banking/account-identity";
import type { AccountReconciliationCommand, AccountReconciliationView } from "@/lib/open-banking/account-reconciliation";
import { AccountReconciliationRepository } from "@/lib/open-banking/account-reconciliation-repository";
import { decideAccountReconciliation, loadAccountReconciliation } from "@/lib/open-banking/account-reconciliation-service";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import type { OpenBankingAccountObservation, OpenBankingProvider } from "@/lib/open-banking/open-banking-provider";

const uri = process.env.MONGODB_TEST_URI;
const integration = uri === undefined ? describe.skip : describe;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture record.");
  return value;
}

integration("Phase 9 manual identity ledger on isolated real MongoDB (fixture provider)", () => {
  const databaseName = `financial_os_reconcile_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(uri ?? "mongodb://test-not-configured", { promoteLongs: false });
  const database = client.db(databaseName);
  const actor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const outsider: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const bankingRepository = openBankingRepositoryForDatabase(database);
  const repository = new AccountReconciliationRepository(database);
  const connection = { expiryDate: "2026-12-01", lastFetchedAt: "2026-09-06T08:00:00.000Z", lastFetchedDataDate: "2026-09-06", mode: "PSD2", providerExternalId: "fixture-bank", subjectExternalId: "fixture-subject" };
  let providerSubject = connection.subjectExternalId;
  let accounts: OpenBankingAccountObservation[];
  const provider: OpenBankingProvider = {
    listConnections: vi.fn(async () => [
      { ...connection, externalId: "old-connection", status: "TERMINATED_BY_USER", subjectExternalId: providerSubject },
      { ...connection, externalId: "new-connection", status: "ACTIVE", subjectExternalId: providerSubject },
    ]),
    listAccountsPage: vi.fn(async () => ({ items: accounts, nextCursor: null })),
    listTransactionsPage: vi.fn(async () => { throw new Error("Transaction reads forbidden during account review"); }),
    refreshConnections: vi.fn(async () => { throw new Error("Paid refresh forbidden"); }),
    deleteConnection: vi.fn(async () => { throw new Error("Provider deletion forbidden"); }),
  };
  const deps = { repository, bankingRepository, provider };
  const snapshot = async () => BSON.EJSON.stringify(await Promise.all(["accounts", "transactions", "bankRecordRevisions", "bankConnections", "bankProviderBindings", "bankSyncRuns"].map((name) => database.collection(name).find({}).sort({ _id: 1 }).toArray())), { relaxed: false });
  const command = (view: AccountReconciliationView, row = 0, candidate = 0): AccountReconciliationCommand => ({
    legacyKey: required(view.rows[row]).key, candidateKey: required(view.rows[row]).candidates[candidate]?.key ?? null,
    reviewToken: required(view.rows[row]).reviewToken, decision: "same_account", confirmation: true, idempotencyKey: randomUUID(),
  });
  let original: string;

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "test-only-account-ledger-auth-secret-over-32-characters");
    vi.stubEnv("OPEN_FINANCE_USER_ID", "fixture-subject");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "fixture-client");
    vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "fixture-secret");
    await client.connect();
    await bankingRepository.ensureIndexes(); await repository.ensureIndexes();
    await bankingRepository.claimBinding(actor, bankAlias("subject", "fixture-subject"));
    await bankingRepository.observeConnection(actor, { ...connection, externalId: "old-connection", status: "DISCONNECTED" },
      { connection: bankAlias("connection", "old-connection"), provider: bankAlias("institution", "fixture-bank") }, "fixture-connection-observation");
    accounts = [];
    for (let index = 0; index < 3; index++) {
      const old: OpenBankingAccountObservation = {
        accountType: "CHECKING", balances: [{ amount: money(9_007_199_254_740_991n, "ILS"), creditLimitIncluded: false, type: "closingBooked", referenceDate: "2026-09-06" }],
        connectionExternalId: "old-connection", currency: "ILS", displayName: `חשבון קודם ${index}`, externalId: `old-account-${index}`, isDuplicate: false, providerExternalId: "fixture-bank",
      };
      await bankingRepository.observeAccount(actor, old, { account: bankAlias("account", old.externalId), connection: bankAlias("connection", "old-connection") }, `fixture-account-${index}`,
        { name: old.displayName, balance: required(old.balances[0]).amount, type: "bank" });
      accounts.push({ ...old, connectionExternalId: "new-connection", externalId: `new-account-${index}`,
        identity: minimizeAccountIdentity({ accountNumber: `123456789${index}`, providerId: "fixture-bank", accountType: "CHECKING", currency: "ILS" }) });
    }
    accounts.push({ ...required(accounts[0]), externalId: "new-account-extra",
      identity: minimizeAccountIdentity({ accountNumber: "1234567899", providerId: "fixture-bank", accountType: "CHECKING", currency: "ILS" }) });
    original = await snapshot();
  });
  afterAll(async () => { vi.unstubAllEnvs(); await client.db(databaseName).dropDatabase(); await client.close(); });

  it("offers all compatible candidates without auto-matching and rejects cross-user access before provider reads", async () => {
    const view = await loadAccountReconciliation(actor, deps);
    expect(view.rows).toHaveLength(3);
    expect(view.rows.every((row) => row.status === "unresolved" && row.candidates.length === 4)).toBe(true);
    expect(await repository.listLedgers(actor)).toHaveLength(0);
    const reads = vi.mocked(provider.listConnections).mock.calls.length;
    await expect(loadAccountReconciliation(outsider, deps)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(decideAccountReconciliation(outsider, command(view), deps)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(vi.mocked(provider.listConnections).mock.calls.length).toBe(reads);
    expect(await repository.listLedgers(outsider)).toHaveLength(0);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(actor.userId);
    expect(serialized).not.toContain("referenceDigest");
    expect(serialized).not.toContain("new-account-");
    expect(serialized).not.toContain("123456789");
    expect(await snapshot()).toBe(original);
  });

  it("records uncertainty and rejection immutably without claiming a candidate or changing financial truth", async () => {
    let view = await loadAccountReconciliation(actor, deps);
    await decideAccountReconciliation(actor, { ...command(view), candidateKey: null, decision: "cannot_determine", confirmation: false }, deps);
    view = await loadAccountReconciliation(actor, deps);
    expect(required(view.rows[0]).status).toBe("cannot_determine");
    await decideAccountReconciliation(actor, { ...command(view), decision: "not_same", confirmation: false }, deps);
    view = await loadAccountReconciliation(actor, deps);
    expect(required(view.rows[0]).status).toBe("not_same");
    expect(required(view.rows[0]).candidates.some((item) => item.previouslyRejected)).toBe(true);
    const ledger = required((await repository.listLedgers(actor))[0]);
    expect(ledger.events.map((event) => event.resultClass)).toEqual(["UNDETERMINED", "REJECTED"]);
    expect(ledger.events.every((event) => !event.matchingFields.includes("owner_attestation"))).toBe(true);
    expect(ledger.active).toBeNull(); expect(ledger.aliases).toHaveLength(1);
    expect(await snapshot()).toBe(original);
  });

  it("rejects stale or modified live evidence and wrong provider scope without a decision write", async () => {
    const view = await loadAccountReconciliation(actor, deps);
    const count = required((await repository.listLedgers(actor))[0]).events.length;
    await expect(decideAccountReconciliation(actor, { ...command(view), reviewToken: "f".repeat(64) }, deps)).rejects.toBeInstanceOf(ConflictError);
    const previous = required(accounts[0]);
    accounts[0] = { ...previous, displayName: "Changed after review" };
    await expect(decideAccountReconciliation(actor, command(view), deps)).rejects.toBeInstanceOf(ConflictError);
    accounts[0] = previous;
    providerSubject = "another-provider-subject";
    await expect(loadAccountReconciliation(actor, deps)).rejects.toBeInstanceOf(DependencyUnavailableError);
    providerSubject = connection.subjectExternalId;
    expect(required((await repository.listLedgers(actor))[0]).events).toHaveLength(count);
  });

  it("attaches an alias atomically, preserves canonical IDs/history, retries idempotently, and keeps sync blocked", async () => {
    const view = await loadAccountReconciliation(actor, deps);
    const request = command(view);
    const oldEvents = required((await repository.listLedgers(actor))[0]).events;
    await decideAccountReconciliation(actor, request, deps);
    await decideAccountReconciliation(actor, request, deps);
    const ledger = required((await repository.listLedgers(actor))[0]);
    expect(ledger.events.slice(0, 2)).toEqual(oldEvents);
    expect(ledger.events).toHaveLength(3);
    expect(ledger.aliases).toHaveLength(2);
    expect(ledger.active?.accountAlias).toBe(request.candidateKey);
    expect(required(ledger.events[2]).actorUserId.toHexString()).toBe(actor.userId);
    expect(required(ledger.events[2]).resultClass).toBe("OWNER_ATTESTED");
    expect(required(ledger.events[2]).matchingFields).toContain("owner_attestation");
    expect(required(ledger.events[2]).oldIdentity.accountAlias).not.toBe(required(ledger.events[2]).newIdentity?.accountAlias);
    expect(required((await loadAccountReconciliation(actor, deps)).rows[0]).status).toBe("confirmed");
    await expect(decideAccountReconciliation(actor, { ...request, decision: "cannot_determine" }, deps)).rejects.toBeInstanceOf(ConflictError);
    await expect(bankingRepository.assertConnectionContinuity(actor, [
      { connectionAlias: bankAlias("connection", "new-connection"), providerAlias: bankAlias("institution", "fixture-bank"), status: "ACTIVE" },
    ])).rejects.toBeInstanceOf(ReconciliationRequiredError);
    expect(await snapshot()).toBe(original);
    expect(provider.listTransactionsPage).not.toHaveBeenCalled(); expect(provider.refreshConnections).not.toHaveBeenCalled(); expect(provider.deleteConnection).not.toHaveBeenCalled();
  });

  it("prevents one new identity from being confirmed for two legacy accounts under concurrency", async () => {
    const view = await loadAccountReconciliation(actor, deps);
    const outcomes = await Promise.allSettled([
      decideAccountReconciliation(actor, command(view, 1, 0), deps),
      decideAccountReconciliation(actor, command(view, 2, 0), deps),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const ledger = await repository.listLedgers(actor);
    expect(new Set(ledger.flatMap((row) => row.active === null ? [] : [row.active.accountAlias])).size).toBe(2);
    expect(await snapshot()).toBe(original);
  });

  it("prevents competing active identities on a canonical account and rejects a missing explicit attestation", async () => {
    const view = await loadAccountReconciliation(actor, deps);
    const rowIndex = view.rows.findIndex((row) => row.status !== "confirmed");
    const request = command(view, rowIndex);
    await expect(decideAccountReconciliation(actor, { ...request, confirmation: false }, deps)).rejects.toBeInstanceOf(ConflictError);
    const outcomes = await Promise.allSettled([
      decideAccountReconciliation(actor, request, deps),
      decideAccountReconciliation(actor, command(view, rowIndex, 1), deps),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await snapshot()).toBe(original);
  });

  it("persists minimized future identity evidence without duplicating canonical accounts or retaining raw numbers", async () => {
    const candidate = required(accounts[0]);
    const before = await database.collection("accounts").countDocuments();
    await bankingRepository.observeAccount(actor, candidate, { account: bankAlias("account", candidate.externalId), connection: bankAlias("connection", candidate.connectionExternalId) }, "future-safe-identity-evidence", null);
    const evidence = await database.collection("bankRecordRevisions").findOne({ recordAlias: bankAlias("account", candidate.externalId), recordKind: "account" });
    expect(evidence?.account.identity).toEqual(candidate.identity);
    expect(BSON.EJSON.stringify(evidence)).not.toContain("1234567890");
    expect(BSON.EJSON.stringify(evidence)).not.toContain("new-account-0");
    expect(await database.collection("accounts").countDocuments()).toBe(before);
  });
});
