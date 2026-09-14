import { randomBytes } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { createBackupPackage, openBackupPackage, type RecoverySchemas } from "@/lib/operations/backup-package";
import { recoveryCollections } from "@/lib/operations/recovery-plan";

const key = { version: 1, material: randomBytes(32) };
const manifest = "a".repeat(64);
const owner = new ObjectId();
const schemas: RecoverySchemas = { accounts: { version: "synthetic-account-v1", project: row => {
  if (Object.keys(row).sort().join(",") !== "_id,amount,userId" || !(row._id instanceof ObjectId) || !(row.userId instanceof ObjectId) || !Long.isLong(row.amount)) throw new Error("Synthetic schema rejected");
  return row;
} } };
function fixture(): Record<string, Document[]> {
  const rows: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(n => [n, []]));
  rows.accounts = [{ _id: new ObjectId(), userId: owner, amount: Long.fromString("9007199254740993") }];
  rows.authAccounts = [{ _id: new ObjectId(), userId: owner, provider: "google", providerAccountId: "synthetic", type: "oauth", access_token: "SYNTHETIC_NOT_A_TOKEN" }];
  rows.authSessions = [{ sessionToken: "SYNTHETIC_NOT_A_TOKEN" }];
  rows.authVerificationTokens = [{ token: "SYNTHETIC_NOT_A_TOKEN" }];
  return rows;
}
describe("complete inventory package framing with explicitly reviewed synthetic schemas", () => {
  it("binds all 52 classifications, exact BSON and immutable IDs while excluding tokens", () => {
    const rows = fixture(); const pack = createBackupPackage(rows, schemas, manifest, key);
    expect(pack.manifest.inventory).toHaveLength(52);
    expect(pack.manifest.releaseAllowed).toBe(false);
    const restored = openBackupPackage(pack, schemas, manifest, key);
    expect(BSON.serialize(restored.accounts![0]!)).toEqual(BSON.serialize(rows.accounts![0]!));
    expect(restored.authSessions).toBeUndefined(); expect(restored.authVerificationTokens).toBeUndefined();
    expect(JSON.stringify(restored)).not.toContain("SYNTHETIC_NOT_A_TOKEN");
    expect(Object.keys(restored.authAccounts![0]!)).toEqual(["_id", "userId", "provider", "providerAccountId", "type"]);
  });
  it("has deterministic manifests for unchanged inputs, but randomized encryption", () => {
    const rows = fixture(); const a = createBackupPackage(rows, schemas, manifest, key); const b = createBackupPackage(rows, schemas, manifest, key);
    expect(a.manifest).toEqual(b.manifest); expect(a.signature).toBe(b.signature);
    expect(a.parts[0]!.ciphertext).not.toEqual(b.parts[0]!.ciphertext);
  });
  it("rejects unknown/missing collections and nonempty unreviewed schemas instead of raw copy", () => {
    const rows = fixture();
    expect(() => createBackupPackage({ ...rows, unknown: [] }, schemas, manifest, key)).toThrow();
    delete rows.profiles; expect(() => createBackupPackage(rows, schemas, manifest, key)).toThrow();
    rows.profiles = [{ userId: owner }]; expect(() => createBackupPackage(rows, schemas, manifest, key)).toThrow();
    expect(() => createBackupPackage(fixture(), {}, manifest, key)).toThrow();
  });
  it("rejects manifest/part omission, tampering, replacement and schema/index drift", () => {
    const pack = createBackupPackage(fixture(), schemas, manifest, key);
    for (const altered of [{ ...pack, signature: "b".repeat(64) }, { ...pack, parts: pack.parts.slice(1) },
      { ...pack, manifest: { ...pack.manifest, entries: pack.manifest.entries.slice(1) } },
      { ...pack, parts: [...pack.parts].reverse() }]) expect(() => openBackupPackage(altered, schemas, manifest, key)).toThrow("Backup package validation failed");
    expect(() => openBackupPackage(pack, schemas, "b".repeat(64), key)).toThrow();
    expect(() => openBackupPackage(pack, { accounts: { ...schemas.accounts!, version: "changed-v2" } }, manifest, key)).toThrow();
  });
  it("forbids overriding auth filtering or adding excluded/unknown registry entries", () => {
    for (const name of ["authAccounts", "authSessions", "unknown"])
      expect(() => createBackupPackage(fixture(), { ...schemas, [name]: schemas.accounts }, manifest, key)).toThrow();
  });
});
