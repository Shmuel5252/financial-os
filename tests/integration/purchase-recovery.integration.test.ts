import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { calculatePurchaseSimulation } from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { money } from "@/lib/domain/money/money";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { purchaseSimulationRepositoryForDatabase } from "@/lib/purchase-simulations/purchase-simulation-repository";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { fromStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { purchaseSimulationEvaluationDomainSchema, purchaseSimulationParametersDomainSchema } from "@/lib/purchase-simulations/purchase-simulation";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated saved purchase simulation recovery", () => {
  it("preserves hypothetical BSON, owner isolation and retry identity without modifying baseline evidence", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const manifests = financialSnapshotRepositoryForDatabase(source.database);
      const engines = financialEngineSnapshotRepositoryForDatabase(source.database);
      const simulations = purchaseSimulationRepositoryForDatabase(source.database);
      await manifests.ensureIndexes(); await engines.ensureIndexes(); await simulations.ensureIndexes();
      const zero = money(0n, "ILS"); const balance = money(9007199254740993n, "ILS");
      const engine = calculateFinancialEngine({ accountBalance: balance, availableCash: balance, actualMonthlyExpenses: zero,
        actualMonthlyIncome: zero, asOf: "2026-09-01T10:00:00Z", creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero,
        events: [], horizonDays: 210, monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
      const retryKey = randomUUID();
      for (const actor of actors) {
        const manifest = await manifests.createForActor(actor, "ILS", [], randomUUID());
        const baseline = await engines.createForActor(actor, "a".repeat(64), engine, manifest.id, randomUUID());
        const input = { charges: [{ amount: money(1n, "ILS"), kind: "fee" as const, label: "Synthetic fee",
          provenance: { kind: "user_reported" as const, note: null } }], inputMode: "installments" as const, installmentCount: 3,
          installmentFrequency: "monthly" as const, proposedDate: "2026-09-01", sourceSnapshotId: baseline.id, totalPurchasePrice: money(100n, "ILS") };
        const result = calculatePurchaseSimulation({ ...input, baseline: baseline.result, evaluationHorizonDays: 120, saferDateSearchDays: 90 });
        await simulations.saveForActor(actor, input, { budgetPeriodReference: null, dataFreshness: "STALE", freshnessReasons: ["new_calendar_day"],
          result, timeZone: "Asia/Jerusalem", sourceSnapshot: { id: baseline.id, calculatedAt: baseline.calculatedAt, engineVersion: engine.engineVersion,
            policyVersion: engine.policyVersion, inputHash: baseline.inputHash, sourceManifestId: manifest.id } }, { idempotencyKey: retryKey, name: "Synthetic simulation", note: null });
      }
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      const names = ["financialSnapshots", "purchaseSimulations"];
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) };
      const pack = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restored = purchaseSimulationRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await financialSnapshotRepositoryForDatabase(target.database).ensureIndexes();
      await financialEngineSnapshotRepositoryForDatabase(target.database).ensureIndexes();
      for (const name of names) {
        const survivors = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(survivors);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        expect(await target.database.collection(name).listIndexes().toArray()).toEqual(await source.database.collection(name).listIndexes().toArray());
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
      }
      const row = (await target.database.collection("purchaseSimulations").findOne())!;
      expect(row.evaluation.result.openingConfirmedBalance.amountMinor).toBeInstanceOf(Long);
      expect(row.evaluation.result.openingConfirmedBalance.amountMinor.toString()).toBe("9007199254740993");
      expect(await restored.findForActor(actors[0]!, row._id.toHexString())).toBeNull();
      const retry = await restored.saveForActor(actors[1]!, purchaseSimulationParametersDomainSchema.parse(fromStoredDomainValue(row.input)),
        purchaseSimulationEvaluationDomainSchema.parse(fromStoredDomainValue(row.evaluation)), { idempotencyKey: retryKey, name: row.name, note: row.note });
      expect(retry.id).toBe(row._id.toHexString()); expect(retry.evaluation.dataFreshness).toBe("STALE");
      expect(await target.database.collection("purchaseSimulations").countDocuments()).toBe(1);
      await expect(target.database.collection("purchaseSimulations").insertOne({ ...row, _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
      expect(await target.database.collection("transactions").countDocuments()).toBe(0);
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
