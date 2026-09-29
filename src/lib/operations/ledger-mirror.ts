/** Signed, write-once mirror of the independent ledger (B1 §2 "Mirror"). A ledger restored from its own backup or otherwise
 * rolled back ends up behind its newest mirror, and restore refuses it. Receipts in the mirror are individually signed already;
 * the export signature binds them to the head. Exports hold only minimal receipts (ADR-074/076), in object-locked storage.
 */
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BSON } from "mongodb";
import type { BackupObjectStore } from "@/lib/operations/backup-capture";
import { validateDeletionReceipt, type DeletionReceipt, type LedgerEnvironment, type LedgerKey } from "@/lib/operations/deletion-ledger";
import type { LedgerSnapshot } from "@/lib/operations/deletion-receipt-store";

const prefix = "ledger-mirror/";
const fail = (): never => { throw new Error("Ledger mirror requires review"); };
const seal = (key: LedgerKey, environment: LedgerEnvironment, head: number, exportedAt: number, receipts: readonly DeletionReceipt[]) =>
  createHmac("sha256", key.material).update(JSON.stringify(["ledger-mirror-v1", environment, key.version, head, exportedAt, receipts.map(r => r.signature)])).digest("hex");

export async function mirrorLedger(input: Readonly<{ ledger: Readonly<{ snapshot: () => Promise<LedgerSnapshot> }>; store: BackupObjectStore;
  environment: LedgerEnvironment; key: LedgerKey }>): Promise<Readonly<{ name: string; head: number }>> {
  const snapshot = await input.ledger.snapshot();
  const document = { version: "ledger-mirror-v1", environment: input.environment, keyVersion: input.key.version, head: snapshot.head,
    exportedAt: snapshot.readAt, receipts: snapshot.receipts, signature: seal(input.key, input.environment, snapshot.head, snapshot.readAt, snapshot.receipts) };
  const bytes = BSON.serialize(document);
  const name = `${prefix}${String(snapshot.head).padStart(12, "0")}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.bson`;
  await input.store.putOnce(name, bytes);
  return { name, head: snapshot.head };
}

/** Highest head among verified mirror exports (0 when none). Any unverifiable export fails closed rather than being skipped. */
export async function highestMirroredHead(store: BackupObjectStore, environment: LedgerEnvironment, keys: readonly LedgerKey[]): Promise<number> {
  let highest = 0;
  for (const name of await store.list(prefix)) {
    const bytes = await store.get(name) ?? fail();
    let document; try { document = BSON.deserialize(bytes); } catch { return fail(); }
    const key = keys.find(item => item.version === document.keyVersion) ?? fail();
    if (document.version !== "ledger-mirror-v1" || document.environment !== environment || !Number.isSafeInteger(document.head) || document.head < 0
      || !Array.isArray(document.receipts)) return fail();
    const receipts = document.receipts.map((receipt: unknown) => validateDeletionReceipt(receipt, environment, keys));
    const expected = Buffer.from(seal(key, environment, document.head, document.exportedAt, receipts), "hex");
    const actual = Buffer.from(typeof document.signature === "string" ? document.signature : "", "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail();
    highest = Math.max(highest, document.head);
  }
  return highest;
}
