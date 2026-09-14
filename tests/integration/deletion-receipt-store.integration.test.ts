import { randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { DeletionReceiptStore, type DeletionLedgerRow } from "@/lib/operations/deletion-receipt-store";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";

const uri = process.env.MONGODB_TEST_URI;
const realMongo = uri ? describe : describe.skip;
realMongo("isolated durable deletion receipts (no real account erasure)", () => {
  it("preserves original suppression, converges concurrent retries and denies foreign/conflicting completions", async () => {
    const fixture = await createIsolatedRecoveryTarget(uri!);
    try {
      const collection = fixture.database.collection<DeletionLedgerRow>("suppression");
      const store = new DeletionReceiptStore(collection, "isolated-test", { version: 1, material: randomBytes(32) });
      const actor = { kind: "user" as const, userId: new ObjectId().toHexString() };
      const other = { kind: "user" as const, userId: new ObjectId().toHexString() };
      const operation = randomUUID();
      const receipts = await Promise.all(Array.from({ length: 5 }, (_, i) => store.accept(actor, operation, 1000 + i)));
      expect(new Set(receipts.map(r => r.signature)).size).toBe(1);
      expect(await collection.countDocuments()).toBe(1);
      await expect(store.accept(actor, randomUUID(), 1010)).rejects.toThrow("Deletion ledger conflict");
      await expect(store.recordLocalCompletion(other, operation, 1010)).rejects.toThrow("Deletion ledger conflict");
      expect((await store.read(actor))?.status).toBe("suppressed");
      const completed = await Promise.all(Array.from({ length: 4 }, (_, i) => store.recordLocalCompletion(actor, operation, 1020 + i)));
      expect(new Set(completed.map(r => r.signature)).size).toBe(1);
      const row = (await collection.findOne())!;
      expect(row.accepted.status).toBe("suppressed"); expect(row.current.status).toBe("locally-erased");
      expect(JSON.stringify(row)).not.toContain(actor.userId);
      expect(await store.read(other)).toBeNull();
      await collection.updateOne({ _id: row._id }, { $set: { "current.signature": "0".repeat(64) } });
      await expect(store.read(actor)).rejects.toThrow("Deletion safety validation failed");
    } finally { await fixture.dispose(); }
  });
  it("keeps partial failure suppressed and retry does not broaden or duplicate the operation", async () => {
    const fixture = await createIsolatedRecoveryTarget(uri!);
    try {
      const collection = fixture.database.collection<DeletionLedgerRow>("suppression");
      const store = new DeletionReceiptStore(collection, "isolated-test", { version: 1, material: randomBytes(32) });
      const actor = { kind: "user" as const, userId: new ObjectId().toHexString() };
      const operation = randomUUID();
      const accepted = await store.accept(actor, operation, 1000);
      const failure = vi.spyOn(collection, "updateOne").mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_ERROR"));
      await expect(store.recordLocalCompletion(actor, operation, 1010)).rejects.toThrow("Deletion ledger unavailable");
      expect((await store.read(actor))?.signature).toBe(accepted.signature);
      failure.mockRestore();
      const completed = await store.recordLocalCompletion(actor, operation, 1020);
      expect(await store.recordLocalCompletion(actor, operation, 1030)).toEqual(completed);
      expect(await collection.countDocuments()).toBe(1);
      expect((await collection.findOne())!.accepted).toEqual(accepted);
    } finally { await fixture.dispose(); }
  });
});
