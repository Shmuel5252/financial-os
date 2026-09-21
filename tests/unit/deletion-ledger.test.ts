import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { beginDeletion, completeLocalDeletion, deletionRetention, deletionSubject, restorationDisposition, restorationSuppression, validateDeletionReceipt } from "@/lib/operations/deletion-ledger";

const actor = { kind: "user", userId: "100000000000000000000001" } as const;
const other = { kind: "user", userId: "100000000000000000000002" } as const;
const key = { version: 1, material: randomBytes(32) };
const at = 1_800_000_000_000;
const make = () => beginDeletion(actor, "isolated-test", randomUUID(), at, key);
const decision = (receipts: readonly unknown[]) => ({ ownerId: other.userId, contributingSubjectIds: [] as string[], receipts,
  environment: "isolated-test" as const, keys: [key], now: at + 100, ledgerReadAt: at + 50, maxLedgerAgeMs: 100,
  authoritativeRevision: 1, suppliedRevision: 1 });

describe("minimal deletion ledger", () => {
  it("validates empty ledger configuration and snapshots suppression key material", () => {
    for (const keys of [[key, key], [{ version: 0, material: randomBytes(32) }], [{ version: 1, material: randomBytes(1) }]])
      expect(() => restorationSuppression({ ...decision([]), keys })).toThrow();
    const localKey = { version: 1, material: randomBytes(32) };
    const receipt = beginDeletion(actor, "isolated-test", randomUUID(), at, localKey);
    const state = restorationSuppression({ ...decision([receipt]), keys: [localKey] });
    localKey.material.fill(0);
    expect(state.isSuppressed(actor.userId)).toBe(true); expect(state.isSuppressed(other.userId)).toBe(false);
  });
  it("emits a strict minimized receipt with no raw actor or financial/auth payload", () => {
    const r = make();
    expect(Object.keys(r).sort()).toEqual(["policy", "environment", "keyVersion", "operationId", "subject", "acceptedAt", "completedAt", "status", "revision", "signature"].sort());
    expect(JSON.stringify(r)).not.toContain(actor.userId);
    expect(validateDeletionReceipt(r, "isolated-test", [key])).toEqual(r);
    expect(() => validateDeletionReceipt({ ...r, arbitrary: "synthetic-private" }, "isolated-test", [key])).toThrow("Deletion safety validation failed");
  });
  it("separates subject by environment, key version and actor without changing financial IDs", () => {
    expect(deletionSubject(actor.userId, "staging", key)).not.toBe(make().subject);
    expect(deletionSubject(other.userId, "isolated-test", key)).not.toBe(make().subject);
    expect(deletionSubject(actor.userId, "isolated-test", { ...key, version: 2 })).not.toBe(make().subject);
  });
  it("rejects tampering, wrong key/environment and unrecognized fields", () => {
    const r = make();
    for (const altered of [{ ...r, acceptedAt: at - 1 }, { ...r, subject: "0".repeat(64) }, { ...r, signature: "x" }, { ...r, status: "locally-erased" }]) {
      expect(() => validateDeletionReceipt(altered, "isolated-test", [key])).toThrow("Deletion safety validation failed");
    }
    expect(() => validateDeletionReceipt(r, "staging", [key])).toThrow();
    expect(() => validateDeletionReceipt(r, "isolated-test", [{ version: 1, material: randomBytes(32) }])).toThrow();
    expect(() => validateDeletionReceipt(r, "isolated-test", [key, key])).toThrow();
  });
  it("rejects foreign actor completion and preserves immutable prior receipt / idempotent completion", () => {
    const r = make();
    expect(() => completeLocalDeletion(r, other, "isolated-test", at + 10, key)).toThrow();
    const done = completeLocalDeletion(r, actor, "isolated-test", at + 10, key);
    expect(r.status).toBe("suppressed"); expect(done.status).toBe("locally-erased");
    expect(completeLocalDeletion(done, actor, "isolated-test", at + 20, key)).toEqual(done);
    expect(() => completeLocalDeletion(r, actor, "isolated-test", at - 1, key)).toThrow();
  });
  it("suppresses incomplete deletion, preserves unrelated owner, and requires shared redaction", () => {
    const input = decision([make()]);
    expect(restorationDisposition(input)).toBe("preserve");
    expect(restorationDisposition({ ...input, ownerId: actor.userId })).toBe("exclude-owner");
    expect(restorationDisposition({ ...input, contributingSubjectIds: [actor.userId] })).toBe("redact-shared-before-release");
  });
  it("fails closed on stale/missing authoritative state, future clocks and duplicate/conflicting receipts", () => {
    const r = make(); const input = decision([r]);
    for (const patch of [{ suppliedRevision: 0 }, { ledgerReadAt: at - 100 }, { ledgerReadAt: at + 101 }, { keys: [] }, { receipts: [r, r] }, { receipts: [r, make()] }]) {
      expect(() => restorationDisposition({ ...input, ...patch })).toThrow("Deletion safety validation failed");
    }
    // Valid signature alone cannot authorize rollback to an older completed/suppressed ledger revision.
    expect(() => restorationDisposition({ ...input, authoritativeRevision: 2 })).toThrow();
  });
  it("rejects malformed or injected actor identity without reflecting it in errors", () => {
    expect(() => beginDeletion({ kind: "user", userId: "synthetic-private" }, "isolated-test", randomUUID(), at, key)).toThrow("Deletion safety validation failed");
    expect(() => beginDeletion(actor, "isolated-test", "not-an-operation", at, key)).toThrow();
    expect(() => beginDeletion(actor, "isolated-test", randomUUID(), at, { version: 1, material: new Uint8Array(1) })).toThrow();
  });
  it("isolates reused operation keys between actors", () => {
    const operation = randomUUID();
    const receipts = [beginDeletion(actor, "isolated-test", operation, at, key), beginDeletion(other, "isolated-test", operation, at, key)];
    expect(restorationDisposition(decision(receipts))).toBe("exclude-owner");
  });
});

describe("configured deletion retention", () => {
  const input = { now: 1000, completedAt: 100, latestRestorableExpiry: 800, replayWindowEnd: 900, safetyMarginMs: 100, inventoryVerifiedAt: 1000, maxInventoryAgeMs: 10 };
  it("uses the last copy/replay window plus margin with an explicit boundary", () => {
    expect(deletionRetention(input)).toEqual({ status: "expiry-eligible", notBefore: 1000 });
    expect(deletionRetention({ ...input, now: 999, inventoryVerifiedAt: 999 })).toEqual({ status: "retain", notBefore: 1000 });
    expect(deletionRetention({ ...input, latestRestorableExpiry: 2000 })).toEqual({ status: "retain", notBefore: 2100 });
  });
  it("never expires on unknown/incomplete/stale coverage or future verification", () => {
    for (const patch of [{ completedAt: null }, { latestRestorableExpiry: null }, { replayWindowEnd: null }, { inventoryVerifiedAt: null }, { inventoryVerifiedAt: 900 }, { inventoryVerifiedAt: 1001 }]) {
      expect(deletionRetention({ ...input, ...patch }).status).toBe("review-required");
    }
  });
  it("rejects unsafe duration configuration", () => {
    for (const safetyMarginMs of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => deletionRetention({ ...input, safetyMarginMs })).toThrow();
  });
});
