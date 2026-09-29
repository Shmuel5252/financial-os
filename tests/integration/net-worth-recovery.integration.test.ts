import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { netWorthSnapshotFixture } from "../helpers/net-worth-recovery-fixture";
import { netWorthRepositoryForDatabase } from "@/lib/net-worth/net-worth-repository";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { inspectNetWorthRecoveryLinks } from "@/lib/operations/net-worth-recovery-links";
import { netWorthStatementDomainSchema } from "@/lib/net-worth/net-worth";
import { fromStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { money } from "@/lib/domain/money/money";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated net-worth recovery", () => {
  it("preserves items, terminal deletion, multi-currency snapshots, owner suppression and retry/index integrity", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const repo = netWorthRepositoryForDatabase(source.database); await repo.ensureIndexes();
      const accounts = manualRecordRepositoryForDatabase(source.database, "accounts"); await accounts.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const retryKey = randomUUID();
      const fields = { amount: money(9007199254740993n, "ILS"), category: "other_asset" as const,
        effectiveAt: "2026-09-28T00:00:00Z", label: "Synthetic item", provenance: { kind: "user_entered" as const, note: null },
        relationship: { kind: "standalone" as const }, side: "asset" as const, valuationType: "user_estimate" as const };
      for (const actor of actors) {
        const item = await repo.createItemForActor(actor, fields, retryKey);
        await repo.updateItemForActor(actor, item.id, 1, fields);
        const deleted = await repo.createItemForActor(actor, { ...fields, label: "Synthetic deleted item" }, randomUUID());
        await repo.deleteItemForActor(actor, deleted.id, 1);
        const account = await accounts.createForActor(actor, { name: "Synthetic second currency", type: "bank", balance: money(7n, "USD") }, randomUUID());
        const fixture = netWorthSnapshotFixture(new ObjectId(actor.userId), new ObjectId(item.id), 2, new ObjectId(account.id));
        const statement = netWorthStatementDomainSchema.parse(fromStoredDomainValue(fixture.statement));
        await repo.captureSnapshotForActor(actor, statement, "material_change");
      }
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      const names = ["netWorthItems", "netWorthSnapshots", "accounts"];
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) };
      const pack = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      expect(inspectNetWorthRecoveryLinks(opened.netWorthSnapshots!, { netWorthItems: opened.netWorthItems!, accounts: opened.accounts! }))
        .toEqual({ policy: "net-worth-recovery-links-v1", releaseAllowed: false, matched: 4,
          unresolved: { missing: 0, changed: 0, inactive: 0, unversioned: 0, historicalStatements: 2 } });
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restored = netWorthRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await manualRecordRepositoryForDatabase(target.database, "accounts").ensureIndexes();
      for (const name of names) {
        const survivors = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(survivors);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        expect((await target.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual((await source.database.collection(name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
        await expect(target.database.collection(name).insertOne({ ...survivors[0], _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
      }
      const row = (await target.database.collection("netWorthItems").findOne({ deletedAt: null }))!;
      expect(row.fields.amount.amountMinor).toBeInstanceOf(Long);
      expect(row.fields.amount.amountMinor.toString()).toBe("9007199254740993");
      expect(await restored.listItemsForActor(actors[0]!)).toEqual([]);
      expect((await restored.listItemsForActor(actors[1]!)).map(item => item.id)).toEqual([row._id.toHexString()]);
      expect((await restored.createItemForActor(actors[1]!, fields, retryKey)).id).toBe(row._id.toHexString());
      const snapshot = (await target.database.collection("netWorthSnapshots").findOne())!;
      expect(inspectNetWorthRecoveryLinks([snapshot], { netWorthItems: await target.database.collection("netWorthItems").find().toArray(),
        accounts: await target.database.collection("accounts").find().toArray() })).toEqual({ policy: "net-worth-recovery-links-v1",
        releaseAllowed: false, matched: 2, unresolved: { missing: 0, changed: 0, inactive: 0, unversioned: 0, historicalStatements: 1 } });
      expect((await restored.captureSnapshotForActor(actors[1]!, netWorthStatementDomainSchema.parse(fromStoredDomainValue(snapshot.statement)), "material_change")).id)
        .toBe(snapshot._id.toHexString());
      expect(await target.database.collection("netWorthItems").countDocuments()).toBe(2);
      expect(await target.database.collection("netWorthSnapshots").countDocuments()).toBe(1);
      // Direct identity/revision matches do not reconstruct historical valuations.
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
