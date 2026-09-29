import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  inspectBankControlRecovery as inspect, projectRecoveryBankBinding as binding, projectRecoveryBankConnection as connection,
  projectRecoveryBankLifecycle as lifecycle, projectRecoveryBankSyncRun as run, quarantineBankControl,
} from "@/lib/operations/bank-control-recovery";
import { beginDeletion } from "@/lib/operations/deletion-ledger";

const at = new Date("2026-09-29T10:00:00.000Z"); const later = new Date("2026-09-29T10:01:00.000Z");
const event = (userId: ObjectId, action: string, changedFields: string[], revision: number, when = at) =>
  ({ action, actorUserId: userId, at: when, changedFields, revision, source: "open_banking" });
const counts = { accountObservationCount: 2, canonicalAccountCount: 1, canonicalTransactionCount: 0, connectionObservationCount: 1, transactionObservationCount: 0 };
const zero = { accountObservationCount: 0, canonicalAccountCount: 0, canonicalTransactionCount: 0, connectionObservationCount: 0, transactionObservationCount: 0 };
// Shapes mirror OpenBankingRepository writers; the real-Mongo rehearsal uses the repository itself.
function rows(userId = new ObjectId()): Record<"binding" | "connection" | "run" | "lifecycle", Document> {
  return {
    binding: { _id: new ObjectId(), auditTrail: [event(userId, "claimed", ["subjectAlias"], 1), event(userId, "refresh_requested", [], 2, later)],
      claimedAt: at, provider: "financy", subjectAlias: "a".repeat(64), updatedAt: later, userId, version: 2 },
    connection: { _id: new ObjectId(), accountCount: 2, auditTrail: [event(userId, "observed", ["status"], 1), event(userId, "disconnected", ["status"], 2, later)],
      connectionAlias: "b".repeat(64), createdAt: at, expiryDate: "2026-12-01", fingerprint: "c".repeat(64), lastFetchedAt: at, lastFetchedDataDate: "2026-09-29",
      mode: "PSD2", provider: "financy", providerAlias: "d".repeat(64), status: "DISCONNECTED", transactionCount: 5, updatedAt: later, userId, version: 2 },
    run: { _id: new ObjectId(), ...counts, auditTrail: [event(userId, "started", ["status"], 1), event(userId, "partial", ["status", "counts"], 2, later)],
      completedAt: later, errorCategory: "rate_limited", idempotencyKeyHash: "e".repeat(64), leaseExpiresAt: later, policyVersion: "open-banking-policy-v1",
      provider: "financy", startedAt: at, status: "partial", updatedAt: later, userId, version: 2 },
    lifecycle: { _id: new ObjectId(), completedAt: null, idempotencyKeyHash: "f".repeat(64), kind: "refresh", provider: "financy", resultStatus: null,
      startedAt: at, status: "running", updatedAt: at, userId },
  };
}
const project = { binding, connection, run, lifecycle };

describe.each(Object.keys(project) as (keyof typeof project)[])("bank %s recovery projection", kind => {
  it("preserves writer-shaped evidence exactly", () => {
    const row = rows()[kind]; const before = BSON.serialize(row);
    expect(BSON.serialize(project[kind](row))).toEqual(before);
  });
  it("rejects credential fields, unknown fields, foreign provider and malformed owner", () => {
    const row = rows()[kind];
    for (const changed of [{ ...row, accessToken: "x" }, { ...row, extra: 1 }, { ...row, provider: "other" }, { ...row, userId: "not-an-id" }]) {
      expect(() => project[kind](changed)).toThrow("Bank control recovery requires review");
    }
  });
});

it("requires owner-authored, contiguous audit history that matches current state", () => {
  const { binding: b, connection: c, run: r } = rows(); const foreign = new ObjectId();
  expect(() => binding({ ...b, auditTrail: [b.auditTrail[0], { ...b.auditTrail[1], actorUserId: foreign }] })).toThrow();
  expect(() => binding({ ...b, version: 3 })).toThrow();
  expect(() => binding({ ...b, auditTrail: [b.auditTrail[0], { ...b.auditTrail[1], revision: 3 }] })).toThrow();
  expect(() => binding({ ...b, updatedAt: at })).toThrow();
  expect(() => binding({ ...b, subjectAlias: "A".repeat(64) })).toThrow();
  expect(() => connection({ ...c, status: "ACTIVE" })).toThrow();
  expect(() => connection({ ...c, auditTrail: [{ ...c.auditTrail[0], at: later }, c.auditTrail[1]] })).toThrow();
  expect(() => connection({ ...c, status: "Bearer abcdefghijklmnop" })).toThrow();
  expect(connection({ ...c, auditTrail: [c.auditTrail[0], event(c.userId, "updated", ["providerObservation"], 2, later)], status: "ACTIVE" })).toBeDefined();
  expect(() => run({ ...r, auditTrail: [r.auditTrail[0], { ...r.auditTrail[1], action: "restarted" }] })).toThrow();
});

it("accepts only sync-run states the repository can produce", () => {
  const { run: r } = rows(); const u = r.userId as ObjectId;
  const running = { ...r, ...zero, auditTrail: [r.auditTrail[0]], completedAt: null, errorCategory: null, leaseExpiresAt: later, status: "running", updatedAt: at, version: 1 };
  expect(run(running)).toBeDefined();
  expect(() => run({ ...running, accountObservationCount: 1 })).toThrow();
  expect(() => run({ ...running, leaseExpiresAt: at })).toThrow();
  expect(() => run({ ...r, errorCategory: null })).toThrow();
  expect(() => run({ ...r, ...zero })).toThrow();
  expect(() => run({ ...r, errorCategory: "unexpected" })).toThrow();
  expect(() => run({ ...r, status: "failed", auditTrail: [r.auditTrail[0], { ...r.auditTrail[1], action: "failed" }] })).toThrow();
  expect(() => run({ ...r, status: "completed", errorCategory: null, auditTrail: [r.auditTrail[0], { ...r.auditTrail[1], action: "completed" }], completedAt: at })).toThrow();
  const completed = { ...r, status: "completed", errorCategory: null, auditTrail: [r.auditTrail[0], { ...r.auditTrail[1], action: "completed" }] };
  expect(run(completed)).toBeDefined();
  const reopened = [...completed.auditTrail, event(u, "restarted", ["status", "leaseExpiresAt"], 3, later)];
  expect(() => run({ ...running, auditTrail: reopened, startedAt: later, updatedAt: later, leaseExpiresAt: new Date(later.getTime() + 1), version: 3 })).toThrow();
  const retried = [event(u, "started", ["status"], 1), event(u, "failed", ["status", "counts"], 2, later), event(u, "restarted", ["status", "leaseExpiresAt"], 3, later)];
  expect(run({ ...running, auditTrail: retried, startedAt: later, updatedAt: later, leaseExpiresAt: new Date(later.getTime() + 1), version: 3 })).toBeDefined();
});

it("keeps lifecycle outcomes bounded without inventing completion", () => {
  const { lifecycle: l } = rows(); const done = { ...l, completedAt: later, updatedAt: later };
  expect(lifecycle({ ...done, status: "completed", resultStatus: "accepted" })).toBeDefined();
  expect(lifecycle({ ...done, kind: "disconnect", status: "completed", resultStatus: "disconnected" })).toBeDefined();
  expect(lifecycle({ ...done, status: "failed", resultStatus: "internal" })).toBeDefined();
  expect(() => lifecycle({ ...done, kind: "disconnect", status: "completed", resultStatus: "accepted" })).toThrow();
  expect(() => lifecycle({ ...done, status: "failed", resultStatus: "accepted" })).toThrow();
  expect(() => lifecycle({ ...l, resultStatus: "accepted" })).toThrow();
  expect(() => lifecycle({ ...l, updatedAt: later })).toThrow();
  // Start and finish may come from different processes' clocks; skew is not evidence of tampering.
  expect(lifecycle({ ...done, status: "completed", resultStatus: "accepted", completedAt: new Date(at.getTime() - 1), updatedAt: new Date(at.getTime() - 1) })).toBeDefined();
  expect(() => lifecycle({ ...done, status: "completed", resultStatus: "accepted", recoveryQuarantinedAt: later })).toThrow();
  expect(lifecycle({ ...l, recoveryQuarantinedAt: later })).toBeDefined();
});

it("reports no-replay and continuity barriers instead of authorizing provider actions", () => {
  const first = rows(); const second = rows(); const owner = second.binding.userId as ObjectId;
  second.binding = { ...second.binding, subjectAlias: "9".repeat(64) };
  second.connection = { ...second.connection, connectionAlias: "8".repeat(64), status: "ACTIVE",
    auditTrail: [second.connection.auditTrail[0], event(owner, "updated", ["providerObservation"], 2, later)] };
  const input = { bindings: [first.binding, second.binding], connections: [first.connection, second.connection],
    runs: [first.run, second.run], lifecycle: [first.lifecycle, second.lifecycle] };
  const before = BSON.serialize(input);
  expect(inspect(input)).toEqual({ policy: "bank-control-recovery-v1", releaseAllowed: false, replayProviders: false,
    unresolved: { missingBinding: 0, unverifiedKeyContinuity: 2, unverifiedConsent: 1, interruptedSyncs: 0, unknownExternalOutcomes: 2 } });
  expect(BSON.serialize(input)).toEqual(before);
  expect(inspect({ ...input, bindings: [first.binding] }).unresolved.missingBinding).toBe(3);
});

it("fails closed on duplicate identities and owner-scoped retry keys", () => {
  const first = rows(); const second = rows();
  const input = { bindings: [first.binding], connections: [first.connection], runs: [first.run], lifecycle: [first.lifecycle] };
  expect(() => inspect({ ...input, bindings: [first.binding, second.binding] })).toThrow();
  expect(() => inspect({ ...input, bindings: [first.binding, { ...first.binding, _id: new ObjectId(), subjectAlias: "9".repeat(64) }] })).toThrow();
  expect(() => inspect({ ...input, connections: [first.connection, { ...first.connection, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, runs: [first.run, { ...first.run, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, lifecycle: [first.lifecycle, { ...first.lifecycle, _id: new ObjectId() }] })).toThrow();
  expect(() => inspect({ ...input, runs: [first.run, { ...first.run, idempotencyKeyHash: "1".repeat(64) }] })).toThrow();
  // Retry keys are owner scoped: another owner's identical key is a separate command.
  expect(inspect({ ...input, bindings: [first.binding, { ...second.binding, subjectAlias: "9".repeat(64) }], runs: [first.run, second.run] }).releaseAllowed).toBe(false);
  expect(inspect({ ...input, lifecycle: [first.lifecycle, { ...first.lifecycle, _id: new ObjectId(), kind: "disconnect" }] }).releaseAllowed).toBe(false);
});

it("treats failures after a possible provider call as unknown outcomes, not resolved history", () => {
  const { binding: b, lifecycle: l } = rows(); const done = { ...l, completedAt: later, updatedAt: later, status: "failed" };
  const outcomes = (resultStatus: string, kind = "refresh") => inspect({ bindings: [b], connections: [], runs: [],
    lifecycle: [{ ...done, kind, resultStatus }] }).unresolved.unknownExternalOutcomes;
  for (const status of ["internal", "unknown", "provider_unavailable", "schema", "consent"]) expect(outcomes(status)).toBe(1);
  for (const status of ["authentication", "credits", "locked", "not_found", "rate_limited"]) expect(outcomes(status, "disconnect")).toBe(0);
});

it("fences restored non-completed commands and excludes suppressed owners without touching the source rows", () => {
  const erased = rows(); const kept = rows(); const owner = kept.binding.userId as ObjectId;
  kept.binding = { ...kept.binding, subjectAlias: "9".repeat(64) };
  const completed = { ...kept.run, _id: new ObjectId(), idempotencyKeyHash: "1".repeat(64), status: "completed", errorCategory: null,
    auditTrail: [kept.run.auditTrail[0], { ...kept.run.auditTrail[1], action: "completed" }] };
  const input = { bindings: [erased.binding, kept.binding], connections: [erased.connection, kept.connection],
    runs: [erased.run, kept.run, completed], lifecycle: [erased.lifecycle, kept.lifecycle] };
  const before = BSON.serialize(input); const key = { version: 1, material: randomBytes(32) }; const now = later.getTime() + 1_000;
  const result = quarantineBankControl(input, { environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
    authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion({ kind: "user", userId: erased.binding.userId.toHexString() }, "isolated-test", randomUUID(), now, key)] });
  expect(BSON.serialize(input)).toEqual(before);
  expect(result.releaseAllowed).toBe(false);
  expect(result.evidence).toMatchObject({ policy: "bank-control-quarantine-v1", excluded: 4, fenced: 2 });
  expect(result.evidence.unresolved).toEqual({ missingBinding: 0, unverifiedKeyContinuity: 1, unverifiedConsent: 0, interruptedSyncs: 0, unknownExternalOutcomes: 1 });
  for (const rowsOut of [result.bindings, result.connections, result.runs, result.lifecycle]) expect(rowsOut.every(row => row.userId.equals(owner))).toBe(true);
  expect(result.runs.find(row => row.status === "completed")!.recoveryQuarantinedAt).toBeUndefined();
  expect(result.runs.find(row => row.status === "partial")!.recoveryQuarantinedAt).toEqual(new Date(now));
  expect(result.lifecycle[0]!.recoveryQuarantinedAt).toEqual(new Date(now));
  expect(result.evidence.erasedProviderSubjects).toBe(0);
  // ADR-076: another owner now bound to the erased owner provider subject stays visible as a release barrier.
  const reclaimed = quarantineBankControl(input, { environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
    authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion({ kind: "user", userId: erased.binding.userId.toHexString() }, "isolated-test", randomUUID(), now, key,
      [kept.binding.subjectAlias as string])] });
  expect(reclaimed.evidence.erasedProviderSubjects).toBe(1);
  expect(reclaimed.bindings).toHaveLength(1);
  // Fenced copies remain valid artifacts and are not fenced twice.
  expect(quarantineBankControl(result, { environment: "isolated-test", keys: [key], now: now + 1, ledgerReadAt: now + 1, maxLedgerAgeMs: 0,
    authoritativeRevision: 1, suppliedRevision: 1, receipts: [] }).evidence.fenced).toBe(0);
});
