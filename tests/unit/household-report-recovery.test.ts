import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateFinancialReport } from "@/lib/domain/reports/report-engine";
import { money } from "@/lib/domain/money/money";
import { resolveHouseholdReportSubjects } from "@/lib/operations/household-report-recovery";

function fixture() {
  const owner = new ObjectId(); const member = new ObjectId(); const account = new ObjectId(); const share = new ObjectId(); const household = new ObjectId();
  const common = { auditTrail: [], createdAt: new Date(0), updatedAt: new Date(0), version: 1, policyVersion: "household-policy-v1", schemaVersion: 1 };
  const graph = { authUsers: [{ _id: owner }, { _id: member }], accounts: [{ _id: account, userId: member }], goals: [], householdMemberships: [],
    households: [{ ...common, _id: household, ownerUserId: owner, name: "Synthetic", status: "active", idempotencyKeyHash: "a".repeat(64), idempotencyPayloadHash: "b".repeat(64) }],
    householdResourceShares: [{ ...common, _id: share, householdId: household, ownerUserId: member, ownerMembershipEpoch: 1, resourceId: account, resourceKind: "account", status: "unshared" }] };
  const report = calculateFinancialReport({ accounts: [{ amount: money(100n, "ILS"), id: `household.account.${createHash("sha256").update(share.toHexString()).digest("hex").slice(0, 16)}`, label: "Synthetic", version: 1 }],
    budget: [], goals: [], liabilities: [], netWorth: [{ amount: money(100n, "ILS"), id: "household-total:ILS", label: "Synthetic total", version: 1 }],
    savings: [], subscriptions: [], transactions: [], generatedAt: new Date(0).toISOString(), timeZone: "Asia/Jerusalem", period: { kind: "month", value: "2026-09" }, scope: { kind: "household", householdId: household.toHexString() } });
  return { graph, report, owner: owner.toHexString(), member: member.toHexString() };
}
describe("historical household report ownership recovery", () => {
  it("resolves opaque historical share aliases even after unsharing, without rewriting amounts", () => {
    const { graph, report, owner, member } = fixture(); const before = structuredClone(report);
    expect(resolveHouseholdReportSubjects(report, owner, graph)).toEqual({ releaseAllowed: false, contributingSubjectIds: [owner, member].sort() });
    expect(report).toEqual(before);
  });
  it("fails closed when historical provenance is missing instead of guessing from the amount", () => {
    const { graph, report, owner } = fixture(); graph.householdResourceShares = [];
    expect(() => resolveHouseholdReportSubjects(report, owner, graph)).toThrow("Household report recovery requires review");
  });
  it("rejects unknown owners, hidden fields, duplicate and dangling source aliases", () => {
    const { graph, report, owner } = fixture();
    expect(() => resolveHouseholdReportSubjects(report, new ObjectId().toHexString(), graph)).toThrow();
    expect(() => resolveHouseholdReportSubjects({ ...report, hidden: "SYNTHETIC_PRIVATE" }, owner, graph)).toThrow();
    expect(() => resolveHouseholdReportSubjects({ ...report, sourceReferences: [...report.sourceReferences, report.sourceReferences[0]] }, owner, graph)).toThrow();
    const altered = { ...report, sections: { ...report.sections, accounts: [{ ...report.sections.accounts[0]!, sourceAliases: ["unknown"] }] } };
    expect(() => resolveHouseholdReportSubjects(altered, owner, graph)).toThrow();
  });
});
