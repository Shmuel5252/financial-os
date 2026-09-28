import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { progressRecoveryFixture } from "../helpers/progress-recovery-fixture";
import { progressSourceFixture } from "../helpers/progress-source-fixture";
import { inspectProgressRecoveryLinks as inspect } from "@/lib/operations/progress-recovery-links";

function fixture() {
  const { event } = progressRecoveryFixture(); const at = event.createdAt; const owner = event.userId;
  const allocations = [{ categoryId: "system:food", amount: { amountMinor: Long.fromString("9007199254740993"), currency: "ILS" } }];
  const budget: Document = { _id: new ObjectId(event.sourceReferences[0].sourceId), userId: owner, allocations, carryIn: [],
    calendarMonth: "2026-08", currency: "ILS", closedAt: null, closingSnapshot: null, createdAt: at, updatedAt: at, status: "open", version: 1,
    auditTrail: [{ action: "created", actorUserId: owner, allocationsAfter: allocations, allocationsBefore: null, at, revision: 1 }] };
  return { events: [event], budgets: [budget], snapshots: [], reports: [], goals: [] };
}
function correction(parent: Document, digit = "b"): Document {
  return { ...parent, _id: new ObjectId(), eventKind: "correction", supersedesId: parent._id, evidenceFingerprint: digit.repeat(64) };
}
describe("quarantined progress source and correction links", () => {
  it("preserves BSON and distinguishes metadata matches from historical outcomes and currently ineligible sources", () => {
    const data = fixture(); const before = BSON.serialize(data);
    expect(inspect(data)).toMatchObject({ releaseAllowed: false, matchedSources: 1, matchedParents: 0,
      unresolved: { missingSources: 0, changedSources: 0, ineligibleSources: 1, historicalEvents: 1 } });
    expect(BSON.serialize(data)).toEqual(before);
    data.events[0]!.sourceReferences[0].version = "2";
    expect(inspect(data)).toMatchObject({ matchedSources: 0, unresolved: { changedSources: 1 } });
    data.budgets = [];
    expect(inspect(data)).toMatchObject({ unresolved: { missingSources: 1 } });
  });
  it("rejects a foreign source even when the saved revision differs, with bounded errors", () => {
    const data = fixture(); const foreign = new ObjectId();
    data.budgets[0]!.userId = foreign; data.budgets[0]!.auditTrail[0].actorUserId = foreign;
    data.events[0]!.sourceReferences[0].version = "2";
    expect(() => inspect(data)).toThrow("Progress recovery links require review");
  });
  it("matches same-owner stable-key parents but does not invent missing ancestors", () => {
    const data = fixture(); const next = correction(data.events[0]!); data.events.push(next);
    expect(inspect(data)).toMatchObject({ matchedParents: 1, unresolved: { missingParents: 0, historicalEvents: 2 } });
    data.events = [next];
    expect(inspect(data)).toMatchObject({ matchedParents: 0, unresolved: { missingParents: 1 } });
  });
  it("rejects cross-owner, conflicting stable-key and cyclic correction chains", () => {
    const data = fixture(); const next = correction(data.events[0]!); data.events.push(next);
    next.stableKey = "c".repeat(64); expect(() => inspect(data)).toThrow(); next.stableKey = data.events[0]!.stableKey;
    next.userId = new ObjectId(); next.auditTrail = [{ ...next.auditTrail[0], actorUserId: next.userId }];
    expect(() => inspect(data)).toThrow(); next.userId = data.events[0]!.userId;
    next.auditTrail = data.events[0]!.auditTrail;
    data.events[0]!.eventKind = "correction"; data.events[0]!.supersedesId = next._id;
    expect(() => inspect(data)).toThrow();
  });
  it("keeps concurrent forks and multiple roots unresolved instead of choosing a winning history", () => {
    const data = fixture(); data.events.push(correction(data.events[0]!), correction(data.events[0]!, "c"));
    expect(inspect(data)).toMatchObject({ matchedParents: 2, unresolved: { forkedParents: 1, multipleRoots: 0 } });
    data.events.push({ ...data.events[0], _id: new ObjectId(), evidenceFingerprint: "d".repeat(64) });
    expect(inspect(data)).toMatchObject({ releaseAllowed: false, unresolved: { multipleRoots: 1 } });
  });
  it("refuses duplicate record/retry identities instead of silently replacing evidence", () => {
    const data = fixture();
    expect(() => inspect({ ...data, events: [...data.events, data.events[0]!] })).toThrow();
    expect(() => inspect({ ...data, events: [...data.events, { ...data.events[0], _id: new ObjectId() }] })).toThrow();
    expect(() => inspect({ ...data, budgets: [...data.budgets, data.budgets[0]!] })).toThrow();
  });
});

describe.each(["engine_snapshot", "financial_report", "goal_progress"] as const)("progress %s source metadata", kind => {
  it("matches only recorded source metadata, never historical outcome or freshness truth", () => {
    const { input, event } = progressSourceFixture(kind);
    expect(inspect(input)).toMatchObject({ releaseAllowed: false, matchedSources: 1, unresolved: { historicalEvents: 1,
      ineligibleSources: kind === "goal_progress" ? 1 : 0, freshness: kind === "engine_snapshot" ? 1 : 0 } });
    event.sourceReferences[0].version = "different-recorded-version";
    expect(inspect(input)).toMatchObject({ matchedSources: 0, unresolved: { changedSources: 1 } });
  });
  it("rejects foreign source ownership with a sanitized error", () => {
    const { input, row } = progressSourceFixture(kind); row.userId = new ObjectId();
    if (row.auditTrail) row.auditTrail[0].actorUserId = row.userId;
    expect(() => inspect(input)).toThrow("Progress recovery links require review");
  });
});

it("does not promote stored freshness flags or hidden report evidence", () => {
  const snapshot = progressSourceFixture("engine_snapshot");
  snapshot.event.sourceReferences[0].version = snapshot.event.sourceReferences[0].version.replace(/fresh$/, "stale");
  expect(inspect(snapshot.input)).toMatchObject({ matchedSources: 1, unresolved: { freshness: 1 } });
  const report = progressSourceFixture("financial_report"); report.row.hiddenAt = report.row.createdAt;
  expect(inspect(report.input)).toMatchObject({ matchedSources: 1, unresolved: { ineligibleSources: 1 } });
});
