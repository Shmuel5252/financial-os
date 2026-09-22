import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { inspectManifestRecoverySources as inspect } from "@/lib/operations/manifest-source-recovery";

function fixture() {
  const userId = new ObjectId(); const _id = new ObjectId(); const at = new Date("2026-09-22T00:00:00Z");
  const row: Document = { _id, userId, createdAt: at, updatedAt: at, deletedAt: null, version: 1, schemaVersion: 2,
    source: { kind: "manual" }, fields: { name: "Synthetic", type: "bank", balance: { amountMinor: BSON.Long.fromBigInt(9007199254740993n), currency: "ILS" } },
    auditTrail: [{ action: "created", actorUserId: userId, at, changedFields: ["name", "type", "balance"], revision: 1, source: "manual" }] };
  const manifest: Document = { _id: new ObjectId(), userId, idempotencyKeyHash: "a".repeat(64), schemaVersion: 1,
    kind: "source_manifest", capturedAt: at, primaryCurrency: "ILS", sources: [{ section: "accounts", records: [{ id: _id.toHexString(), version: 1, updatedAt: at }] }],
    auditTrail: [{ action: "created", actorUserId: userId, at, changedFields: ["primaryCurrency", "sources"], revision: 1, source: "manual" }] };
  return { row, manifest };
}
describe("manifest source recovery metadata", () => {
  it("matches exact owner/version/time without mutating canonical BSON", () => {
    const { row, manifest } = fixture(); const before = BSON.serialize({ row, manifest });
    expect(inspect([manifest], { accounts: [row] })).toEqual({ policy: "manifest-recovery-sources-v1", releaseAllowed: false, matched: 1,
      unresolved: { missing: 0, changed: 0, inactive: 0 } });
    expect(BSON.serialize({ row, manifest })).toEqual(before);
  });
  it("does not substitute missing, updated or deleted current records for historical evidence", () => {
    const { row, manifest } = fixture();
    for (const [records, unresolved] of [
      [{}, { missing: 1, changed: 0, inactive: 0 }],
      [{ accounts: [{ ...row, version: 2 }] }, { missing: 0, changed: 1, inactive: 0 }],
      [{ accounts: [{ ...row, updatedAt: new Date(row.updatedAt.getTime() + 1) }] }, { missing: 0, changed: 1, inactive: 0 }],
      [{ accounts: [{ ...row, deletedAt: row.updatedAt }] }, { missing: 0, changed: 0, inactive: 1 }],
    ] as const) {
      expect(inspect([manifest], records)).toEqual({ policy: "manifest-recovery-sources-v1", releaseAllowed: false, matched: 0, unresolved });
    }
  });
  it("rejects foreign owners, duplicates, unsupported collections and malformed records safely", () => {
    const { row, manifest } = fixture(); const foreign = new ObjectId();
    for (const records of [
      { accounts: [{ ...row, userId: foreign, auditTrail: [{ ...row.auditTrail[0], actorUserId: foreign }] }] },
      { accounts: [row, row] }, { unexpected: [] }, { accounts: [{ ...row, unexpected: "synthetic-private-marker" }] },
    ]) expect(() => inspect([manifest], records)).toThrow("Manifest source recovery requires review");
    expect(() => inspect([manifest, manifest], { accounts: [row] })).toThrow("Manifest source recovery requires review");
  });
});
