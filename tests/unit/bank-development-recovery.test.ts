import { createHash } from "node:crypto";
import { Binary, BSON, Double, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  inspectBankDevelopmentRecovery as inspect, materializeBankDevelopmentArchive as materialize, projectRecoveryBankDevelopmentArchive as archive,
  projectRecoveryBankDevelopmentMigration as migration,
} from "@/lib/operations/bank-development-recovery";

const policy = "financy-development-baseline-2026-09-06-v1";
const at = new Date("2026-09-06T10:00:00.000Z"); const hex = (seed: string) => seed.repeat(64).slice(0, 64);
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const old = hex("c"); const active = hex("9");

// Nested payloads are writer-shaped rows that pass the reviewed bank adapters; the real-Mongo rehearsal uses the offline tool itself.
function fixture(userId = new ObjectId()) {
  const fields = { balance: { amountMinor: Long.fromBigInt(9007199254740993n), currency: "ILS" }, name: "Primary ••••", type: "bank" };
  const account = { _id: new ObjectId(), auditTrail: [{ action: "created", actorUserId: userId, at, changedFields: Object.keys(fields), revision: 1, source: "open_banking" }],
    createdAt: at, deletedAt: null, fields, schemaVersion: 3, source: { connectionAlias: old, kind: "open_banking", observationFingerprint: hex("1"), observedAt: at,
      provider: "financy", recordAlias: hex("a") }, updatedAt: at, userId, version: 1 };
  const connection = { _id: new ObjectId(), accountCount: 1, auditTrail: [{ action: "observed", actorUserId: userId, at, changedFields: ["status"], revision: 1, source: "open_banking" },
    { action: "disconnected", actorUserId: userId, at, changedFields: ["status"], revision: 2, source: "open_banking" }], connectionAlias: old, createdAt: at, expiryDate: null,
  fingerprint: hex("2"), lastFetchedAt: null, lastFetchedDataDate: null, mode: null, provider: "financy", providerAlias: hex("d"), status: "DISCONNECTED",
  transactionCount: 0, updatedAt: at, userId, version: 2 };
  const nested = { accounts: account, bankConnections: connection } as const;
  const targets = Object.entries(nested).map(([collection, row]) => ({ collection, id: row._id, digest: sha256(BSON.serialize(row)) }));
  const manifest = { _id: sha256(`${policy}:${userId.toHexString()}:${active}`), userId, subjectAlias: hex("5"), activeConnectionAlias: active,
    oldConnectionAliases: [old], policyVersion: policy, targets, protectedRecords: [{ collection: "profiles", id: new ObjectId(), digest: hex("6") }],
    collectionNames: ["accounts", "bankConnections", "profiles"], state: "retired", createdAt: at, retiredAt: at };
  const archives = targets.map(target => ({ _id: `${manifest._id}:${target.collection}:${target.id.toHexString()}`, migrationId: manifest._id, userId,
    collection: target.collection, sourceId: target.id, digest: target.digest, payload: new Binary(BSON.serialize(nested[target.collection as keyof typeof nested])), archivedAt: at }));
  return { userId, account, connection, manifest, archives };
}
const withoutRetiredAt = ({ retiredAt: _unused, ...row }: Document) => { void _unused; return row; };
const rewrap = (row: Document, change: (payload: Document) => Document) => {
  const bytes = BSON.serialize(change(BSON.deserialize(row.payload.value(), { promoteLongs: false })));
  return { ...row, payload: new Binary(bytes), digest: sha256(bytes) };
};

describe("development migration manifests", () => {
  it("preserve exact anti-reimport evidence", () => {
    const { manifest } = fixture(); const before = BSON.serialize(manifest);
    expect(BSON.serialize(migration(manifest))).toEqual(before);
  });
  it("reject manifests the offline tool cannot produce", () => {
    const { manifest: m } = fixture(); const other = new ObjectId();
    for (const changed of [{ ...m, userId: other }, withoutRetiredAt(m), { ...m, state: "prepared" }, { ...m, oldConnectionAliases: [old, active] },
      { ...m, oldConnectionAliases: [old, old] }, { ...m, targets: [...m.targets, m.targets[0]] }, { ...m, protectedRecords: [{ ...m.targets[0], collection: "accounts" }] },
      { ...m, targets: m.targets.filter(item => item.collection !== "accounts") }, { ...m, collectionNames: ["profiles", "accounts", "bankConnections"] },
      { ...m, collectionNames: [...m.collectionNames, "bankDevelopmentArchive"].sort() }, { ...m, policyVersion: "other" }, { ...m, extra: true },
      { ...m, targets: [{ ...m.targets[0], collection: "profiles" }, m.targets[1]] }, { ...m, collectionNames: ["accounts", "profiles"] }]) {
      expect(() => migration(changed)).toThrow("Bank development recovery requires review");
    }
    expect(migration(withoutRetiredAt({ ...m, state: "prepared" }))).toBeDefined();
    expect(migration(withoutRetiredAt({ ...m, state: "archived" }))).toBeDefined();
  });
});

describe("development archives", () => {
  it("carry the inspected nested record in the artifact and materialize the exact archived bytes", () => {
    for (const row of fixture().archives) {
      const before = BSON.serialize(row); const artifact = archive(row);
      expect(artifact.payload).not.toBeInstanceOf(Binary);
      expect(artifact.payload._id).toEqual(row.sourceId);
      expect(BSON.serialize(archive(artifact))).toEqual(BSON.serialize(artifact));
      expect(BSON.serialize(materialize(artifact))).toEqual(before);
      expect(BSON.serialize(row)).toEqual(before);
    }
    const account = archive(fixture().archives[0]!);
    expect(account.payload.fields.balance.amountMinor).toEqual(Long.fromBigInt(9007199254740993n));
    // The stored form materializes to itself as well.
    for (const row of fixture().archives) expect(BSON.serialize(materialize(row))).toEqual(BSON.serialize(row));
  });
  it("fail at capture when archived bytes could not be reproduced on restore", () => {
    const { archives: [, connection] } = fixture();
    // An integral double (e.g. written by a shell) is valid after promotion but re-serializes as int32: the package could never be opened.
    const bytes = BSON.serialize({ ...BSON.deserialize(connection!.payload.value(), { promoteLongs: false }), accountCount: new Double(1) });
    expect(() => archive({ ...connection!, payload: new Binary(bytes), digest: createHash("sha256").update(bytes).digest("hex") }))
      .toThrow("Bank development recovery requires review");
  });
  it("never accept opaque, tampered, foreign or unreviewed payloads", () => {
    const { archives: [account, connection] } = fixture();
    // Adapter-valid edits, so each case isolates one guard: bytes changed under the recorded digest, and a consistently foreign owner.
    const tampered = { ...rewrap(account!, row => ({ ...row, fields: { ...row.fields, name: "Changed" } })), digest: account!.digest };
    const foreign = new ObjectId();
    const reowned = rewrap(account!, row => ({ ...row, userId: foreign, auditTrail: row.auditTrail.map((event: Document) => ({ ...event, actorUserId: foreign })) }));
    for (const changed of [tampered, { ...account!, _id: `${account!.migrationId}:accounts:${new ObjectId().toHexString()}` },
      { ...account!, payload: new Binary(account!.payload.value(), Binary.SUBTYPE_USER_DEFINED) },
      reowned, rewrap(account!, row => ({ ...row, _id: new ObjectId() })),
      rewrap(account!, row => ({ ...row, source: { kind: "manual" } })), rewrap(account!, row => ({ ...row, accessToken: "x" })),
      rewrap(connection!, row => ({ ...row, status: "ACTIVE" })), { ...account!, collection: "bankConnections" }, { ...account!, extra: 1 },
      { ...account!, payload: "not-binary" },
      { ...archive(account!), payload: { ...archive(account!).payload, fields: { ...archive(account!).payload.fields, name: "Changed" } } },
      { ...archive(account!), payload: { ...archive(account!).payload, accessToken: "x" } }]) {
      expect(() => archive(changed)).toThrow("Bank development recovery requires review");
    }
  });
});

it("links archives to manifests and reports resurrection and mixed-subject digests without resolving them", () => {
  const { manifest, archives, account, connection, userId } = fixture();
  const input = { migrations: [manifest], archives, connections: [], revisions: [], accounts: [], transactions: [] };
  const before = BSON.serialize(input);
  expect(inspect(input)).toEqual({ policy: "bank-development-recovery-v1", releaseAllowed: false, matched: 2,
    unresolved: { missingManifest: 0, missingArchive: 0, retiredReappeared: 0, mixedSubjectDigests: 1 } });
  expect(BSON.serialize(input)).toEqual(before);
  expect(inspect({ ...input, archives: [archives[0]!] }).unresolved.missingArchive).toBe(1);
  expect(inspect({ ...input, migrations: [] }).unresolved).toMatchObject({ missingManifest: 2, mixedSubjectDigests: 0 });
  expect(inspect({ ...input, migrations: [withoutRetiredAt({ ...manifest, state: "prepared" })], archives: [] }).unresolved.missingArchive).toBe(0);
  // An interrupted (archived, not retired) migration still needs its archives but, like the runtime reader, does not suppress reimport.
  const interrupted = withoutRetiredAt({ ...manifest, state: "archived" });
  expect(inspect({ ...input, migrations: [interrupted], archives: [] }).unresolved.missingArchive).toBe(2);
  expect(inspect({ ...input, migrations: [interrupted], connections: [connection] }).unresolved.retiredReappeared).toBe(0);
  // A retired connection or record that is back in the restored set is reported, including by a new alias-scoped row.
  expect(inspect({ ...input, connections: [connection], accounts: [account] }).unresolved.retiredReappeared).toBe(2);
  expect(inspect({ ...input, revisions: [{ _id: new ObjectId(), userId, connectionAlias: old }] }).unresolved.retiredReappeared).toBe(1);
  expect(inspect({ ...input, accounts: [{ ...account, _id: new ObjectId(), userId: new ObjectId() }] }).unresolved.retiredReappeared).toBe(0);
});

it("fails closed on foreign archives, unlisted targets and duplicate manifests", () => {
  const { manifest, archives } = fixture(); const other = fixture();
  const input = { migrations: [manifest], archives, connections: [], revisions: [], accounts: [], transactions: [] };
  expect(() => inspect({ ...input, archives: [...archives, ...other.archives.map(row => ({ ...row, migrationId: manifest._id,
    _id: `${manifest._id}:${row.collection}:${row.sourceId.toHexString()}` }))] })).toThrow();
  expect(() => inspect({ ...input, migrations: [{ ...manifest, targets: [manifest.targets[0]!] }] })).toThrow();
  // A self-consistent archive of another owner, listed by digest in this owner's manifest, is still refused.
  const foreign = new ObjectId(); const bytes = BSON.serialize({ ...BSON.deserialize(archives[0]!.payload.value(), { promoteLongs: false }), userId: foreign,
    auditTrail: [{ ...BSON.deserialize(archives[0]!.payload.value(), { promoteLongs: false }).auditTrail[0], actorUserId: foreign }] });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const listed = { ...manifest, targets: manifest.targets.map((item, index) => index === 0 ? { ...item, digest } : item) };
  expect(() => inspect({ ...input, migrations: [listed], archives: [{ ...archives[0]!, userId: foreign, digest, payload: new Binary(bytes) }] })).toThrow();
  expect(() => inspect({ ...input, migrations: [manifest, manifest] })).toThrow();
  expect(() => inspect({ ...input, archives: [archives[0]!, archives[0]!] })).toThrow();
  expect(() => inspect({ ...input, accounts: [{ _id: "not-an-id" }] })).toThrow();
});

it("gives every restorable collection a reviewed adapter; only exclusions and rebuilds have none", async () => {
  const { recoveryPlan, recoveryCollections } = await import("@/lib/operations/recovery-plan");
  const { initialRecoverySchemas } = await import("@/lib/operations/recovery-schemas");
  const restorable = recoveryPlan(recoveryCollections).collections.filter(item => item.action !== "exclude" && item.action !== "rebuild").map(item => item.name);
  expect(restorable).toHaveLength(47);
  // authAccounts uses the built-in token-free projection inside the package itself.
  expect(restorable.filter(name => name !== "authAccounts" && initialRecoverySchemas[name] === undefined)).toEqual([]);
  expect(Object.keys(initialRecoverySchemas).sort()).toEqual(restorable.filter(name => name !== "authAccounts").sort());
});
