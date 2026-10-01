import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BSON, Collection, MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wormObjectStore } from "../helpers/worm-object-store";
import type { Actor } from "@/lib/auth/actor";
import { ConflictError } from "@/lib/errors/application-error";
import { money } from "@/lib/domain/money/money";
import type { ManualFields } from "@/lib/onboarding/manual-record";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import type { OpenBankingProvider } from "@/lib/open-banking/open-banking-provider";
import { claimConfiguredOpenBankingSubject } from "@/lib/open-banking/open-banking-service";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { captureBackup, decodeBackupPackage } from "@/lib/operations/backup-capture";
import { runBackupWorker } from "@/lib/operations/backup-worker";
import { directoryObjectStore } from "@/lib/operations/object-stores";
import { runRestoreDrill } from "@/lib/operations/restore-drill";
import { openBackupPackage } from "@/lib/operations/backup-package";
import { DeletionReceiptStore, type LedgerSnapshot } from "@/lib/operations/deletion-receipt-store";
import { runLedgerFirstErasure } from "@/lib/operations/erasure-protocol";
import { journalLedgerRow, mirrorLedger } from "@/lib/operations/ledger-mirror";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { releaseFence, restoreIntoQuarantine, verifyReleaseWatermark } from "@/lib/operations/restore-orchestration";

// Synthetic data on a local single-node replica set only (snapshot sessions and transactions need one).
const replica = process.env.MONGODB_TEST_REPLICA_URI; const standalone = process.env.MONGODB_TEST_URI;
const suite = replica ? describe : describe.skip;
const digest = "a".repeat(64); const packageKey = { version: 1, material: randomBytes(32) }; const ledgerKey = { version: 1, material: randomBytes(32) };
const mirrorKey = { version: 1, material: randomBytes(32) }; // separate from the ledger key (Configuration B)
const alias = (value: string) => createHash("sha256").update(value).digest("hex");
type Target = Awaited<ReturnType<typeof createIsolatedRecoveryTarget>>;

async function world(disposables: Target[]) {
  const target = async () => { const created = await createIsolatedRecoveryTarget(replica!); disposables.push(created); return created; };
  const app = await target(); const ledgerDb = await target();
  const ledger = new DeletionReceiptStore(ledgerDb.database, "isolated-test", { active: ledgerKey, keys: [ledgerKey] });
  const ensureIndexes = async (db: Db) => { await Promise.all([profileRepositoryForDatabase(db).ensureIndexes(), openBankingRepositoryForDatabase(db).ensureIndexes(),
    manualRecordRepositoryForDatabase(db, "accounts").ensureIndexes(), manualRecordRepositoryForDatabase(db, "transactions").ensureIndexes()]); };
  await ensureIndexes(app.database);
  const profiles = profileRepositoryForDatabase(app.database); const bank = openBankingRepositoryForDatabase(app.database);
  const accounts = manualRecordRepositoryForDatabase(app.database, "accounts"); const transactions = manualRecordRepositoryForDatabase(app.database, "transactions");
  const actors: Actor[] = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
  for (const actor of actors) {
    await app.database.collection("authUsers").insertOne({ _id: new ObjectId(actor.userId), name: "Synthetic", email: `${actor.userId}@example.invalid`, emailVerified: null, image: null });
    await saveProfile(actor, { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profiles });
    const account = await accounts.createForActor(actor, { balance: money(9007199254740993n, "ILS"), name: "Synthetic", type: "bank" } as ManualFields, randomUUID());
    await transactions.createForActor(actor, { accountId: account.id, amount: money(100n, "ILS"), category: "food", confidenceBps: 10_000, date: "2026-09-01",
      destinationAccountId: null, merchant: "Synthetic", notes: null, recurring: false, refundOfTransactionId: null, type: "expense" } as ManualFields, randomUUID());
    await bank.claimBinding(actor, alias(`subject:${actor.userId}`));
    const run = await bank.startSync(actor, randomUUID()); await bank.completeSync(actor, run.run.id, { accountObservationCount: 0, canonicalAccountCount: 0,
      canonicalTransactionCount: 0, connectionObservationCount: 0, transactionObservationCount: 0 });
    await bank.startSync(actor, randomUUID()); // interrupted: must be fenced by restore
  }
  const store = wormObjectStore();
  const ledgerInput = (overrides: Partial<{ snapshot: () => Promise<LedgerSnapshot>; now: () => number; maxLedgerAgeMs: number }> = {}) => ({
    ledger: { snapshot: overrides.snapshot ?? (() => ledger.snapshot()) }, environment: "isolated-test" as const, ledgerKeys: [ledgerKey], mirrorKeys: [mirrorKey], stateKey: ledgerKey, mirror: store,
    maxLedgerAgeMs: overrides.maxLedgerAgeMs ?? 60_000, now: overrides.now ?? (() => Date.now()) });
  const capture = (overrides: Partial<Parameters<typeof captureBackup>[0]> = {}) => captureBackup({ client: app.database.client, databaseName: app.database.databaseName,
    schemas: initialRecoverySchemas, indexManifestDigest: digest, key: packageKey, ledgerHead: async () => (await ledger.snapshot()).head, store,
    now: () => Date.now(), maxDurationMs: 60_000, ...overrides });
  const restore = async (name: string, overrides: Parameters<typeof ledgerInput>[0] = {}, into?: Target) => {
    // As in the worker, a signed ledger mirror exists before any restore (restore refuses a store without one).
    if ((await store.list("ledger-mirror/")).length === 0) await mirrorLedger({ ledger, store, environment: "isolated-test", key: mirrorKey });
    const fresh = into ?? await target();
    return { target: fresh, result: await restoreIntoQuarantine({ ...ledgerInput(overrides), store, name, schemas: initialRecoverySchemas, indexManifestDigest: digest,
      packageKey, target: fresh.database, ensureIndexes }) };
  };
  // Mirror-on-accept journal into the same write-once store as the mirrors and packages.
  const journal = async (row: Parameters<typeof journalLedgerRow>[0]["row"]) => { await journalLedgerRow({ row, store, environment: "isolated-test", ledgerKeys: [ledgerKey] }); };
  const erase = (actor: Actor, verify = true) => runLedgerFirstErasure(ledger, actor, randomUUID(), () => Date.now(), {
    providerSubjectAliases: async () => [alias(`subject:${actor.userId}`)], fence: async () => undefined,
    erase: async () => {
      for (const name of recoveryCollections) await app.database.collection(name).deleteMany({ userId: new ObjectId(actor.userId) });
      await app.database.collection("authUsers").deleteMany({ _id: new ObjectId(actor.userId) });
    },
    verify: async () => verify && (await Promise.all(recoveryCollections.map(name => app.database.collection(name).countDocuments({ userId: new ObjectId(actor.userId) }))))
      .every(count => count === 0) }, journal);
  return { app, ledgerDb, ledger, store, actors, capture, restore, ledgerInput, erase, target, ensureIndexes, journal };
}
const rowsOf = async (db: Db, name: string) => db.collection(name).find().sort({ _id: 1 }).toArray();

suite("A+B local rehearsal: snapshot capture, ledger-first erasure, quarantine restore and release fence", () => {
  const disposables: Target[] = [];
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); while (disposables.length) await disposables.pop()!.dispose().catch(() => undefined); });

  it("restores a backup older than a deletion without the erased owner and releases only through the fence", async () => {
    const w = await world(disposables);
    const survivorAccounts = (await rowsOf(w.app.database, "accounts")).filter(row => row.userId.toHexString() === w.actors[1]!.userId);
    const captured = await w.capture();
    const manifest = decodeBackupPackage((await w.store.get(captured.name))!).manifest;
    expect(manifest).toMatchObject({ source: "snapshot-capture", releaseAllowed: false, recoveryPoint: { atClusterTime: captured.atClusterTime, ledgerHead: 0 } });
    expect(manifest.excluded).toEqual(expect.arrayContaining(["authSessions", "authVerificationTokens", "bankDevelopmentArchive"]));
    // Deletion happens AFTER the capture: the package still contains the owner.
    expect((await w.erase(w.actors[0]!)).status).toBe("locally-erased");
    expect((await w.ledger.snapshot()).head).toBe(2);
    const { target, result } = await w.restore(captured.name);
    expect(result.ledgerHead).toBe(2);
    for (const name of ["profiles", "accounts", "transactions", "bankProviderBindings", "bankSyncRuns"])
      expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(w.actors[0]!.userId) })).toBe(0);
    expect(BSON.serialize({ rows: await rowsOf(target.database, "accounts") })).toEqual(BSON.serialize({ rows: survivorAccounts }));
    expect(await target.database.collection("bankSyncRuns").countDocuments({ status: "running", recoveryQuarantinedAt: { $exists: true } })).toBe(1);
    await expect(verifyReleaseWatermark({ ...w.ledgerInput(), target: target.database })).rejects.toThrow("restore watermark missing");
    expect(await releaseFence({ ...w.ledgerInput(), target: target.database })).toEqual({ technicalChecksPassed: true, watermark: 2, releaseAllowed: false });
    expect(await verifyReleaseWatermark({ ...w.ledgerInput(), target: target.database })).toEqual({ watermark: 2, head: 2, delta: 0 });
    await expect(releaseFence({ ...w.ledgerInput(), target: target.database })).rejects.toThrow("restore incomplete");
    // After release, excluded collections are live state (new sessions) but are still scanned for erased subjects.
    const session = (userId: string) => ({ _id: new ObjectId(), sessionToken: randomBytes(16).toString("hex"), userId: new ObjectId(userId), expires: new Date(Date.now() + 60_000) });
    await target.database.collection("authSessions").insertOne(session(w.actors[1]!.userId));
    expect(await verifyReleaseWatermark({ ...w.ledgerInput(), target: target.database })).toEqual({ watermark: 2, head: 2, delta: 0 });
    const resurrected = await target.database.collection("authSessions").insertOne(session(w.actors[0]!.userId));
    await expect(verifyReleaseWatermark({ ...w.ledgerInput(), target: target.database })).rejects.toThrow("erased subject still referenced");
    await target.database.collection("authSessions").deleteOne({ _id: resurrected.insertedId });
    // A deletion accepted after release but not yet applied locally is caught by watermark verification (ledger-first reconciler).
    await w.ledger.accept(w.actors[1]!, randomUUID(), Date.now());
    await expect(verifyReleaseWatermark({ ...w.ledgerInput(), target: target.database })).rejects.toThrow("erased subject still referenced");
  }, 60_000);

  it("fails closed on an unavailable, stale, rolled-back or advancing ledger and on tampered or incomplete state", async () => {
    const w = await world(disposables);
    await w.erase(w.actors[0]!);
    const captured = await w.capture(); // recovery point ledgerHead = 2
    const real = () => w.ledger.snapshot();
    await expect(w.restore(captured.name, { snapshot: async () => { throw new Error("synthetic outage"); } })).rejects.toThrow("ledger unavailable");
    // The backup recorded ledger head 2: a ledger now at 1 (with or without its receipts) was rolled back behind the backup.
    await expect(w.restore(captured.name, { snapshot: async () => ({ ...(await real()), head: 1 }) })).rejects.toThrow("ledger older than backup");
    await expect(w.restore(captured.name, { snapshot: async () => { const s = await real(); return { receipts: [], head: 1, readAt: s.readAt }; } }))
      .rejects.toThrow("ledger older than backup");
    await expect(w.restore(captured.name, { now: () => Date.now() + 120_000 })).rejects.toThrow("ledger stale or invalid");
    await mirrorLedger({ ledger: w.ledger, store: w.store, environment: "isolated-test", key: mirrorKey }); // head 2
    await w.ledger.accept({ kind: "user", userId: new ObjectId().toHexString() }, randomUUID(), Date.now());
    await mirrorLedger({ ledger: w.ledger, store: w.store, environment: "isolated-test", key: mirrorKey }); // head 3
    await expect(w.restore(captured.name, { snapshot: async () => ({ ...(await real()), head: 2 }) })).rejects.toThrow("ledger older than its mirror");
    const mirrorName = (await w.store.list("ledger-mirror/"))[0]!; const mirrorBytes = (await w.store.get(mirrorName))!;
    mirrorBytes[mirrorBytes.length - 10] = mirrorBytes[mirrorBytes.length - 10]! ^ 0xff; w.store.objects.set("ledger-mirror/999999999999-tampered.bson", mirrorBytes);
    await expect(w.restore(captured.name)).rejects.toThrow("ledger mirror unverifiable");
    w.store.objects.delete("ledger-mirror/999999999999-tampered.bson");
    // A well-formed export claiming a higher head without a valid signature is refused too (only the signature can tell).
    const genuine = BSON.deserialize((await w.store.get(mirrorName))!);
    w.store.objects.set("ledger-mirror/999999999999-forged.bson", BSON.serialize({ ...genuine, head: 99 }));
    await expect(w.restore(captured.name)).rejects.toThrow("ledger mirror unverifiable");
    w.store.objects.delete("ledger-mirror/999999999999-forged.bson");
    // A receipt deleted from the live ledger without lowering its head is caught against the mirrored receipts.
    const mirroredReceipts = (await real()).receipts;
    await expect(w.restore(captured.name, { snapshot: async () => ({ ...(await real()), receipts: mirroredReceipts.slice(1) }) }))
      .rejects.toThrow("ledger missing mirrored receipts");
    // (Stripping a receipt's markers instead breaks its signature and is refused earlier as an invalid ledger.)
    const noMirror = await w.target();
    await expect(restoreIntoQuarantine({ ...w.ledgerInput(), mirror: wormObjectStore(), store: w.store, name: captured.name, schemas: initialRecoverySchemas,
      indexManifestDigest: digest, packageKey, target: noMirror.database, ensureIndexes: w.ensureIndexes })).rejects.toThrow("ledger mirror missing");
    // Tampered package bytes in storage.
    const bytes = (await w.store.get(captured.name))!; bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 0xff; w.store.objects.set("packages/tampered.bson", bytes);
    await expect(w.restore("packages/tampered.bson")).rejects.toThrow("package invalid");
    // Ledger advanced between restore and fence.
    const advanced = await w.restore(captured.name);
    await w.ledger.accept({ kind: "user", userId: new ObjectId().toHexString() }, randomUUID(), Date.now());
    await expect(releaseFence({ ...w.ledgerInput(), target: advanced.target.database })).rejects.toThrow("ledger advanced since restore");
    // Rollback after release, and residual erased references / unfenced commands found by the fence scan.
    const released = await w.restore(captured.name); await releaseFence({ ...w.ledgerInput(), target: released.target.database });
    await expect(verifyReleaseWatermark({ ...w.ledgerInput({ snapshot: async () => ({ ...(await real()), head: 2 }) }), target: released.target.database }))
      .rejects.toThrow("ledger rolled back");
    // The release state is signed: forging it in the target is detected by both the fence and watermark verification.
    const forged = await w.restore(captured.name);
    await forged.target.database.collection("recoveryQuarantine").updateOne({ _id: "release" as never }, { $set: { state: "fenced", watermark: 3 } });
    await expect(verifyReleaseWatermark({ ...w.ledgerInput(), target: forged.target.database })).rejects.toThrow("release state tampered");
    await expect(releaseFence({ ...w.ledgerInput(), target: forged.target.database })).rejects.toThrow("release state tampered");
    const residual = await w.restore(captured.name);
    await residual.target.database.collection("accounts").updateOne({}, { $set: { "fields.name": w.actors[0]!.userId } });
    await expect(releaseFence({ ...w.ledgerInput(), target: residual.target.database })).rejects.toThrow("erased subject still referenced");
    // At the fence, excluded collections may exist (recreated indexes) but must be empty: nothing excluded may ride along a restore.
    const smuggled = await w.restore(captured.name);
    await smuggled.target.database.collection("authSessions").insertOne({ sessionToken: "synthetic", userId: new ObjectId(w.actors[1]!.userId), expires: new Date() });
    await expect(releaseFence({ ...w.ledgerInput(), target: smuggled.target.database })).rejects.toThrow("excluded collection not empty");
    const unfenced = await w.restore(captured.name);
    await unfenced.target.database.collection("bankSyncRuns").updateOne({ status: "running" }, { $unset: { recoveryQuarantinedAt: "" } });
    await expect(releaseFence({ ...w.ledgerInput(), target: unfenced.target.database })).rejects.toThrow("unfenced provider command");
    // The ledger advances between the fence's two reads: the fence refuses instead of writing a stale watermark.
    const racing = await w.restore(captured.name); let reads = 0;
    await expect(releaseFence({ ...w.ledgerInput({ snapshot: async () => { const s = await real(); return ++reads === 1 ? s : { ...s, head: s.head + 1 }; } }),
      target: racing.target.database })).rejects.toThrow("ledger advanced during fence");
    expect((await racing.target.database.collection("recoveryQuarantine").findOne({ _id: "release" as never }))?.state).toBe("restored");
    const changed = await w.restore(captured.name);
    await changed.target.database.collection("profiles").deleteMany({});
    await expect(releaseFence({ ...w.ledgerInput(), target: changed.target.database })).rejects.toThrow("restored counts changed");
    // Journaled writes newer than every mirror: a live ledger behind them, or missing their receipt, is refused.
    await w.erase(w.actors[1]!);
    const journaled = await real();
    await expect(w.restore(captured.name, { snapshot: async () => ({ ...journaled, head: journaled.head - 1 }) })).rejects.toThrow("ledger older than its journal");
    const newest = journaled.receipts.reduce((latest, receipt) => (receipt.acceptedAt > latest.acceptedAt ? receipt : latest));
    await expect(w.restore(captured.name, { snapshot: async () => ({ ...journaled, receipts: journaled.receipts.filter(receipt => receipt !== newest) }) }))
      .rejects.toThrow("ledger missing mirrored receipts");
  }, 60_000);

  it("never leaves a usable partial capture or restore, and retries start clean", async () => {
    const w = await world(disposables);
    await expect(w.capture({ store: { putOnce: async () => { throw new Error("synthetic storage timeout"); }, get: async () => null, list: async () => [] } })).rejects.toThrow("Backup capture failed closed: storage");
    const withoutProfiles = { ...initialRecoverySchemas }; delete withoutProfiles.profiles;
    await expect(w.capture({ schemas: withoutProfiles })).rejects.toThrow("Backup capture failed closed: package: profiles: no reviewed adapter");
    let tick = Date.now(); await expect(w.capture({ now: () => (tick += 61_000), maxDurationMs: 60_000 })).rejects.toThrow("Backup capture failed closed: duration exceeded");
    expect(w.store.objects.size).toBe(0);
    await w.app.database.createCollection("unreviewedCollection");
    await expect(w.capture()).rejects.toThrow("Backup capture failed closed: unreviewed collections: unreviewedCollection");
    await w.app.database.collection("unreviewedCollection").drop();
    if (standalone) {
      // A server without snapshot sessions cannot guarantee cross-collection consistency: capture refuses.
      const plain = await createIsolatedRecoveryTarget(standalone); disposables.push(plain);
      await expect(captureBackup({ client: plain.database.client, databaseName: plain.database.databaseName, schemas: initialRecoverySchemas, indexManifestDigest: digest,
        key: packageKey, ledgerHead: async () => 0, store: w.store, now: () => Date.now(), maxDurationMs: 60_000 })).rejects.toThrow(/^Backup capture failed closed: (snapshot pin \(\w+\)|no snapshot time)$/);
    }
    const captured = await w.capture(); expect(w.store.objects.size).toBe(1);
    // Retrying the identical upload is idempotent; a different object under the same name is refused (object lock).
    await w.store.putOnce(captured.name, (await w.store.get(captured.name))!);
    await expect(w.store.putOnce(captured.name, new Uint8Array([1]))).rejects.toThrow("Object is locked");
    // Interrupted restore: the second collection insert fails.
    let inserts = 0; const original = Collection.prototype.insertMany;
    vi.spyOn(Collection.prototype, "insertMany").mockImplementation(function (this: Collection, ...args: Parameters<typeof original>) {
      if (++inserts === 2) return Promise.reject(new Error("synthetic restore crash")); return original.apply(this, args) as never; });
    const interrupted = await w.target();
    await expect(w.restore(captured.name, {}, interrupted)).rejects.toThrow("synthetic restore crash");
    vi.restoreAllMocks();
    await expect(releaseFence({ ...w.ledgerInput(), target: interrupted.database })).rejects.toThrow("restore incomplete");
    await expect(w.restore(captured.name, {}, interrupted)).rejects.toThrow("target is not fresh");
    const retried = await w.restore(captured.name);
    expect((await releaseFence({ ...w.ledgerInput(), target: retried.target.database })).technicalChecksPassed).toBe(true);
  }, 60_000);

  it("captures a consistent cross-collection snapshot while transactional writes continue", async () => {
    const w = await world(disposables);
    const [account] = await rowsOf(w.app.database, "accounts"); const [transaction] = await rowsOf(w.app.database, "transactions");
    let stop = false; let pairs = 0; const client = w.app.database.client;
    const writer = (async () => {
      while (!stop) {
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            const accountId = new ObjectId();
            await w.app.database.collection("accounts").insertOne({ ...account, _id: accountId, idempotencyKeyHash: randomBytes(32).toString("hex") }, { session });
            await w.app.database.collection("transactions").insertOne({ ...transaction, _id: new ObjectId(), idempotencyKeyHash: randomBytes(32).toString("hex"),
              fields: { ...transaction!.fields, accountId: accountId.toHexString() } }, { session });
          });
          pairs++;
        } finally { await session.endSession(); }
      }
    })();
    await new Promise(resolve => setTimeout(resolve, 150));
    const captures = [await w.capture(), await w.capture(), await w.capture()];
    stop = true; await writer;
    expect(pairs).toBeGreaterThan(0);
    for (const captured of captures) {
      const opened = openBackupPackage(decodeBackupPackage((await w.store.get(captured.name))!), initialRecoverySchemas, digest, packageKey);
      const accountIds = new Set(opened.accounts!.map(row => row._id.toHexString()));
      // Every transaction's account is in the same capture, and pairs are never split.
      expect(opened.transactions!.every(row => accountIds.has(row.fields.accountId))).toBe(true);
      expect(opened.accounts!.length).toBe(opened.transactions!.length);
    }
  }, 60_000);

  it("orders erasure ledger-first, resumes after a crash, and refuses to rebind an erased provider subject", async () => {
    const w = await world(disposables);
    const steps = { providerSubjectAliases: vi.fn(async () => ["c".repeat(64)]), fence: vi.fn(async () => undefined), erase: vi.fn(async () => undefined), verify: vi.fn(async () => false) };
    const actor = w.actors[0]!; const operation = randomUUID();
    // Verification fails: suppression is durable but completion is never recorded.
    await expect(runLedgerFirstErasure(w.ledger, actor, operation, () => Date.now(), steps, w.journal)).rejects.toThrow("Erasure verification failed");
    expect((await w.ledger.read(actor))?.status).toBe("suppressed");
    steps.verify.mockResolvedValue(true);
    expect((await runLedgerFirstErasure(w.ledger, actor, operation, () => Date.now(), steps, w.journal)).status).toBe("locally-erased");
    // The retry reused the stored receipt: aliases were read once for acceptance and once per post-fence check, never re-sealed.
    expect(steps.providerSubjectAliases).toHaveBeenCalledTimes(3);
    expect((await w.ledger.read(actor))?.providerSubjects).toHaveLength(1);
    // A retry that lost its operation ID resumes the stored operation instead of stranding a suppressed, unerased subject.
    expect((await runLedgerFirstErasure(w.ledger, actor, randomUUID(), () => Date.now(), steps, w.journal)).operationId).toBe(operation);
    // A binding claimed between the alias read and the fence is unmarked: nothing is erased.
    const raced = w.actors[1]!; let reads = 0;
    const racing = { providerSubjectAliases: vi.fn(async () => (++reads === 1 ? [] : ["e".repeat(64)])), fence: vi.fn(async () => undefined),
      erase: vi.fn(async () => undefined), verify: vi.fn(async () => true) };
    await expect(runLedgerFirstErasure(w.ledger, raced, randomUUID(), () => Date.now(), racing, w.journal)).rejects.toThrow("Erasure requires review: provider subject not marked");
    expect(racing.erase).not.toHaveBeenCalled(); expect((await w.ledger.read(raced))?.status).toBe("suppressed");
    // Ledger reachable for reads but the durable accept fails: still nothing local happens (ledger-first).
    const failingAccept = { read: async () => null, accept: async () => { throw new Error("Deletion ledger unavailable"); }, recordLocalCompletion: vi.fn(), journalRow: vi.fn(),
      isProviderSubjectErased: vi.fn() };
    const blocked = { providerSubjectAliases: vi.fn(async () => []), fence: vi.fn(), erase: vi.fn(), verify: vi.fn() };
    await expect(runLedgerFirstErasure(failingAccept, w.actors[1]!, randomUUID(), () => Date.now(), blocked, w.journal)).rejects.toThrow("Deletion ledger unavailable");
    expect(blocked.fence).not.toHaveBeenCalled(); expect(blocked.erase).not.toHaveBeenCalled(); expect(failingAccept.recordLocalCompletion).not.toHaveBeenCalled();
    // Ledger unavailable: nothing local happens.
    const closed = await w.target(); const offline = new DeletionReceiptStore(closed.database, "isolated-test", { active: ledgerKey, keys: [ledgerKey] }); await closed.dispose();
    const untouched = { providerSubjectAliases: vi.fn(async () => []), fence: vi.fn(), erase: vi.fn(), verify: vi.fn() };
    await expect(runLedgerFirstErasure(offline, { kind: "user", userId: new ObjectId().toHexString() }, randomUUID(), () => Date.now(), untouched, w.journal)).rejects.toThrow("Deletion ledger unavailable");
    expect(untouched.fence).not.toHaveBeenCalled(); expect(untouched.erase).not.toHaveBeenCalled();

    // Anti-resurrection through the real claim path.
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUTH_SECRET", "synthetic-recovery-secret-at-least-32-characters");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "synthetic-client"); vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "synthetic-secret"); vi.stubEnv("OPEN_FINANCE_USER_ID", "synthetic-subject");
    const provider = { listConnections: async () => [{ expiryDate: null, externalId: "c", lastFetchedAt: null, lastFetchedDataDate: null, mode: null,
      providerExternalId: "p", status: "ACTIVE", subjectExternalId: "synthetic-subject" }] } as unknown as OpenBankingProvider;
    const claimDb = await w.target(); const repository = openBankingRepositoryForDatabase(claimDb.database); await repository.ensureIndexes();
    const original: Actor = { kind: "user", userId: new ObjectId().toHexString() }; const newcomer: Actor = { kind: "user", userId: new ObjectId().toHexString() };
    await claimConfiguredOpenBankingSubject(original, { provider, repository });
    const subjectAlias = (await claimDb.database.collection("bankProviderBindings").findOne())!.subjectAlias as string;
    await runLedgerFirstErasure(w.ledger, original, randomUUID(), () => Date.now(), { providerSubjectAliases: async () => [subjectAlias], fence: async () => undefined,
      erase: async () => { await claimDb.database.collection("bankProviderBindings").deleteMany({ userId: new ObjectId(original.userId) }); }, verify: async () => true }, w.journal);
    const guard = (store: DeletionReceiptStore) => (value: string) => store.isProviderSubjectErased(value);
    await expect(claimConfiguredOpenBankingSubject(newcomer, { provider, repository, erasedProviderSubject: guard(w.ledger) })).rejects.toBeInstanceOf(ConflictError);
    await expect(claimConfiguredOpenBankingSubject(newcomer, { provider, repository, erasedProviderSubject: guard(offline) })).rejects.toThrow("Deletion ledger unavailable");
    expect(await claimDb.database.collection("bankProviderBindings").countDocuments()).toBe(0);
    // An erasure completing between the pre-claim check and the claim is caught by the post-claim check and undone.
    let checks = 0;
    await expect(claimConfiguredOpenBankingSubject(newcomer, { provider, repository, erasedProviderSubject: async () => ++checks > 1 })).rejects.toBeInstanceOf(ConflictError);
    expect(checks).toBe(2); expect(await claimDb.database.collection("bankProviderBindings").countDocuments()).toBe(0);
    // Control: without the guard the erased subject would be bound again (the resurrection this prevents).
    await claimConfiguredOpenBankingSubject(newcomer, { provider, repository });
    expect(await claimDb.database.collection("bankProviderBindings").countDocuments({ subjectAlias })).toBe(1);
  }, 60_000);
  it("[log-restore-drill-output] runs the backup worker into a create-only store and restores its newest package through the drill with the fence passing", async () => {
    const w = await world(disposables); const root = await mkdtemp(join(tmpdir(), "fos-drill-"));
    try {
      const store = directoryObjectStore(root); const recordSuccess = vi.fn(async () => undefined); const opened: MongoClient[] = [];
      const secrets = { FINANCIAL_OS_BACKUP_APP_DB_URI: replica, FINANCIAL_OS_LEDGER_READ_URI: replica,
        FINANCIAL_OS_RECOVERY_PACKAGE_KEY_V1: Buffer.from(packageKey.material).toString("base64"), FINANCIAL_OS_RECOVERY_PACKAGE_KEY_ACTIVE_VERSION: "1",
        FINANCIAL_OS_DELETION_LEDGER_KEY_V1: Buffer.from(ledgerKey.material).toString("base64"), FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION: "1",
        FINANCIAL_OS_LEDGER_MIRROR_KEY_V1: Buffer.from(mirrorKey.material).toString("base64"), FINANCIAL_OS_LEDGER_MIRROR_KEY_ACTIVE_VERSION: "1" };
      const worker = (overrides: Partial<Parameters<typeof runBackupWorker>[0]> = {}) => runBackupWorker({ secrets, environment: "isolated-test",
        appDatabase: w.app.database.databaseName, ledgerDatabase: w.ledgerDb.database.databaseName, indexManifestDigest: digest,
        connect: async uri => { const client = await new MongoClient(uri).connect(); opened.push(client); return client; },
        store, recordSuccess, now: () => Date.now(), maxDurationMs: 60_000, ...overrides });
      const first = await worker();
      expect(first).toMatchObject({ ledgerHead: 0 }); expect(recordSuccess).toHaveBeenCalledTimes(1); expect(recordSuccess).toHaveBeenCalledWith({ ledgerHead: 0, primaryLogicalBytes: expect.any(Number), ledgerLogicalBytes: expect.any(Number) });
      // M0 capacity early warning: data + index sizes measured read-only from both clusters (the app database holds synthetic data).
      const [{ primaryLogicalBytes, ledgerLogicalBytes }] = recordSuccess.mock.calls[0] as unknown as [{ primaryLogicalBytes: number; ledgerLogicalBytes: number }];
      const appStats = await w.app.database.stats(); expect(primaryLogicalBytes).toBe(appStats.dataSize + appStats.indexSize); expect(primaryLogicalBytes).toBeGreaterThan(0);
      const ledgerStats = await w.ledgerDb.database.stats(); expect(ledgerLogicalBytes).toBe(ledgerStats.dataSize + ledgerStats.indexSize);
      expect([await store.list("packages/"), await store.list("ledger-mirror/")]).toEqual([[first.package], [first.mirror]]);
      // Every client the worker opened is closed again.
      await expect(opened[0]!.db("admin").command({ ping: 1 })).rejects.toThrow();
      // The owner is erased after the newest capture: the drill restores that package without them and the fence passes.
      await w.erase(w.actors[0]!); const second = await worker(); expect(second.ledgerHead).toBe(2); expect(recordSuccess).toHaveBeenLastCalledWith(expect.objectContaining({ ledgerHead: 2 }));
      await w.erase(w.actors[1]!, false).catch(() => undefined); // suppressed but unverified: the ledger is now ahead of every package (head 3)
      const drill = await runRestoreDrill({ ...w.ledgerInput(), mirror: store, store, targetUri: replica!, packageKey, indexManifestDigest: digest });
      expect(drill).toMatchObject({ package: second.package, ledgerHead: 3, releaseAllowed: false,
        fence: { technicalChecksPassed: true, watermark: 3, releaseAllowed: false } });
      expect(drill.counts).not.toHaveProperty("profiles"); // both owners are suppressed by the ledger at restore time (empty collections are omitted)
      expect(drill.timings.totalMs).toBeGreaterThanOrEqual(drill.timings.restoreMs);
      expect(JSON.stringify(drill)).not.toMatch(new RegExp(`${w.actors[0]!.userId}|${w.actors[1]!.userId}|Synthetic`));
      // What the restore-drill CLI prints (18-07/18-20): a fixed shape of names, counts, heads, barriers and timings only.
      expect(Object.keys(drill).sort()).toEqual(["barriers", "counts", "fence", "ledgerHead", "package", "recoveryPoint", "releaseAllowed", "timings"]);
      expect(Object.values(drill.counts).every(value => typeof value === "number")).toBe(true);
      for (const group of Object.values(drill.barriers)) expect(Object.values(group).every(value => typeof value === "number")).toBe(true);
      expect(JSON.stringify(drill)).not.toContain(replica!); // the target URI never reaches the printed result
      expect(Object.keys(drill.fence).sort()).toEqual(["releaseAllowed", "technicalChecksPassed", "watermark"]);
      expect(Object.keys(drill.recoveryPoint).sort()).toEqual(["atClusterTime", "capturedAt", "ledgerHead"]);
      expect(Object.keys(drill.timings).sort()).toEqual(["fenceMs", "recoveryPointAgeMs", "restoreMs", "totalMs"]);
      expect(Object.keys(drill.barriers).sort()).toEqual(["bankControl", "bankRecords", "development"]);
      expect(drill.package).toMatch(/^packages\/[0-9]+-[0-9a-f]+\.bson$/);
      await expect(runRestoreDrill({ ...w.ledgerInput(), mirror: store, store: directoryObjectStore(join(root, "empty")), targetUri: replica!, packageKey,
        indexManifestDigest: digest })).rejects.toThrow("no package available");
      await expect(runRestoreDrill({ ...w.ledgerInput(), mirror: store, store, targetUri: "mongodb://db.example.invalid:27017", packageKey, indexManifestDigest: digest }))
        .rejects.toThrow("Isolated recovery target required");

      // Fail closed before any connection or upload on configuration and key errors; no success is ever recorded for a failed run.
      recordSuccess.mockClear(); const packagesBefore = await store.list("packages/");
      const connect = vi.fn(async (): Promise<MongoClient> => { throw new Error("must not connect"); });
      const missingLedgerKey = Object.fromEntries(Object.entries(secrets).filter(([name]) => name !== "FINANCIAL_OS_DELETION_LEDGER_KEY_V1"));
      for (const [overrides, reason] of [
        [{ secrets: missingLedgerKey }, "keys"], [{ secrets: { ...secrets, FINANCIAL_OS_RECOVERY_PACKAGE_KEY_V1: "short" } }, "keys"],
        [{ secrets: { ...secrets, FINANCIAL_OS_LEDGER_MIRROR_KEY_V1: undefined } }, "keys"],
        [{ secrets: { ...secrets, FINANCIAL_OS_LEDGER_MIRROR_KEY_V1: secrets.FINANCIAL_OS_DELETION_LEDGER_KEY_V1 } }, "keys"], // mirror key must differ
        [{ secrets: { ...secrets, FINANCIAL_OS_BACKUP_APP_DB_URI: undefined } }, "database URI missing"],
        [{ secrets: { ...secrets, FINANCIAL_OS_LEDGER_READ_URI: "mongodb://ledger.example.invalid:27017/" } }, "database URI must require TLS"],
        [{ secrets: { ...secrets, FINANCIAL_OS_BACKUP_APP_DB_URI: "mongodb+srv://app.example.invalid/?tlsInsecure=true" } }, "database URI must require TLS"],
        [{ environment: "production" }, "database URI must require TLS"], // loopback URIs are never accepted for production
        [{ ledgerDatabase: w.app.database.databaseName }, "configuration"], [{ indexManifestDigest: "b" }, "configuration"],
      ] as const) await expect(worker({ ...overrides, connect })).rejects.toThrow(`Backup worker failed closed: ${reason}`);
      expect(connect).not.toHaveBeenCalled();
      // Ledger unreachable: nothing is written.
      let connections = 0;
      await expect(worker({ connect: async uri => { if (++connections === 1) throw new Error("synthetic ledger outage"); return new MongoClient(uri).connect(); } }))
        .rejects.toThrow("synthetic ledger outage");
      // Capture refuses (unreviewed collection): the ledger mirror may be written, but no package and no success.
      await w.app.database.createCollection("unreviewedCollection");
      await expect(worker()).rejects.toThrow("Backup capture failed closed: unreviewed collections: unreviewedCollection");
      await w.app.database.collection("unreviewedCollection").drop();
      expect(await store.list("packages/")).toEqual(packagesBefore);
      expect(recordSuccess).not.toHaveBeenCalled();
      // A statistics failure after the backup is stored withholds the success signal (the missing-backup alarm then fires); the backup stays.
      const statsDown = async (uri: string) => { const client = await new MongoClient(uri).connect(); const original = client.db.bind(client);
        return Object.assign(client, { db: (name: string) => Object.assign(Object.create(original(name)), { stats: async () => { throw new Error("synthetic stats outage"); } }) }); };
      const packagesBeforeStats = (await store.list("packages/")).length;
      await expect(worker({ connect: statsDown })).rejects.toThrow("synthetic stats outage");
      expect((await store.list("packages/")).length).toBe(packagesBeforeStats + 1);
      expect(recordSuccess).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);

  it("guards the real claim path by default when the ledger is configured, and fails closed on partial configuration", async () => {
    const w = await world(disposables);
    const stagingKey = { version: 1, material: randomBytes(32) };
    const staging = new DeletionReceiptStore(w.ledgerDb.database, "staging", { active: stagingKey, keys: [stagingKey] });
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUTH_SECRET", "synthetic-recovery-secret-at-least-32-characters");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "synthetic-client"); vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "synthetic-secret"); vi.stubEnv("OPEN_FINANCE_USER_ID", "synthetic-subject");
    const provider = { listConnections: async () => [{ expiryDate: null, externalId: "c", lastFetchedAt: null, lastFetchedDataDate: null, mode: null,
      providerExternalId: "p", status: "ACTIVE", subjectExternalId: "synthetic-subject" }] } as unknown as OpenBankingProvider;
    const claimDb = await w.target(); const repository = openBankingRepositoryForDatabase(claimDb.database); await repository.ensureIndexes();
    const original: Actor = { kind: "user", userId: new ObjectId().toHexString() }; const newcomer: Actor = { kind: "user", userId: new ObjectId().toHexString() };
    await claimConfiguredOpenBankingSubject(original, { provider, repository, erasedProviderSubject: async () => false });
    const subjectAlias = (await claimDb.database.collection("bankProviderBindings").findOne())!.subjectAlias as string;
    await runLedgerFirstErasure(staging, original, randomUUID(), () => Date.now(), { providerSubjectAliases: async () => [subjectAlias], fence: async () => undefined,
      erase: async () => { await claimDb.database.collection("bankProviderBindings").deleteMany({}); }, verify: async () => true },
      async row => { await journalLedgerRow({ row, store: wormObjectStore(), environment: "staging", ledgerKeys: [stagingKey] }); });
    // Fresh module graph so the runtime reads this configuration (the ledger handle is cached per process).
    const load = async () => { vi.resetModules(); return { ...await import("@/lib/open-banking/open-banking-service"), ...await import("@/lib/errors/application-error") }; };
    vi.stubEnv("FINANCIAL_OS_ENVIRONMENT", "staging"); vi.stubEnv("FINANCIAL_OS_LEDGER_MONGODB_URI", replica!);
    vi.stubEnv("FINANCIAL_OS_LEDGER_DATABASE", w.ledgerDb.database.databaseName);
    vi.stubEnv("FINANCIAL_OS_DELETION_LEDGER_KEY_V1", Buffer.from(stagingKey.material).toString("base64")); vi.stubEnv("FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION", "1");
    const configured = await load();
    await expect(configured.claimConfiguredOpenBankingSubject(newcomer, { provider, repository })).rejects.toBeInstanceOf(configured.ConflictError);
    expect(await claimDb.database.collection("bankProviderBindings").countDocuments()).toBe(0);
    // Operator readiness runs the guard's own read on the real ledger (the S9 staging proof, with no provider call).
    await expect((await import("@/lib/operations/deletion-ledger-runtime")).probeDeletionLedger()).resolves.toBeUndefined();
    // An unreachable ledger fails closed on both paths, and nothing is bound.
    vi.stubEnv("FINANCIAL_OS_LEDGER_MONGODB_URI", "mongodb://127.0.0.1:9/");
    const unreachable = await load();
    await expect(unreachable.claimConfiguredOpenBankingSubject(newcomer, { provider, repository })).rejects.toThrow("Deletion ledger unavailable");
    await expect((await import("@/lib/operations/deletion-ledger-runtime")).probeDeletionLedger()).rejects.toThrow("Deletion ledger unavailable");
    expect(await claimDb.database.collection("bankProviderBindings").countDocuments()).toBe(0);
    vi.stubEnv("FINANCIAL_OS_LEDGER_MONGODB_URI", replica!);
    vi.stubEnv("FINANCIAL_OS_LEDGER_DATABASE", "");
    const partial = await load();
    await expect(partial.claimConfiguredOpenBankingSubject(newcomer, { provider, repository })).rejects.toBeInstanceOf(partial.ConfigurationError);
    expect(await claimDb.database.collection("bankProviderBindings").countDocuments()).toBe(0);
  }, 60_000);
});

// Keeps the standalone client import meaningful for readers: capture needs a snapshot-capable replica set.
void MongoClient; void ({} as Document);
