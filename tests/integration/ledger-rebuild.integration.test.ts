import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BSON, ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wormObjectStore } from "../helpers/worm-object-store";
import type { Actor } from "@/lib/auth/actor";
import { DeletionReceiptStore, type DeletionLedgerRow } from "@/lib/operations/deletion-receipt-store";
import { runLedgerFirstErasure } from "@/lib/operations/erasure-protocol";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { journalLedgerRow, mirrorLedger } from "@/lib/operations/ledger-mirror";
import { planLedgerRebuild, rebuildLedger } from "@/lib/operations/ledger-rebuild";
import { directoryObjectStore, listedDirectoryObjectStore } from "@/lib/operations/object-stores";

// Synthetic ledger on a local single-node replica set only (the ledger needs transactions and snapshot sessions).
const replica = process.env.MONGODB_TEST_REPLICA_URI;
const ledgerKey = { version: 1, material: randomBytes(32) }; const mirrorKey = { version: 1, material: randomBytes(32) };
const alias = (value: string) => createHash("sha256").update(value).digest("hex");
type Target = Awaited<ReturnType<typeof createIsolatedRecoveryTarget>>;
type Store = ReturnType<typeof wormObjectStore>;
const user = (): Actor => ({ kind: "user", userId: new ObjectId().toHexString() });
const clone = (store: Store, drop: (name: string) => boolean = () => false) => {
  const copy = wormObjectStore();
  for (const [name, bytes] of store.objects) if (!drop(name)) copy.objects.set(name, Uint8Array.from(bytes));
  return copy;
};
const names = (store: Store, prefix: string) => [...store.objects.keys()].filter(name => name.startsWith(prefix)).sort();
const revisionOf = (name: string) => Number(name.split("/")[1]!.split("-")[0]);
const digestRows = (rows: readonly DeletionLedgerRow[]) => rows.map(row => [row._id, row.revision, row.current.signature, row.accepted.signature]);

(replica ? describe : describe.skip)("Configuration B: mirror-on-accept journal and deterministic, fail-closed ledger rebuild", () => {
  const disposables: Target[] = [];
  afterEach(async () => { vi.restoreAllMocks(); while (disposables.length) await disposables.pop()!.dispose().catch(() => undefined); });
  const target = async () => { const created = await createIsolatedRecoveryTarget(replica!); disposables.push(created); return created; };

  async function history() {
    const ledgerDb = await target(); const store = wormObjectStore();
    const ledger = new DeletionReceiptStore(ledgerDb.database, "isolated-test", { active: ledgerKey, keys: [ledgerKey] });
    const journal = async (row: DeletionLedgerRow) => { await journalLedgerRow({ row, store, environment: "isolated-test", ledgerKeys: [ledgerKey] }); };
    const erase = (actor: Actor, verify = true, aliases: readonly string[] = []) => runLedgerFirstErasure(ledger, actor, randomUUID(), () => Date.now(),
      { providerSubjectAliases: async () => aliases, fence: async () => undefined, erase: async () => undefined, verify: async () => verify }, journal);
    const mirror = () => mirrorLedger({ ledger, store, environment: "isolated-test", key: mirrorKey });
    const input = (evidence: Store = store, overrides: Partial<Parameters<typeof planLedgerRebuild>[0]> = {}) =>
      ({ store: evidence, environment: "isolated-test" as const, ledgerKeys: [ledgerKey], mirrorKeys: [mirrorKey], ...overrides });
    const marked = user();
    await erase(user());                                   // revisions 1, 2
    await mirror();                                        // mirror at head 2
    await expect(erase(user(), false)).rejects.toThrow("Erasure verification failed"); // revision 3: suppressed, not completed
    await erase(marked, true, [alias("provider-subject")]);  // revisions 4, 5
    await mirror();                                        // mirror at head 5
    await erase(user());                                   // revisions 6, 7: journal only
    return { ledgerDb, ledger, store, journal, erase, mirror, input, marked };
  }

  it("journals every ledger write before the protocol continues, and rebuilds exactly the lost ledger from mirror + journal", async () => {
    const h = await history();
    expect(names(h.store, "ledger-journal/").map(revisionOf)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const original = await h.ledger.export();
    const plan = await planLedgerRebuild(h.input());
    expect(plan).toMatchObject({ head: 7, baseHead: 5, mirrors: 2, journalApplied: [6, 7] });
    expect(digestRows(plan.rows)).toEqual(digestRows(original.rows));
    expect((await planLedgerRebuild(h.input())).digest).toBe(plan.digest); // deterministic
    // The ledger is lost; the rebuild into a fresh database reproduces it and serves the same suppression.
    await h.ledgerDb.dispose();
    const fresh = await target(); await fresh.database.collection("recoveryQuarantine").drop(); // an empty database
    expect((await rebuildLedger({ ...h.input(), target: fresh.database })).digest).toBe(plan.digest);
    const rebuilt = new DeletionReceiptStore(fresh.database, "isolated-test", { active: ledgerKey, keys: [ledgerKey] });
    expect(digestRows((await rebuilt.export()).rows)).toEqual(digestRows(original.rows));
    expect((await rebuilt.snapshot()).head).toBe(7);
    expect(await rebuilt.isProviderSubjectErased(alias("provider-subject"))).toBe(true);
    expect((await rebuilt.read(h.marked))?.status).toBe("locally-erased");
    // The rebuilt ledger keeps working: the next write continues the revision sequence.
    await rebuilt.accept(user(), randomUUID(), Date.now());
    expect((await rebuilt.snapshot()).head).toBe(8);
    // An older mirror plus a contiguous journal proves the same state (e.g. a partial download missed the newest mirror).
    const olderOnly = clone(h.store, name => name === names(h.store, "ledger-mirror/")[1]);
    expect((await planLedgerRebuild(h.input(olderOnly))).digest).toBe(plan.digest);
    await expect(rebuildLedger({ ...h.input(), target: fresh.database })).rejects.toThrow("Ledger rebuild refused: target not empty");
  }, 60_000);

  it("[log-ledger-rebuild-output] the CLI's printed plan summary carries no receipt, subject, marker, user id or key", async () => {
    const h = await history(); const plan = await planLedgerRebuild(h.input());
    // Exactly the projection workers/ledger-rebuild/cli.ts prints (its keys are pinned by tests/unit/logging-sink-inventory.test.ts).
    const printed = JSON.stringify({ head: plan.head, rows: plan.rows.length, digest: plan.digest, baseMirror: plan.baseMirror, baseHead: plan.baseHead,
      mirrors: plan.mirrors, journalApplied: plan.journalApplied }, null, 2);
    const rows = (await h.ledger.export()).rows;
    expect(rows.length).toBeGreaterThan(0);
    const forbidden = [h.marked.userId, alias("provider-subject"), ...[ledgerKey, mirrorKey].flatMap(key => [Buffer.from(key.material).toString("hex"), Buffer.from(key.material).toString("base64")]),
      ...rows.flatMap(row => [row._id, ...[row.current, row.accepted].flatMap(receipt => [receipt.subject, receipt.signature, receipt.operationId, ...receipt.providerSubjects])])];
    for (const value of forbidden) expect(printed).not.toContain(value);
  }, 60_000);

  it("fails closed whenever completeness, ordering or continuity cannot be proven", async () => {
    const h = await history();
    const [firstMirror, newestMirror] = names(h.store, "ledger-mirror/");
    const journalAt = (revision: number) => names(h.store, "ledger-journal/").find(name => revisionOf(name) === revision)!;
    const refuse = (evidence: Store, reason: string, overrides: Partial<Parameters<typeof planLedgerRebuild>[0]> = {}) =>
      expect(planLedgerRebuild(h.input(evidence, overrides))).rejects.toThrow(`Ledger rebuild refused: ${reason}`);
    await refuse(clone(h.store, name => name.startsWith("ledger-mirror/")), "no mirror");
    // Continuity: a missing journal write after the newest mirror, or an older mirror whose later journal expired.
    await refuse(clone(h.store, name => name === journalAt(6)), "journal gap");
    await refuse(clone(h.store, name => name === newestMirror || name === journalAt(4)), "journal gap");
    // Forged, tampered or foreign evidence.
    const tampered = clone(h.store); const bytes = tampered.objects.get(newestMirror!)!; bytes[bytes.length - 12] = bytes[bytes.length - 12]! ^ 0xff;
    await refuse(tampered, "mirror unverifiable");
    const renamedMirror = clone(h.store, name => name === newestMirror); // a valid export stored under a name that is not its own
    renamedMirror.objects.set(`ledger-mirror/${String(5).padStart(12, "0")}-${"0".repeat(16)}.bson`, Uint8Array.from(h.store.objects.get(newestMirror!)!));
    await refuse(renamedMirror, "mirror unverifiable");
    const ledgerSigned = clone(h.store, name => name.startsWith("ledger-mirror/"));
    await mirrorLedger({ ledger: h.ledger, store: ledgerSigned, environment: "isolated-test", key: ledgerKey }); // signed with the ledger key
    await refuse(ledgerSigned, "mirror unverifiable");
    await refuse(h.store, "mirror unverifiable", { mirrorKeys: [ledgerKey] }); // a configured "mirror key" equal to a ledger key
    await refuse(h.store, "mirror unverifiable", { ledgerKeys: [ledgerKey, { version: 2, material: Uint8Array.from(mirrorKey.material) }] }); // ledger keyring holding the mirror key
    const foreignJournal = clone(h.store);
    const otherKey = { version: 1, material: randomBytes(32) };
    const other = new DeletionReceiptStore((await target()).database, "isolated-test", { active: otherKey, keys: [otherKey] });
    const stranger = user(); await other.accept(stranger, randomUUID(), Date.now());
    await journalLedgerRow({ row: (await other.journalRow(stranger))!, store: foreignJournal, environment: "isolated-test", ledgerKeys: [otherKey] });
    await refuse(foreignJournal, "journal unverifiable");
    // Two different entries for one revision.
    const doubled = clone(h.store); const entry = BSON.deserialize(doubled.objects.get(journalAt(7))!);
    const twin = BSON.serialize({ ...entry, extra: 1 }); // different bytes, same revision, correctly named
    doubled.objects.set(`ledger-journal/${String(7).padStart(12, "0")}-${createHash("sha256").update(twin).digest("hex").slice(0, 16)}.bson`, twin);
    // A valid entry copied under another name (renamed evidence).
    const renamed = clone(h.store); renamed.objects.set(`ledger-journal/${String(7).padStart(12, "0")}-${"f".repeat(16)}.bson`, renamed.objects.get(journalAt(7))!);
    renamed.objects.delete(journalAt(7));
    await refuse(renamed, "journal unverifiable");
    await refuse(doubled, "journal unverifiable");
    // A mirror-key holder cannot make a later export drop a receipt that an earlier export or the journal holds.
    const exported = await h.ledger.export();
    const dropped = { ...exported, rows: exported.rows.filter(row => row.revision !== 5), head: 50 };
    const forgedLater = clone(h.store);
    await mirrorLedger({ ledger: { export: async () => dropped }, store: forgedLater, environment: "isolated-test", key: mirrorKey });
    await refuse(forgedLater, "mirrors inconsistent");
    const forgedOnly = clone(h.store, name => name === firstMirror || name === newestMirror);
    await mirrorLedger({ ledger: { export: async () => ({ ...dropped, head: 7 }) }, store: forgedOnly, environment: "isolated-test", key: mirrorKey });
    await refuse(forgedOnly, "mirror incomplete");
    // A completion in the tail whose acceptance is in no evidence at all (forged base without it, acceptance entry missing).
    const orphan = clone(h.store, name => name === firstMirror || name === newestMirror || name === journalAt(6));
    await mirrorLedger({ ledger: { export: async () => ({ ...exported, rows: exported.rows.filter(row => row.revision <= 5), head: 6 }) }, store: orphan,
      environment: "isolated-test", key: mirrorKey });
    await refuse(orphan, "mirror incomplete");
    // A rolled-back mirror (a lower head with a row at a later revision than it claims) is itself invalid.
    const rolledBack = clone(h.store, name => name === firstMirror || name === newestMirror);
    await mirrorLedger({ ledger: { export: async () => ({ ...exported, head: 3 }) }, store: rolledBack, environment: "isolated-test", key: mirrorKey });
    await refuse(rolledBack, "mirror unverifiable");
    // A replayed acceptance with a forged later revision may not turn a completed erasure back into a pending one.
    const downgrade = clone(h.store); const accepted = BSON.deserialize(downgrade.objects.get(journalAt(6))!);
    const replay = BSON.serialize({ ...accepted, revision: 8, row: { ...accepted.row, revision: 8 } });
    downgrade.objects.set(`ledger-journal/${String(8).padStart(12, "0")}-${createHash("sha256").update(replay).digest("hex").slice(0, 16)}.bson`, replay);
    await refuse(downgrade, "journal conflict");
    // The evidence must reach an independent lower bound (the worker's LedgerHead metric).
    expect((await planLedgerRebuild(h.input(h.store, { minimumHead: 7 }))).head).toBe(7);
    await refuse(h.store, "evidence older than expected head", { minimumHead: 8 });
  }, 60_000);

  it("refuses a truncated local copy of the bucket: the copy must equal the authoritative listing", async () => {
    const h = await history(); const root = await mkdtemp(join(tmpdir(), "fos-rebuild-"));
    try {
      const copy = directoryObjectStore(root);
      for (const [name, bytes] of h.store.objects) await copy.putOnce(name, bytes);
      const listing = JSON.stringify({ Contents: [...h.store.objects.keys()].map(Key => ({ Key })) });
      const listed = () => listedDirectoryObjectStore(root, listing);
      expect((await planLedgerRebuild(h.input(listed() as Store))).head).toBe(7);
      // An interrupted sync lost the newest journal writes (revisions 6, 7: an erasure that started and completed).
      for (const name of names(h.store, "ledger-journal/").filter(item => revisionOf(item) >= 6)) await unlink(join(root, ...name.split("/")));
      // Without the listing the truncated copy would look complete (head 5) and drop a started erasure:
      expect((await planLedgerRebuild(h.input(copy as Store))).head).toBe(5);
      await expect(planLedgerRebuild(h.input(listed() as Store))).rejects.toThrow("Ledger rebuild refused: journal unverifiable");
      await expect(planLedgerRebuild(h.input(copy as Store, { minimumHead: 7 }))).rejects.toThrow("evidence older than expected head");
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  it("mirror-on-accept: without a durable journal write nothing local happens, and a retry closes the gap", async () => {
    const ledgerDb = await target(); const store = wormObjectStore();
    const ledger = new DeletionReceiptStore(ledgerDb.database, "isolated-test", { active: ledgerKey, keys: [ledgerKey] });
    const steps = { providerSubjectAliases: vi.fn(async () => []), fence: vi.fn(async () => undefined), erase: vi.fn(async () => undefined), verify: vi.fn(async () => true) };
    const actor = user(); const operation = randomUUID();
    const down = vi.fn(async () => { throw new Error("synthetic storage outage"); });
    await expect(runLedgerFirstErasure(ledger, actor, operation, () => Date.now(), steps, down)).rejects.toThrow("Erasure requires review: ledger journal unavailable");
    expect(steps.fence).not.toHaveBeenCalled(); expect(steps.erase).not.toHaveBeenCalled();
    expect((await ledger.read(actor))?.status).toBe("suppressed"); // durable suppression, but no local change
    const journal = async (row: DeletionLedgerRow) => { await journalLedgerRow({ row, store, environment: "isolated-test", ledgerKeys: [ledgerKey] }); };
    expect((await runLedgerFirstErasure(ledger, actor, operation, () => Date.now(), steps, journal)).status).toBe("locally-erased");
    expect(names(store, "ledger-journal/").map(revisionOf)).toEqual([1, 2]);
    // A completion whose journal write fails is recorded in the ledger and journaled on the next (idempotent) run.
    const second = user(); let calls = 0;
    const flaky = async (row: DeletionLedgerRow) => { if (++calls === 2) throw new Error("synthetic outage"); await journal(row); };
    await expect(runLedgerFirstErasure(ledger, second, randomUUID(), () => Date.now(), steps, flaky)).rejects.toThrow("ledger journal unavailable");
    expect(names(store, "ledger-journal/").map(revisionOf)).toEqual([1, 2, 3]);
    expect((await runLedgerFirstErasure(ledger, second, randomUUID(), () => Date.now(), steps, journal)).status).toBe("locally-erased");
    expect(names(store, "ledger-journal/").map(revisionOf)).toEqual([1, 2, 3, 4]);
    // Retrying with the same state writes nothing new (deterministic object names).
    await runLedgerFirstErasure(ledger, second, randomUUID(), () => Date.now(), steps, journal);
    expect(names(store, "ledger-journal/")).toHaveLength(4);
  }, 60_000);
});
