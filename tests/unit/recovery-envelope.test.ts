import { randomBytes } from "node:crypto";
import { BSON, Long } from "mongodb";
import { describe, expect, it } from "vitest";
import { decryptRecoveryBson, encryptRecoveryBson } from "@/lib/operations/recovery-envelope";

const key = { version: 1, material: randomBytes(32) };
const manifest = "a".repeat(64);
const bytes = BSON.serialize({ value: Long.fromString("-9007199254740993") });
const make = () => encryptRecoveryBson(bytes, "accounts", manifest, key);

describe("synthetic recovery encryption primitive (not a complete backup)", () => {
  it("authenticates BSON and metadata while preserving exact int64", () => {
    const envelope = make();
    const plain = decryptRecoveryBson(envelope, manifest, key);
    expect(BSON.deserialize(plain, { promoteLongs: false }).value.toString()).toBe("-9007199254740993");
    expect(Buffer.from(plain)).toEqual(Buffer.from(bytes));
    expect(make().ciphertext).not.toEqual(envelope.ciphertext);
  });
  it("rejects excluded/unknown collections", () => {
    for (const collection of ["authSessions", "authVerificationTokens", "unknown", "rateLimits"])
      expect(() => encryptRecoveryBson(bytes, collection, manifest, key)).toThrow("Recovery envelope validation failed");
  });
  it("rejects altered ciphertext, tag, header, key and incompatible index manifest without raw errors", () => {
    const original = make();
    const corrupted = Uint8Array.from(original.ciphertext); corrupted[0] = corrupted[0]! ^ 1;
    for (const envelope of [{ ...original, ciphertext: corrupted }, { ...original, tag: randomBytes(16) },
      { ...original, header: { ...original.header, digest: "b".repeat(64) } }]) {
      expect(() => decryptRecoveryBson(envelope, manifest, key)).toThrow("Recovery envelope validation failed");
    }
    expect(() => decryptRecoveryBson(original, "b".repeat(64), key)).toThrow();
    expect(() => decryptRecoveryBson(original, manifest, { ...key, material: randomBytes(32) })).toThrow();
  });
  it("rejects malformed BSON and key configuration", () => {
    expect(() => encryptRecoveryBson(new Uint8Array([1]), "accounts", manifest, key)).toThrow();
    expect(() => encryptRecoveryBson(bytes, "accounts", manifest, { version: 1, material: new Uint8Array(3) })).toThrow();
  });
  it("refuses nested replayable material before encryption, even in an allowed collection", () => {
    for (const field of ["sessionToken", "access_token", "refreshToken", "id_token", "password", "authorization", "apiKey", "tokenHash"])
      expect(() => encryptRecoveryBson(BSON.serialize({ nested: [{ [field]: "SYNTHETIC_NOT_A_SECRET" }] }), "accounts", manifest, key)).toThrow("Recovery envelope validation failed");
    expect(() => encryptRecoveryBson(BSON.serialize({ nested: Buffer.from("synthetic") }), "bankDevelopmentArchive", manifest, key)).toThrow();
    expect(() => encryptRecoveryBson(BSON.serialize({ note: "Bearer SYNTHETIC_NOT_A_TOKEN" }), "profiles", manifest, key)).toThrow();
  });
});
