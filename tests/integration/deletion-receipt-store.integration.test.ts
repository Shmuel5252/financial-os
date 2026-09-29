import { randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { DeletionReceiptStore, type DeletionLedgerRow } from "@/lib/operations/deletion-receipt-store";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";

// The independent ledger needs transactions and snapshot reads: a (local, synthetic) replica set.
const uri = process.env.MONGODB_TEST_REPLICA_URI;
const replica = uri ? describe : describe.skip;
const actorOf = () => ({ kind: "user" as const, userId: new ObjectId().toHexString() });
const keyring = (key = { version: 1, material: randomBytes(32) }) => ({ active: key, keys: [key] });

replica("independent deletion ledger (B1 semantics on a synthetic replica set; no real account erasure)", () => {
  it("preserves suppression, converges concurrent retries and advances a monotonic head exactly once per state change", async () => {
    const fixture = await createIsolatedRecoveryTarget(uri!);
    try {
      const store = new DeletionReceiptStore(fixture.database, "isolated-test", keyring());
      const actor = actorOf(); const other = actorOf(); const operation = randomUUID(); const alias = "a".repeat(64);
      expect((await store.snapshot()).head).toBe(0);
      const receipts = await Promise.all(Array.from({ length: 5 }, (_, i) => store.accept(actor, operation, 1000 + i, [alias])));
      expect(new Set(receipts.map(r => r.signature)).size).toBe(1);
      expect((await store.snapshot()).head).toBe(1);
      // Retry after a timeout: same receipt, no second head advance.
      expect(await store.accept(actor, operation, 2000, [alias])).toEqual(receipts[0]);
      expect((await store.snapshot()).head).toBe(1);
      await expect(store.accept(actor, randomUUID(), 1010, [alias])).rejects.toThrow("Deletion ledger conflict");
      await expect(store.accept(actor, operation, 1011, [])).rejects.toThrow("Deletion ledger conflict");
      await expect(store.recordLocalCompletion(other, operation, 1010)).rejects.toThrow("Deletion ledger conflict");
      const completed = await Promise.all(Array.from({ length: 4 }, (_, i) => store.recordLocalCompletion(actor, operation, 1020 + i)));
      expect(new Set(completed.map(r => r.signature)).size).toBe(1);
      const snapshot = await store.snapshot();
      expect(snapshot.head).toBe(2); expect(snapshot.receipts).toEqual([completed[0]]);
      expect(await store.isProviderSubjectErased(alias)).toBe(true);
      expect(await store.isProviderSubjectErased("b".repeat(64))).toBe(false);
      const rows = fixture.database.collection<DeletionLedgerRow>("deletionReceipts");
      const row = (await rows.findOne())!;
      expect(row.accepted.status).toBe("suppressed"); expect(row.current.status).toBe("locally-erased"); expect(row.revision).toBe(2);
      expect(JSON.stringify(row)).not.toContain(actor.userId); expect(JSON.stringify(row)).not.toContain(alias);
      expect(await store.read(other)).toBeNull();
      await rows.updateOne({ _id: row._id }, { $set: { "current.signature": "0".repeat(64) } });
      await expect(store.read(actor)).rejects.toThrow("Deletion safety validation failed");
      await expect(store.snapshot()).rejects.toThrow("Deletion safety validation failed");
    } finally { await fixture.dispose(); }
  });

  it("keeps partial failure suppressed and never advances the head for an aborted transaction", async () => {
    const fixture = await createIsolatedRecoveryTarget(uri!);
    try {
      const store = new DeletionReceiptStore(fixture.database, "isolated-test", keyring());
      const actor = actorOf(); const operation = randomUUID();
      const accepted = await store.accept(actor, operation, 1000);
      const rows = fixture.database.collection("deletionReceipts");
      const failure = vi.spyOn(Object.getPrototypeOf(rows), "updateOne").mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_ERROR"));
      await expect(store.recordLocalCompletion(actor, operation, 1010)).rejects.toThrow("Deletion ledger unavailable");
      failure.mockRestore();
      expect((await store.read(actor))?.signature).toBe(accepted.signature);
      expect((await store.snapshot()).head).toBe(1);
      const completed = await store.recordLocalCompletion(actor, operation, 1020);
      expect(await store.recordLocalCompletion(actor, operation, 1030)).toEqual(completed);
      expect((await store.snapshot()).head).toBe(2);
    } finally { await fixture.dispose(); }
  });

  it("keeps erasures made under an older ledger key effective after rotation", async () => {
    const fixture = await createIsolatedRecoveryTarget(uri!);
    try {
      const v1 = { version: 1, material: randomBytes(32) }; const v2 = { version: 2, material: randomBytes(32) };
      const actor = actorOf(); const operation = randomUUID(); const alias = "d".repeat(64);
      await new DeletionReceiptStore(fixture.database, "isolated-test", keyring(v1)).accept(actor, operation, 1000, [alias]);
      const rotated = new DeletionReceiptStore(fixture.database, "isolated-test", { active: v2, keys: [v1, v2] });
      // Markers, subject lookup and completion still resolve under the older key; no second receipt is created.
      expect(await rotated.isProviderSubjectErased(alias)).toBe(true);
      expect((await rotated.read(actor))?.keyVersion).toBe(1);
      expect(await rotated.accept(actor, operation, 2000, [alias])).toMatchObject({ keyVersion: 1, operationId: operation });
      expect((await rotated.recordLocalCompletion(actor, operation, 3000)).status).toBe("locally-erased");
      expect((await rotated.snapshot()).receipts).toHaveLength(1);
      // Dropping the old key is not silently tolerated: its receipts can no longer be verified.
      await expect(new DeletionReceiptStore(fixture.database, "isolated-test", keyring(v2)).snapshot()).rejects.toThrow();
    } finally { await fixture.dispose(); }
  });

  it("fails closed as unavailable, never as success, when the ledger cannot be reached", async () => {
    const fixture = await createIsolatedRecoveryTarget(uri!);
    const store = new DeletionReceiptStore(fixture.database, "isolated-test", keyring());
    await fixture.dispose(); // closes the client
    for (const call of [() => store.accept(actorOf(), randomUUID(), 1), () => store.snapshot(), () => store.read(actorOf()),
      () => store.isProviderSubjectErased("a".repeat(64))]) await expect(call()).rejects.toThrow("Deletion ledger unavailable");
  });
});
