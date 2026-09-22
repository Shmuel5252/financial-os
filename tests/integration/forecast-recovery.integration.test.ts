import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { calculateForecast, calculateForecastScenario } from "@/lib/domain/forecasts/forecast-engine";
import { money } from "@/lib/domain/money/money";
import { financialSnapshotRepositoryForDatabase } from "@/lib/financial-snapshots/financial-snapshot-repository";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { forecastRepositoryForDatabase } from "@/lib/forecasts/forecast-repository";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated forecast evidence recovery", () => {
  it("roundtrips real repository forecasts/scenarios under indexes without restoring erased ownership", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const users = [{ _id: new ObjectId() }, { _id: new ObjectId() }];
      const owner = { kind: "user" as const, userId: users[0]!._id.toHexString() };
      const erased = { kind: "user" as const, userId: users[1]!._id.toHexString() };
      const manifests = financialSnapshotRepositoryForDatabase(source.database);
      const engines = financialEngineSnapshotRepositoryForDatabase(source.database);
      const repository = forecastRepositoryForDatabase(source.database);
      await manifests.ensureIndexes(); await engines.ensureIndexes(); await repository.ensureIndexes();
      const zero = money(0n, "ILS"); const balance = money(9007199254740993n, "ILS");
      const engine = calculateFinancialEngine({ accountBalance: balance, availableCash: balance, actualMonthlyExpenses: zero,
        actualMonthlyIncome: zero, asOf: "2026-09-01T10:00:00.000Z", creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero,
        events: [], horizonDays: 30, monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
      for (const actor of [owner, erased]) {
        // Synthetic repository fixture; full financial input-manifest reconstruction is a separate gate.
        const manifest = await manifests.createForActor(actor, "ILS", [], randomUUID());
        const baseline = await engines.createForActor(actor, "a".repeat(64), engine, manifest.id, randomUUID());
        const result = calculateForecast({ baseline: baseline.result, dataFreshness: "FRESH", freshnessReasons: [], horizonDays: 30,
          intelligenceEvidence: [], sourceReferencePrefix: baseline.id });
        const forecast = await repository.createForecastForActor(actor, result, { sourceSnapshotId: baseline.id, intelligenceRunId: null, idempotencyKey: randomUUID() });
        await repository.createScenarioForActor(actor, forecast.id, calculateForecastScenario(result, []), { idempotencyKey: randomUUID(), name: "Synthetic scenario", note: null });
      }
      const forecasts = await source.database.collection("forecastSnapshots").find().sort({ _id: 1 }).toArray();
      const scenarios = await source.database.collection("forecastScenarios").find().sort({ _id: 1 }).toArray();
      const snapshots = await source.database.collection("financialSnapshots").find().sort({ _id: 1 }).toArray();
      const before = BSON.serialize({ forecasts, scenarios, snapshots }); const key = { version: 1, material: randomBytes(32) };
      const records = { ...Object.fromEntries(recoveryCollections.map(name => [name, []])), authUsers: users, forecastSnapshots: forecasts, forecastScenarios: scenarios, financialSnapshots: snapshots };
      const artifact = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      expect(artifact.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(artifact, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(erased, "isolated-test", randomUUID(), now, key)] });
      const restored = forecastRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await financialSnapshotRepositoryForDatabase(target.database).ensureIndexes();
      await financialEngineSnapshotRepositoryForDatabase(target.database).ensureIndexes();
      const survivingSnapshots = opened.financialSnapshots!.filter(row => !isSuppressed(row.userId.toHexString()));
      await target.database.collection("financialSnapshots").insertMany(survivingSnapshots);
      expect(BSON.serialize({ rows: await target.database.collection("financialSnapshots").find().sort({ _id: 1 }).toArray() }))
        .toEqual(BSON.serialize({ rows: snapshots.filter(row => row.userId.equals(users[0]!._id)) }));
      const survivingEngine = survivingSnapshots.find(row => row.kind === "engine_result")!;
      expect(survivingSnapshots.some(row => row.kind === "source_manifest" && row._id.equals(survivingEngine.sourceManifestId))).toBe(true);
      for (const name of ["forecastSnapshots", "forecastScenarios"]) {
        const surviving = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(surviving);
        const actual = await target.database.collection(name).find().sort({ _id: 1 }).toArray();
        expect(BSON.serialize({ rows: actual })).toEqual(BSON.serialize({ rows: (name === "forecastSnapshots" ? forecasts : scenarios).filter(row => row.userId.equals(users[0]!._id)) }));
        expect(actual[0]!.result.projectedEndBalance.amountMinor).toBeInstanceOf(Long);
        await expect(target.database.collection(name).insertOne({ ...surviving[0], _id: new ObjectId() })).rejects.toThrow();
      }
      expect((await restored.listForecastsForActor(owner))[0]!.result.projectedEndBalance.amountMinor).toBe(9007199254740993n);
      expect(await restored.listForecastsForActor(erased)).toEqual([]); expect(await restored.listScenariosForActor(erased)).toEqual([]);
      expect(await restored.findForecastForActor(erased, forecasts[0]!._id.toHexString())).toBeNull();
      expect(BSON.serialize({ forecasts: await source.database.collection("forecastSnapshots").find().sort({ _id: 1 }).toArray(),
        scenarios: await source.database.collection("forecastScenarios").find().sort({ _id: 1 }).toArray(),
        snapshots: await source.database.collection("financialSnapshots").find().sort({ _id: 1 }).toArray() })).toEqual(before);
    } finally { try { await target?.dispose(); } finally { await source.dispose(); } }
  }, 30000);
});
