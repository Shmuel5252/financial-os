import { createHash } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  inspectBankDevelopmentRecovery as inspect, projectRecoveryBankDevelopmentMigration as migration,
} from "@/lib/operations/bank-development-recovery";

const policy = "financy-development-baseline-2026-09-06-v1";
const at = new Date("2026-09-06T10:00:00.000Z"); const hex = (seed: string) => seed.repeat(64).slice(0, 64);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const old = hex("c"); const active = hex("9");

// Writer-shaped retired manifest; the real-Mongo rehearsal uses the offline tool itself.
function fixture(userId = new ObjectId()) {
  const account = { _id: new ObjectId(), userId, source: { connectionAlias: old } };
  const connection = { _id: new ObjectId(), userId, connectionAlias: old };
  const manifest: Document = { _id: sha256(`${policy}:${userId.toHexString()}:${active}`), userId, subjectAlias: hex("5"), activeConnectionAlias: active,
    oldConnectionAliases: [old], policyVersion: policy,
    targets: [{ collection: "accounts", id: account._id, digest: hex("1") }, { collection: "bankConnections", id: connection._id, digest: hex("2") }],
    protectedRecords: [{ collection: "profiles", id: new ObjectId(), digest: hex("6") }],
    collectionNames: ["accounts", "bankConnections", "profiles"], state: "retired", createdAt: at, retiredAt: at };
  return { userId, account, connection, manifest };
}
const without = (row: Document, ...fields: string[]) => { const copy = { ...row }; for (const field of fields) delete copy[field]; return copy; };

describe("development migration manifests", () => {
  it("minimize retired manifests to runtime anti-reimport evidence, idempotently", () => {
    const { manifest } = fixture(); const before = BSON.serialize(manifest);
    const artifact = migration(manifest);
    // ADR-076 C1: other owners' protected-record IDs/digests never enter the artifact of a completed retirement.
    expect(artifact).not.toHaveProperty("protectedRecords");
    expect(BSON.serialize(artifact)).toEqual(BSON.serialize(without(manifest, "protectedRecords")));
    expect(BSON.serialize(migration(artifact))).toEqual(BSON.serialize(artifact));
    expect(BSON.serialize(manifest)).toEqual(before);
  });
  it("keep protected records only where an interrupted retirement still needs them", () => {
    const { manifest } = fixture();
    for (const state of ["prepared", "archived"]) {
      const interrupted = { ...without(manifest, "retiredAt"), state };
      expect(BSON.serialize(migration(interrupted))).toEqual(BSON.serialize(interrupted));
      expect(() => migration(without(interrupted, "protectedRecords"))).toThrow("Bank development recovery requires review");
    }
  });
  it("reject manifests the offline tool cannot produce", () => {
    const { manifest: m } = fixture(); const other = new ObjectId();
    for (const changed of [{ ...m, userId: other }, without(m, "retiredAt"), { ...m, state: "prepared" }, { ...m, oldConnectionAliases: [old, active] },
      { ...m, oldConnectionAliases: [old, old] }, { ...m, targets: [...m.targets, m.targets[0]] }, { ...m, protectedRecords: [{ ...m.targets[0], collection: "accounts" }] },
      { ...m, targets: m.targets.filter((item: Document) => item.collection !== "accounts") }, { ...m, collectionNames: ["profiles", "accounts", "bankConnections"] },
      { ...m, collectionNames: [...m.collectionNames, "bankDevelopmentArchive"].sort() }, { ...m, policyVersion: "other" }, { ...m, extra: true },
      { ...m, targets: [{ ...m.targets[0], collection: "profiles" }, m.targets[1]] }, { ...m, collectionNames: ["accounts", "profiles"] },
      { ...m, accessToken: "x" }]) {
      expect(() => migration(changed)).toThrow("Bank development recovery requires review");
    }
  });
});

it("reports reappearing retired data and remaining mixed-subject digests without resolving them", () => {
  const { manifest, account, connection, userId } = fixture();
  const input = { migrations: [manifest], connections: [], revisions: [], accounts: [], transactions: [] };
  const before = BSON.serialize(input);
  expect(inspect(input)).toEqual({ policy: "bank-development-recovery-v2", releaseAllowed: false, unresolved: { retiredReappeared: 0, mixedSubjectDigests: 0, interruptedRetirements: 0 } });
  expect(BSON.serialize(input)).toEqual(before);
  const interrupted = { ...without(manifest, "retiredAt"), state: "archived" };
  expect(inspect({ ...input, migrations: [interrupted] }).unresolved).toEqual({ retiredReappeared: 0, mixedSubjectDigests: 1, interruptedRetirements: 1 });
  // Like the runtime reader, only a completed retirement suppresses reimport.
  expect(inspect({ ...input, migrations: [interrupted], connections: [connection] }).unresolved.retiredReappeared).toBe(0);
  expect(inspect({ ...input, connections: [connection], accounts: [account] }).unresolved.retiredReappeared).toBe(2);
  expect(inspect({ ...input, revisions: [{ _id: new ObjectId(), userId, connectionAlias: old }] }).unresolved.retiredReappeared).toBe(1);
  expect(inspect({ ...input, accounts: [{ ...account, _id: new ObjectId(), userId: new ObjectId() }] }).unresolved.retiredReappeared).toBe(0);
  expect(() => inspect({ ...input, migrations: [manifest, manifest] })).toThrow();
  expect(() => inspect({ ...input, accounts: [{ _id: "not-an-id" }] })).toThrow();
});

it("covers every restorable collection with a reviewed adapter; the development archive is excluded", async () => {
  const { recoveryPlan, recoveryCollections } = await import("@/lib/operations/recovery-plan");
  const { initialRecoverySchemas } = await import("@/lib/operations/recovery-schemas");
  const plan = recoveryPlan(recoveryCollections).collections;
  expect(plan.find(item => item.name === "bankDevelopmentArchive")!.action).toBe("exclude");
  const restorable = plan.filter(item => item.action !== "exclude" && item.action !== "rebuild").map(item => item.name);
  expect(restorable).toHaveLength(46);
  // authAccounts uses the built-in token-free projection inside the package itself.
  expect(Object.keys(initialRecoverySchemas).sort()).toEqual(restorable.filter(name => name !== "authAccounts").sort());
});
