/** Object-storage evidence of the independent ledger, all write-once (Object Lock):
 * - Mirror (`ledger-mirror/`): the full rows under one head, signed with a **mirror key** that is separate from the ledger key
 *   (the app holds the ledger key; only the backup worker and restore operators hold the mirror key), so a leaked ledger key
 *   cannot forge a "complete" export.
 * - Journal (`ledger-journal/`): mirror-on-accept. Every ledger write (acceptance, completion) is journaled with its revision
 *   before the erasure protocol continues. Entries carry rows whose receipts are individually signed with the ledger key; an
 *   entry can only add suppression, never remove it.
 * Readers validate everything and fail closed on anything they cannot verify; nothing unverifiable is skipped.
 */
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BSON } from "mongodb";
import type { BackupObjectStore } from "@/lib/operations/backup-capture";
import type { LedgerEnvironment, LedgerKey } from "@/lib/operations/deletion-ledger";
import { validateLedgerRow, type DeletionLedgerRow, type LedgerExport } from "@/lib/operations/deletion-receipt-store";

const mirrorPrefix = "ledger-mirror/"; const journalPrefix = "ledger-journal/";
const fail = (): never => { throw new Error("Ledger mirror requires review"); };
const rowDigest = (row: DeletionLedgerRow) => [row._id, row.revision, row.current.signature, row.accepted.signature];
const seal = (key: LedgerKey, environment: LedgerEnvironment, head: number, exportedAt: number, rows: readonly DeletionLedgerRow[]) =>
  createHmac("sha256", key.material).update(JSON.stringify(["ledger-mirror-v2", environment, key.version, head, exportedAt, rows.map(rowDigest)])).digest("hex");
const objectName = (prefix: string, number: number, bytes: Uint8Array) =>
  `${prefix}${String(number).padStart(12, "0")}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.bson`;
/** Plain rows (driver documents may carry prototypes); only the four row fields are kept. */
const plainRow = (row: DeletionLedgerRow): DeletionLedgerRow => ({ _id: row._id, current: row.current, accepted: row.accepted, revision: row.revision });

/** The mirror key must never be (a copy of) a ledger key: otherwise a ledger-key holder could sign a forged export. */
export function assertSeparateMirrorKeys(ledgerKeys: readonly LedgerKey[], mirrorKeys: readonly LedgerKey[]) {
  if (mirrorKeys.length === 0) return fail();
  for (const mirror of mirrorKeys) for (const ledger of ledgerKeys) {
    if (mirror.material.length === ledger.material.length && timingSafeEqual(Buffer.from(mirror.material), Buffer.from(ledger.material))) fail();
  }
}

export async function mirrorLedger(input: Readonly<{ ledger: Readonly<{ export: () => Promise<LedgerExport> }>; store: BackupObjectStore;
  environment: LedgerEnvironment; key: LedgerKey }>): Promise<Readonly<{ name: string; head: number }>> {
  const snapshot = await input.ledger.export();
  const rows = snapshot.rows.map(plainRow);
  const document = { version: "ledger-mirror-v2", environment: input.environment, keyVersion: input.key.version, head: snapshot.head,
    exportedAt: snapshot.readAt, rows, signature: seal(input.key, input.environment, snapshot.head, snapshot.readAt, rows) };
  const bytes = BSON.serialize(document);
  const name = objectName(mirrorPrefix, snapshot.head, bytes);
  await input.store.putOnce(name, bytes);
  return { name, head: snapshot.head };
}

export type VerifiedMirror = Readonly<{ name: string; head: number; exportedAt: number; rows: readonly DeletionLedgerRow[] }>;

/** Every mirror export, verified (mirror-key signature, environment, each row against the ledger keys), sorted by head.
 * Any unverifiable export fails closed rather than being skipped. */
export async function verifiedMirrors(store: BackupObjectStore, environment: LedgerEnvironment, ledgerKeys: readonly LedgerKey[],
  mirrorKeys: readonly LedgerKey[]): Promise<readonly VerifiedMirror[]> {
  assertSeparateMirrorKeys(ledgerKeys, mirrorKeys);
  const mirrors: VerifiedMirror[] = [];
  for (const name of await store.list(mirrorPrefix)) {
    const bytes = await store.get(name) ?? fail();
    let document; try { document = BSON.deserialize(bytes); } catch { return fail(); }
    // Names are derived from content (head + digest): a renamed or rewritten object is evidence tampering.
    if (name !== objectName(mirrorPrefix, document.head, bytes)) return fail();
    const key = mirrorKeys.find(item => item.version === document.keyVersion) ?? fail();
    if (document.version !== "ledger-mirror-v2" || document.environment !== environment || !Number.isSafeInteger(document.head) || document.head < 0
      || !Number.isSafeInteger(document.exportedAt) || !Array.isArray(document.rows)) return fail();
    const rows = (document.rows as DeletionLedgerRow[]).map(row => { validateLedgerRow(row, environment, ledgerKeys); return plainRow(row); });
    if (new Set(rows.map(row => row._id)).size !== rows.length || rows.some(row => row.revision > document.head)) return fail();
    const expected = Buffer.from(seal(key, environment, document.head, document.exportedAt, rows), "hex");
    const actual = Buffer.from(typeof document.signature === "string" ? document.signature : "", "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail();
    mirrors.push({ name, head: document.head, exportedAt: document.exportedAt, rows });
  }
  return mirrors.sort((left, right) => left.head - right.head || left.exportedAt - right.exportedAt);
}

/** Mirror-on-accept: journal one ledger row at its revision. Deterministic bytes, so a retry of the same state is a no-op. */
export async function journalLedgerRow(input: Readonly<{ row: DeletionLedgerRow; store: BackupObjectStore; environment: LedgerEnvironment;
  ledgerKeys: readonly LedgerKey[] }>): Promise<string> {
  validateLedgerRow(input.row, input.environment, input.ledgerKeys);
  const bytes = BSON.serialize({ version: "ledger-journal-v1", environment: input.environment, revision: input.row.revision, row: plainRow(input.row) });
  const name = objectName(journalPrefix, input.row.revision, bytes);
  await input.store.putOnce(name, bytes);
  return name;
}

export type JournalEntry = Readonly<{ name: string; revision: number; row: DeletionLedgerRow }>;

/** Every journal entry, verified and sorted by revision. Two different entries for one revision fail closed. */
export async function verifiedJournal(store: BackupObjectStore, environment: LedgerEnvironment, ledgerKeys: readonly LedgerKey[]): Promise<readonly JournalEntry[]> {
  const entries = new Map<number, JournalEntry>();
  for (const name of await store.list(journalPrefix)) {
    const bytes = await store.get(name) ?? fail();
    let document; try { document = BSON.deserialize(bytes); } catch { return fail(); }
    if (document.version !== "ledger-journal-v1" || document.environment !== environment || !Number.isSafeInteger(document.revision)
      || document.revision < 1 || document.row?.revision !== document.revision || name !== objectName(journalPrefix, document.revision, bytes)) return fail();
    validateLedgerRow(document.row, environment, ledgerKeys);
    if (entries.has(document.revision)) return fail();
    entries.set(document.revision, { name, revision: document.revision, row: plainRow(document.row) });
  }
  return [...entries.values()].sort((left, right) => left.revision - right.revision);
}
