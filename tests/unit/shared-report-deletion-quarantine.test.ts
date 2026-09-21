import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateFinancialReport } from "@/lib/domain/reports/report-engine";
import { money } from "@/lib/domain/money/money";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { reportPayloadHash } from "@/lib/reports/report-repository";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { filterSharedReportDeletionQuarantine } from "@/lib/operations/shared-report-deletion-quarantine";

function fixture() {
  const owner = new ObjectId(); const member = new ObjectId(); const account = new ObjectId(); const household = new ObjectId(); const share = new ObjectId();
  const common = { auditTrail: [], createdAt: new Date(0), updatedAt: new Date(0), version: 1, schemaVersion: 1, policyVersion: "household-policy-v1" };
  const graph = { authUsers: [{ _id: owner }, { _id: member }], accounts: [{ _id: account, userId: member }], goals: [], householdMemberships: [],
    households: [{ ...common, _id: household, ownerUserId: owner, name: "Synthetic", status: "active", idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64) }],
    householdResourceShares: [{ ...common, _id: share, householdId: household, ownerUserId: member, resourceId: account, resourceKind: "account", ownerMembershipEpoch: 1, status: "unshared" }] };
  function row(included: boolean, parent?: Document): Document {
    const id = new ObjectId(); const reportVersion = parent ? parent.reportVersion + 1 : 1; const reason = parent ? "Synthetic correction" : null;
    const report = calculateFinancialReport({ accounts: included ? [{ id: `household.account.${createHash("sha256").update(share.toHexString()).digest("hex").slice(0, 16)}`, amount: money(9007199254740993n, "ILS"), label: "Synthetic", version: 1 }] : [],
      budget: [], goals: [], liabilities: [], netWorth: [], savings: [], subscriptions: [], transactions: [], generatedAt: new Date(0).toISOString(),
      timeZone: "Asia/Jerusalem", period: { kind: "month", value: "2026-09" }, scope: { kind: "household", householdId: household.toHexString() } });
    return { _id: id, userId: owner, auditTrail: [{ action: parent ? "restated" : "closed", actorUserId: owner, at: new Date(0), revision: 1 }],
      authorizationFingerprint: "a".repeat(64), createdAt: new Date(0), hiddenAt: null, idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64),
      report: toStoredDomainValue(report), reportVersion, restatementReason: reason, rootReportId: parent ? parent.rootReportId : id,
      schemaVersion: 1, scope: report.scope, status: parent ? "restated" : "closed", supersedesId: parent ? parent._id : null, version: 1,
      payloadHash: reportPayloadHash(report, reportVersion, reason, parent ? parent._id.toHexString() : null) };
  }
  const first = row(true); const rows = [first, row(false, first), row(false)];
  const key = { version: 1, material: randomBytes(32) };
  const ledger = (subject: ObjectId) => ({ environment: "isolated-test" as const, keys: [key], now: 1000, ledgerReadAt: 1000,
    maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1,
    receipts: [beginDeletion({ kind: "user", userId: subject.toHexString() }, "isolated-test", randomUUID(), 100, key)] });
  return { graph, rows, ledger, member };
}
describe("shared report suppression without financial history rewriting", () => {
  it("withholds entire affected restatement chain, preserves independent chain and original bytes", () => {
    const { graph, rows, ledger, member } = fixture(); const before = rows.map(row => BSON.serialize(row));
    const result = filterSharedReportDeletionQuarantine(rows, graph, ledger(member));
    expect(result.preserved).toHaveLength(1); expect(BSON.serialize(result.preserved[0]!)).toEqual(before[2]);
    expect(result.evidence).toMatchObject({ withheldChains: 1, withheldReports: 2, preservedReports: 1 });
    expect(result.releaseAllowed).toBe(false); expect(rows.map(row => BSON.serialize(row))).toEqual(before);
    expect(JSON.stringify(result.evidence)).not.toContain(member.toHexString());
  });
  it("keeps unaffected reports exact and fails closed on broken chains, duplicates and stale ledger", () => {
    const { graph, rows, ledger, member } = fixture();
    expect(filterSharedReportDeletionQuarantine(rows, graph, ledger(new ObjectId())).preserved.map(row => BSON.serialize(row)))
      .toEqual(rows.map(row => BSON.serialize(row)));
    for (const altered of [rows.slice(1), [...rows, rows[0]!], [{ ...rows[0], rootReportId: new ObjectId() }, ...rows.slice(1)]])
      expect(() => filterSharedReportDeletionQuarantine(altered, graph, ledger(member))).toThrow();
    expect(() => filterSharedReportDeletionQuarantine(rows, graph, { ...ledger(member), suppliedRevision: 0 })).toThrow();
  });
});
