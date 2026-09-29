import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { ConflictError } from "@/lib/errors/application-error";
import { openBankingRepositoryForDatabase } from "@/lib/open-banking/open-banking-repository";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion } from "@/lib/operations/deletion-ledger";
import { inspectBankControlRecovery, quarantineBankControl } from "@/lib/operations/bank-control-recovery";

const uri = process.env.MONGODB_TEST_URI;
const alias = (value: string) => createHash("sha256").update(value).digest("hex");
const names = ["bankProviderBindings", "bankConnections", "bankSyncRuns", "bankLifecycleCommands"] as const;
const byName = (left: Document, right: Document) => String(left.name).localeCompare(String(right.name));
const counts = { accountObservationCount: 1, canonicalAccountCount: 1, canonicalTransactionCount: 0, connectionObservationCount: 1, transactionObservationCount: 0 };
const rows = (records: Record<string, readonly Document[]>) => ({ bindings: records.bankProviderBindings!, connections: records.bankConnections!,
  runs: records.bankSyncRuns!, lifecycle: records.bankLifecycleCommands! });

(uri ? describe : describe.skip)("real isolated bank control-plane recovery", () => {
  it("restores repository-written provider evidence and never resumes a lease, repeats a paid refresh or re-sends a disconnect", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      let clock = Date.parse("2026-09-29T08:00:00.000Z"); const tick = (ms = 1_000) => { clock += ms; };
      const repository = openBankingRepositoryForDatabase(source.database, () => new Date(clock)); await repository.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      // Retry keys are deliberately shared across owners: uniqueness is owner scoped.
      const keys = { completed: randomUUID(), partial: randomUUID(), interrupted: randomUUID(), failedRefresh: randomUUID(), unknownRefresh: randomUUID(),
        disconnect: randomUUID(), failedDisconnect: randomUUID() };
      const observation = (index: number, status: string) => ({ expiryDate: "2026-12-01", externalId: `synthetic-${index}`, lastFetchedAt: "2026-09-29T08:00:00.000Z",
        lastFetchedDataDate: "2026-09-29", mode: "PSD2", providerExternalId: "synthetic-provider", status, subjectExternalId: null });
      for (const [index, actor] of actors.entries()) {
        const aliases = { connection: alias(`connection:${actor.userId}`), provider: alias("provider") };
        await repository.claimBinding(actor, alias(`subject:${actor.userId}`)); tick(); await repository.recordRefresh(actor); tick();
        const connectionId = await repository.observeConnection(actor, observation(index, "ACTIVE"), aliases, alias(`fingerprint:${index}:1`)); tick();
        await repository.observeConnection(actor, { ...observation(index, "ACTIVE"), mode: "" }, aliases, alias(`fingerprint:${index}:2`)); tick();
        await repository.updateConnectionCounts(actor, new Map([[aliases.connection, { accounts: 1, transactions: 0 }]])); tick();
        if (index === 1) { await repository.markDisconnected(actor, connectionId, 2); tick(); }
        // Expired lease restart, then completion; failure then restart, then partial; and an interrupted lease.
        const completed = await repository.startSync(actor, keys.completed); tick(200_000);
        await repository.startSync(actor, keys.completed); tick(); await repository.completeSync(actor, completed.run.id, counts); tick();
        const partial = await repository.startSync(actor, keys.partial); tick(); await repository.failSync(actor, partial.run.id, { ...counts, accountObservationCount: 0,
          canonicalAccountCount: 0, connectionObservationCount: 0 }, "provider_unavailable"); tick();
        await repository.startSync(actor, keys.partial); tick(); await repository.failSync(actor, partial.run.id, counts, "rate_limited"); tick();
        await repository.startSync(actor, keys.interrupted); tick();
        const refresh = await repository.startLifecycle(actor, "refresh", keys.failedRefresh); tick(); await repository.finishLifecycle(actor, refresh.id, "failed", "internal"); tick();
        await repository.startLifecycle(actor, "refresh", keys.unknownRefresh); tick();
        const disconnect = await repository.startLifecycle(actor, "disconnect", keys.disconnect); tick(); await repository.finishLifecycle(actor, disconnect.id, "completed", "disconnected"); tick();
        const failed = await repository.startLifecycle(actor, "disconnect", keys.failedDisconnect); tick(); await repository.finishLifecycle(actor, failed.id, "failed", "provider_unavailable"); tick();
        const retried = await repository.startLifecycle(actor, "disconnect", keys.failedDisconnect); tick(); await repository.finishLifecycle(actor, retried.id, "failed", "consent"); tick();
      }
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      expect(inspectBankControlRecovery(rows(records))).toEqual({ policy: "bank-control-recovery-v1", releaseAllowed: false, replayProviders: false,
        unresolved: { missingBinding: 0, unverifiedKeyContinuity: 2, unverifiedConsent: 1, interruptedSyncs: 2, unknownExternalOutcomes: 6 } });
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const pack = createBackupPackage(records, initialRecoverySchemas, digest, key); expect(pack.manifest.releaseAllowed).toBe(false);
      expect(pack.manifest.entries.filter(entry => (names as readonly string[]).includes(entry.collection)).map(entry => entry.schema))
        .toEqual(["bank-binding-v1", "bank-connection-v1", "bank-sync-run-v1", "bank-lifecycle-v1"]);
      const opened = openBackupPackage(pack, initialRecoverySchemas, digest, key); const now = Date.now();
      const quarantined = quarantineBankControl(rows(opened), { environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      // Erased owner: binding, connection, three runs, four commands. Survivor: two runs and three commands fenced.
      expect(quarantined.evidence).toMatchObject({ policy: "bank-control-quarantine-v1", excluded: 9, fenced: 5 });
      const restoredRows = { bankProviderBindings: quarantined.bindings, bankConnections: quarantined.connections,
        bankSyncRuns: quarantined.runs, bankLifecycleCommands: quarantined.lifecycle };
      const later = now + 86_400_000; // Well past every restored lease.
      const restored = openBankingRepositoryForDatabase(target.database, () => new Date(later)); await restored.ensureIndexes();
      for (const name of names) {
        await target.database.collection(name).insertMany(restoredRows[name]);
        const survivors = records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId);
        const materialized = await target.database.collection(name).find().sort({ _id: 1 }).toArray();
        // Only the recovery fence differs from the original survivor BSON.
        const withoutFence = materialized.map(row => { const copy = { ...row }; delete copy.recoveryQuarantinedAt; return copy; });
        expect(BSON.serialize({ rows: withoutFence })).toEqual(BSON.serialize({ rows: survivors }));
        expect((await target.database.collection(name).listIndexes().toArray()).sort(byName))
          .toEqual((await source.database.collection(name).listIndexes().toArray()).sort(byName));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
      }
      expect(await target.database.collection("bankSyncRuns").countDocuments({ recoveryQuarantinedAt: { $exists: true } })).toBe(2);
      expect(await target.database.collection("bankLifecycleCommands").countDocuments({ recoveryQuarantinedAt: { $exists: true } })).toBe(3);
      const snapshot = async () => BSON.serialize({ rows: await Promise.all(names.map(name => target!.database.collection(name).find().sort({ _id: 1 }).toArray())) });
      const before = await snapshot(); const survivor = actors[1]!;
      // Same-key requests after restore reuse recorded outcomes or are refused; none starts a provider action or resumes a lease.
      for (const kept of [keys.failedRefresh, keys.unknownRefresh]) await expect(restored.startLifecycle(survivor, "refresh", kept)).rejects.toBeInstanceOf(ConflictError);
      await expect(restored.startLifecycle(survivor, "disconnect", keys.failedDisconnect)).rejects.toBeInstanceOf(ConflictError);
      expect(await restored.startLifecycle(survivor, "disconnect", keys.disconnect)).toMatchObject({ completed: true, resultStatus: "disconnected" });
      expect(await restored.startSync(survivor, keys.completed)).toMatchObject({ alreadyCompleted: true });
      for (const kept of [keys.interrupted, keys.partial]) await expect(restored.startSync(survivor, kept)).rejects.toBeInstanceOf(ConflictError);
      // A late writer cannot complete a fenced row either.
      const running = { run: quarantined.runs.find(row => row.status === "running")!, command: quarantined.lifecycle.find(row => row.status === "running")! };
      await expect(restored.completeSync(survivor, running.run._id.toHexString(), counts)).rejects.toBeInstanceOf(ConflictError);
      await expect(restored.finishLifecycle(survivor, running.command._id.toHexString(), "completed", "accepted")).rejects.toBeInstanceOf(ConflictError);
      expect(await snapshot()).toEqual(before);
      // Without the fence the repository would restart both expired/non-completed runs and the failed disconnect.
      const unfenced = await createIsolatedRecoveryTarget(uri!);
      try {
        const plain = openBankingRepositoryForDatabase(unfenced.database, () => new Date(later)); await plain.ensureIndexes();
        await unfenced.database.collection("bankSyncRuns").insertMany(records.bankSyncRuns!.filter(row => row.userId.toHexString() === survivor.userId));
        await unfenced.database.collection("bankLifecycleCommands").insertMany(records.bankLifecycleCommands!.filter(row => row.userId.toHexString() === survivor.userId));
        expect(await plain.startSync(survivor, keys.interrupted)).toMatchObject({ alreadyCompleted: false, run: { status: "running" } });
        expect(await plain.startLifecycle(survivor, "disconnect", keys.failedDisconnect)).toMatchObject({ completed: false });
      } finally { await unfenced.dispose(); }
      await expect(restored.claimBinding(survivor, alias(`subject:${survivor.userId}`))).resolves.toBeUndefined();
      await expect(target.database.collection("bankProviderBindings").insertOne({ ...quarantined.bindings[0]!, _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
      expect(inspectBankControlRecovery(rows(Object.fromEntries(await Promise.all(names.map(async name => [name, await target!.database.collection(name).find().toArray()])))))).toEqual({
        policy: "bank-control-recovery-v1", releaseAllowed: false, replayProviders: false,
        unresolved: { missingBinding: 0, unverifiedKeyContinuity: 1, unverifiedConsent: 0, interruptedSyncs: 1, unknownExternalOutcomes: 3 } });
      for (const name of ["bankRecordRevisions", "accounts", "transactions", "authSessions"]) expect(await target.database.collection(name).countDocuments()).toBe(0);
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
