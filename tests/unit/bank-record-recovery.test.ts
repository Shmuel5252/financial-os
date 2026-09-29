import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  inspectBankRecordRecovery as inspect, projectRecoveryBankReconciliation as reconciliation,
  projectRecoveryBankRecordRevision as revision, projectRecoveryOpenBankingRecord as canonical,
} from "@/lib/operations/bank-record-recovery";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const at = new Date("2026-09-29T10:00:00.000Z"); const later = new Date("2026-09-29T11:00:00.000Z");
const hex = (seed: string) => seed.repeat(64).slice(0, 64);
const stored = (amount: bigint) => ({ amountMinor: Long.fromBigInt(amount), currency: "ILS" });
const identity = { version: "financy-account-identity-v1", bankCode: "12", branchCode: "345", maskedNumber: "•••• 6789", referenceDigest: hex("7") };
const comparison = { institution: "Synthetic bank", name: "Primary ••••", type: "CHECKING", currency: "ILS", maskedNumber: "•••• 6789", bankCode: "12", branchCode: "345" };
const reference = (account: string) => ({ accountAlias: account, connectionAlias: hex("c"), institutionAlias: hex("d"), identity, comparison });

// Shapes mirror OpenBankingRepository / AccountReconciliationRepository writers; the real-Mongo rehearsal uses the service itself.
function rows(userId = new ObjectId()) {
  const base = { canonicalRecordId: null, connectionAlias: hex("c"), observedAt: at, provider: "financy", sequence: 1, userId };
  const account = { _id: new ObjectId(), ...base, account: { identity, accountType: "CHECKING", balances: [{ amount: stored(9007199254740993n), creditLimitIncluded: false,
    referenceDate: "2026-09-29", type: "interimAvailable" }], currency: "ILS", displayName: "Primary ••••", isDuplicate: false },
  accountAlias: hex("a"), fingerprint: hex("1"), recordAlias: hex("a"), recordKind: "account" };
  const connection = { _id: new ObjectId(), ...base, accountAlias: null, connection: { expiryDate: "2026-12-01", lastFetchedAt: at, lastFetchedDataDate: "2026-09-29",
    mode: "PSD2", providerAlias: hex("d"), status: "ACTIVE" }, fingerprint: hex("2"), recordAlias: hex("c"), recordKind: "connection" };
  const transaction = { _id: new ObjectId(), ...base, accountAlias: hex("a"), fingerprint: hex("3"), recordAlias: hex("e"), recordKind: "transaction",
    transaction: { amount: stored(-1234n), bookingDate: "2026-09-02", categoryMain: "shopping", categorySub: null, changedCategoryMain: null, changedCategorySub: null,
      installmentNumber: null, installmentTotal: null, isDuplicate: false, merchantName: "Merchant ••••", originalAmount: null, status: "BOOKED",
      transactionDate: "2026-09-02", type: "CHECKING", valueDate: "2026-09-02" } };
  const event = (fields: string[]) => ({ action: "created", actorUserId: userId, at, changedFields: fields, revision: 1, source: "open_banking" });
  const source = (recordAlias: string, observationFingerprint: string) => ({ connectionAlias: hex("c"), kind: "open_banking", observationFingerprint, observedAt: at, provider: "financy", recordAlias });
  const accountFields = { balance: stored(9007199254740993n), name: "Primary ••••", type: "bank" };
  const canonicalAccount = { _id: new ObjectId(), auditTrail: [event(Object.keys(accountFields))], createdAt: at, deletedAt: null, fields: accountFields,
    schemaVersion: 3, source: source(hex("a"), hex("1")), updatedAt: at, userId, version: 1 };
  const transactionFields = { accountId: canonicalAccount._id.toHexString(), amount: stored(1234n), category: "shopping", confidenceBps: 10_000, date: "2026-09-02",
    destinationAccountId: null, merchant: "Merchant ••••", notes: null, recurring: false, refundOfTransactionId: null, type: "expense" };
  const canonicalTransaction = { _id: new ObjectId(), auditTrail: [event(Object.keys(transactionFields))], createdAt: at, deletedAt: null, fields: transactionFields,
    schemaVersion: 3, source: source(hex("e"), hex("3")), updatedAt: at, userId, version: 1 };
  const decision = { requestKey: hex("4"), requestFingerprint: hex("5"), actorUserId: userId, at: later, decision: "same_account", resultClass: "OWNER_ATTESTED",
    source: "authenticated_owner", policyVersion: "financy-reconnection-v1", workflowVersion: "manual-account-attestation-v1", canonicalVersion: 1,
    oldIdentity: reference(hex("a")), newIdentity: reference(hex("f")),
    matchingFields: ["owner_attestation", "institution", "account_type", "currency", "displayed_comparison"], ambiguityResolvedByOwner: true };
  const ledger = { _id: new ObjectId(), userId, provider: "financy", canonicalAccountId: canonicalAccount._id, aliases: [hex("a"), hex("f")],
    active: reference(hex("f")), events: [decision], version: 1 };
  return { account, connection, transaction, canonicalAccount, canonicalTransaction, ledger };
}
const projections = {
  account: revision, connection: revision, transaction: revision, ledger: reconciliation,
  canonicalAccount: (row: Document) => canonical("accounts", row), canonicalTransaction: (row: Document) => canonical("transactions", row),
};

describe.each(Object.keys(projections) as (keyof typeof projections)[])("bank %s recovery projection", kind => {
  it("preserves writer-shaped evidence and exact Long money", () => {
    const row = rows()[kind] as Document; const before = BSON.serialize(row);
    expect(BSON.serialize(projections[kind](row))).toEqual(before);
  });
  it("rejects credential/unknown fields, foreign provider and malformed owner", () => {
    const row = rows()[kind] as Document;
    for (const changed of [{ ...row, accessToken: "x" }, { ...row, extra: 1 }, { ...row, provider: "other" }, { ...row, userId: "x" }]) {
      expect(() => projections[kind](changed)).toThrow("Bank record recovery requires review");
    }
  });
});

it("keeps each revision kind internally consistent", () => {
  const { account, connection, transaction } = rows();
  expect(() => revision({ ...account, accountAlias: hex("9") })).toThrow();
  expect(() => revision({ ...connection, recordAlias: hex("9") })).toThrow();
  expect(() => revision({ ...connection, accountAlias: hex("a") })).toThrow();
  expect(() => revision({ ...account, canonicalRecordId: new ObjectId() })).toThrow();
  expect(() => revision({ ...transaction, account: account.account })).toThrow();
  expect(() => revision({ ...account, account: { ...account.account, balances: [{ ...account.account.balances[0], amount: { amountMinor: 1.5, currency: "ILS" } }] } })).toThrow();
  expect(() => revision({ ...account, account: { ...account.account, identity: { ...identity, maskedNumber: null } } })).toThrow();
  expect(() => revision({ ...transaction, transaction: { ...transaction.transaction, merchantName: "Bearer abcdefghijklmnopqrstu" } })).toThrow();
  expect(() => revision({ ...transaction, sequence: 0 })).toThrow();
  const { identity: _unused, ...legacy } = account.account; void _unused;
  expect(revision({ ...account, account: legacy })).toBeDefined();
});

it("accepts only repository-produced canonical provenance and valid domain fields", () => {
  const { canonicalAccount: a, canonicalTransaction: t } = rows(); const u = a.userId;
  const updated = { ...a, version: 2, updatedAt: later, source: { ...a.source, observedAt: later, observationFingerprint: hex("8") },
    auditTrail: [...a.auditTrail, { ...a.auditTrail[0], action: "updated", at: later, revision: 2 }] };
  expect(canonical("accounts", updated)).toBeDefined();
  expect(() => canonical("accounts", { ...updated, updatedAt: at })).toThrow();
  // The observation's now() precedes the canonical write's now(); production rows never share the timestamp.
  expect(canonical("accounts", { ...updated, source: { ...updated.source, observedAt: new Date(later.getTime() - 5) } })).toBeDefined();
  expect(() => canonical("accounts", { ...updated, auditTrail: [a.auditTrail[0], { ...updated.auditTrail[1], actorUserId: new ObjectId() }] })).toThrow();
  expect(() => canonical("accounts", { ...a, deletedAt: later })).toThrow();
  expect(() => canonical("accounts", { ...a, schemaVersion: 2 })).toThrow();
  expect(() => canonical("accounts", { ...a, source: { kind: "manual" } })).toThrow();
  expect(() => canonical("accounts", { ...a, fields: { ...a.fields, type: "unsupported" } })).toThrow();
  expect(() => canonical("accounts", { ...a, auditTrail: [{ ...a.auditTrail[0], changedFields: ["balance"] }] })).toThrow();
  expect(() => canonical("transactions", { ...t, fields: { ...t.fields, amount: { amountMinor: 1234, currency: "ILS" } } })).toThrow();
  expect(() => canonical("accounts", { ...a, idempotencyKeyHash: hex("1") })).toThrow();
  // Writer constants: bank rows never carry manual-only account types, transfer/refund links or annotations.
  expect(() => canonical("accounts", { ...a, fields: { ...a.fields, type: "cash" } })).toThrow();
  for (const fields of [{ type: "transfer", destinationAccountId: new ObjectId().toHexString() }, { destinationAccountId: new ObjectId().toHexString() },
    { notes: "note" }, { recurring: true }, { confidenceBps: 9_000 }]) {
    expect(() => canonical("transactions", { ...t, fields: { ...t.fields, ...fields } })).toThrow();
  }
  expect(u).toEqual(t.userId);
});

it("dispatches manual and bank-sourced canonical rows through the reviewed registry", () => {
  const { canonicalAccount, canonicalTransaction } = rows();
  expect(initialRecoverySchemas.accounts!.version).toBe("manual-v2-open-banking-v1");
  expect(initialRecoverySchemas.transactions!.version).toBe("manual-v2-open-banking-v1");
  expect(initialRecoverySchemas.loans!.version).toBe("manual-v2");
  expect(initialRecoverySchemas.accounts!.project(canonicalAccount)).toBe(canonicalAccount);
  expect(initialRecoverySchemas.transactions!.project(canonicalTransaction)).toBe(canonicalTransaction);
  expect(() => initialRecoverySchemas.loans!.project({ ...canonicalAccount })).toThrow();
  expect(() => initialRecoverySchemas.accounts!.project({ ...canonicalAccount, source: "manual" })).toThrow();
});

it("requires reconciliation ledgers to match their recorded owner decisions", () => {
  const { ledger } = rows(); const decision = ledger.events[0]!;
  const rejected = { ...decision, decision: "not_same", resultClass: "REJECTED", matchingFields: ["displayed_comparison"], ambiguityResolvedByOwner: false };
  expect(reconciliation({ ...ledger, events: [rejected], aliases: [hex("a")], active: null })).toBeDefined();
  expect(() => reconciliation({ ...ledger, events: [rejected] })).toThrow();
  expect(() => reconciliation({ ...ledger, active: null })).toThrow();
  expect(() => reconciliation({ ...ledger, aliases: [hex("a")] })).toThrow();
  expect(() => reconciliation({ ...ledger, aliases: [hex("a"), hex("f"), hex("f")] })).toThrow();
  expect(() => reconciliation({ ...ledger, version: 2 })).toThrow();
  expect(() => reconciliation({ ...ledger, events: [{ ...decision, actorUserId: new ObjectId() }] })).toThrow();
  expect(() => reconciliation({ ...ledger, events: [{ ...decision, resultClass: "REJECTED" }] })).toThrow();
  expect(() => reconciliation({ ...ledger, events: [{ ...decision, newIdentity: null }] })).toThrow();
  const second = { ...rejected, requestKey: hex("6"), oldIdentity: reference(hex("f")), newIdentity: reference(hex("b")) };
  expect(reconciliation({ ...ledger, events: [decision, second], version: 2 })).toBeDefined();
  expect(() => reconciliation({ ...ledger, events: [decision, { ...second, requestKey: decision.requestKey }], version: 2 })).toThrow();
  // A later decision must be about the identity the previous confirmation made active.
  expect(() => reconciliation({ ...ledger, events: [decision, { ...second, oldIdentity: reference(hex("a")) }], version: 2 })).toThrow();
});

it("links canonical rows to evidence and connections, leaving gaps unresolved", () => {
  const r = rows(); const bankConnection = { _id: new ObjectId(), accountCount: 1, auditTrail: [{ action: "observed", actorUserId: r.account.userId, at, changedFields: ["status"],
    revision: 1, source: "open_banking" }], connectionAlias: hex("c"), createdAt: at, expiryDate: null, fingerprint: hex("2"), lastFetchedAt: null, lastFetchedDataDate: null,
    mode: null, provider: "financy", providerAlias: hex("d"), status: "ACTIVE", transactionCount: 1, updatedAt: at, userId: r.account.userId, version: 1 };
  const input = { connections: [bankConnection], revisions: [r.connection, r.account, r.transaction], accounts: [r.canonicalAccount],
    transactions: [r.canonicalTransaction], reconciliations: [r.ledger] };
  const before = BSON.serialize(input);
  expect(inspect(input)).toEqual({ policy: "bank-record-recovery-v1", releaseAllowed: false, matched: 9,
    unresolved: { missingConnection: 0, missingEvidence: 0, missingAccount: 0, sequenceGaps: 0, historicalObservations: 3 } });
  expect(BSON.serialize(input)).toEqual(before);
  expect(inspect({ ...input, connections: [], revisions: [r.connection, { ...r.account, sequence: 2 }] }).unresolved)
    .toEqual({ missingConnection: 4, missingEvidence: 1, missingAccount: 0, sequenceGaps: 1, historicalObservations: 2 });
  expect(inspect({ ...input, accounts: [] }).unresolved).toMatchObject({ missingAccount: 2 });
  // Manual canonical rows are outside this provider inspection.
  expect(inspect({ ...input, accounts: [...input.accounts, { ...r.canonicalAccount, _id: new ObjectId(), source: { kind: "manual" } }] }).matched).toBe(9);
});

it("fails closed on foreign links and duplicate identities", () => {
  const r = rows(); const other = rows(); const input = { connections: [], revisions: [r.account], accounts: [r.canonicalAccount],
    transactions: [r.canonicalTransaction], reconciliations: [r.ledger] };
  expect(() => inspect({ ...input, transactions: [{ ...r.canonicalTransaction, fields: { ...r.canonicalTransaction.fields, accountId: other.canonicalAccount._id.toHexString() } }],
    accounts: [r.canonicalAccount, other.canonicalAccount] })).toThrow();
  expect(() => inspect({ ...input, reconciliations: [{ ...r.ledger, canonicalAccountId: other.canonicalAccount._id }], accounts: [r.canonicalAccount, other.canonicalAccount] })).toThrow();
  expect(() => inspect({ ...input, revisions: [r.account, { ...r.account, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, accounts: [r.canonicalAccount, { ...r.canonicalAccount, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, reconciliations: [r.ledger, { ...r.ledger, _id: new ObjectId(), canonicalAccountId: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, revisions: [r.account, { ...r.account, _id: new ObjectId(), fingerprint: hex("9") }] })).toThrow();
  // Bank links never target a manual account, even of the same owner.
  const manual = { ...r.canonicalAccount, source: { kind: "manual" } };
  expect(() => inspect({ ...input, accounts: [manual] })).toThrow();
  expect(() => inspect({ ...input, accounts: [manual], transactions: [] })).toThrow();
  // Aliases and request keys are owner scoped.
  expect(inspect({ ...input, revisions: [r.account, other.account], accounts: [r.canonicalAccount, other.canonicalAccount],
    reconciliations: [r.ledger, other.ledger] }).releaseAllowed).toBe(false);
});
