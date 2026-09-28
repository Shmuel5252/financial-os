import { createHash } from "node:crypto";
import { Long, ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { netWorthSnapshotFixture } from "../helpers/net-worth-recovery-fixture";
import { fromStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { netWorthStateFingerprint } from "@/lib/net-worth/net-worth-repository";
import { netWorthStatementDomainSchema } from "@/lib/net-worth/net-worth";
import { inspectNetWorthRecoveryLinks as inspect } from "@/lib/operations/net-worth-recovery-links";

function rehash(row: Document) {
  row.payloadHash = createHash("sha256").update(JSON.stringify(stableSerializableDomainValue(fromStoredDomainValue(row.fields)))).digest("hex");
}
function fingerprint(row: Document) {
  row.stateFingerprint = netWorthStateFingerprint(netWorthStatementDomainSchema.parse(fromStoredDomainValue(row.statement)));
}
function fixture() {
  const snapshot = netWorthSnapshotFixture(); const at = snapshot.createdAt; const owner = snapshot.userId;
  const value = { amountMinor: Long.fromNumber(7), currency: "USD" };
  const item: Document = { _id: new ObjectId(snapshot.statement.included.find((c: Document) => c.sourceKind === "net_worth_item").sourceId),
    userId: owner, createdAt: at, updatedAt: at, deletedAt: null, version: 1, schemaVersion: 1,
    fields: { amount: value, category: "other_asset", effectiveAt: at.toISOString(), label: "Synthetic item",
      provenance: { kind: "user_entered", note: null }, relationship: { kind: "standalone" }, side: "asset", valuationType: "user_estimate" },
    idempotencyKeyHash: "a".repeat(64),
    auditTrail: [{ action: "created", actorUserId: owner, at, changedFields: ["fields"], revision: 1, source: "net_worth_item" }] };
  rehash(item);
  const base = { userId: owner, createdAt: at, updatedAt: at, deletedAt: null, version: 1, schemaVersion: 2,
    source: { kind: "manual" }, auditTrail: [] };
  const account: Document = { ...base, _id: new ObjectId(snapshot.statement.included.find((c: Document) => c.sourceKind === "account").sourceId),
    fields: { name: "Synthetic account", type: "bank", balance: value } };
  const loan: Document = { ...base, _id: new ObjectId(), fields: { name: "Synthetic loan", annualInterestRateBps: 0, endDate: null,
    nextPaymentDate: "2026-10-01", monthlyPayment: value, originalAmount: value, remainingBalance: value } };
  const card: Document = { ...base, _id: new ObjectId(), fields: { name: "Synthetic card", issuer: "Synthetic", billingDay: 1, limit: value, used: value } };
  const savings: Document = { ...base, _id: new ObjectId(), fields: { name: "Synthetic savings", accountIdentifierLast4: null,
    availability: "liquid", institution: null, maturityDate: null, balance: value } };
  return { snapshot, item, account, loan, card, savings };
}
it("inspects typed owner/revision references but never certifies historical valuations", () => {
  const { snapshot, item, account } = fixture();
  expect(inspect([snapshot], { netWorthItems: [item], accounts: [account] })).toEqual({ policy: "net-worth-recovery-links-v1",
    releaseAllowed: false, matched: 2, unresolved: { missing: 0, changed: 0, inactive: 0, unversioned: 0, historicalStatements: 1 } });
});
it("includes excluded components and all five source kinds in owner checks", () => {
  const { snapshot, item, account, loan, card, savings } = fixture();
  for (const [sourceKind, row] of [["loan", loan], ["credit_card", card], ["savings", savings]] as const) {
    snapshot.statement.excluded.push({ component: { ...snapshot.statement.included[0], id: sourceKind, sourceKind, sourceId: row._id.toHexString() }, reason: "fallback_replaced" });
  }
  fingerprint(snapshot);
  const records = { netWorthItems: [item], accounts: [account], loans: [loan], creditCards: [card], savings: [savings] };
  expect(inspect([snapshot], records).matched).toBe(5);
  card.userId = new ObjectId();
  expect(() => inspect([snapshot], records)).toThrow("Net worth recovery links require review");
});
it("keeps missing, changed and inactive references unresolved", () => {
  const { snapshot, item, account } = fixture();
  expect(inspect([snapshot], { netWorthItems: [item] }).unresolved.missing).toBe(1);
  account.version = 2;
  expect(inspect([snapshot], { netWorthItems: [item], accounts: [account] }).unresolved.changed).toBe(1);
  account.deletedAt = account.updatedAt;
  expect(inspect([snapshot], { netWorthItems: [item], accounts: [account] }).unresolved.inactive).toBe(1);
});
it("checks account and liability relationships without inventing historical source versions", () => {
  const { item, account, loan, card } = fixture();
  for (const [relationship, category, side, collection, target] of [
    [{ kind: "account_detail", accountId: account._id.toHexString(), aggregationMode: "parent_authoritative" }, "investment", "asset", "accounts", account],
    [{ kind: "liability_evidence", recordId: loan._id.toHexString(), recordKind: "loan" }, "loan", "liability", "loans", loan],
    [{ kind: "liability_evidence", recordId: card._id.toHexString(), recordKind: "credit_card" }, "credit_card", "liability", "creditCards", card],
  ] as const) {
    item.fields = { ...item.fields, relationship, category, side }; rehash(item);
    expect(inspect([], { netWorthItems: [item], [collection]: [target] })).toEqual({ policy: "net-worth-recovery-links-v1",
      releaseAllowed: false, matched: 0, unresolved: { missing: 0, changed: 0, inactive: 0, unversioned: 1, historicalStatements: 0 } });
    expect(inspect([], { netWorthItems: [item] }).unresolved.missing).toBe(1);
    expect(() => inspect([], { netWorthItems: [item], [collection]: [{ ...target, userId: new ObjectId() }] })).toThrow();
  }
});
it("fails closed for malformed sources, unknown collections, duplicate IDs and unique owner keys", () => {
  const { snapshot, item, account } = fixture();
  expect(() => inspect([snapshot], { unknown: [] })).toThrow();
  expect(() => inspect([snapshot], { accounts: [{ ...account, unexpected: true }] })).toThrow();
  expect(() => inspect([snapshot, snapshot], {})).toThrow();
  expect(() => inspect([snapshot, { ...snapshot, _id: new ObjectId() }], {})).toThrow();
  expect(() => inspect([], { accounts: [account, account] })).toThrow();
  expect(() => inspect([], { netWorthItems: [item, { ...item, _id: new ObjectId() }] })).toThrow();
});
