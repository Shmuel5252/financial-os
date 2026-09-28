import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { progressRecoveryFixture } from "../helpers/progress-recovery-fixture";
import { progressEventDraft } from "@/lib/domain/progress-journeys/progress-journey-engine";
import { progressJourneyRepositoryForDatabase } from "@/lib/progress-journeys/progress-journey-repository";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { inspectProgressRecoveryLinks } from "@/lib/operations/progress-recovery-links";
import { budgetRepositoryForDatabase } from "@/lib/budgets/budget-repository";
import { calculateBudget } from "@/lib/domain/budgets/budget-engine";
import { money } from "@/lib/domain/money/money";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated progress evidence recovery", () => {
  it("preserves correction lineage/preferences, suppresses erased ownership and never replays notifications", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const repo = progressJourneyRepositoryForDatabase(source.database); await repo.ensureIndexes();
      const budgets = budgetRepositoryForDatabase(source.database); await budgets.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const fixtures = actors.map(actor => progressRecoveryFixture(new ObjectId(actor.userId)));
      const originals = [];
      for (const [index, actor] of actors.entries()) {
        const fixture = fixtures[index]!;
        const budgetInput = { allocations: [], carryIn: [], calendarMonth: "2026-08", currency: "ILS", expectedVersion: null };
        const budget = await budgets.savePeriodForActor(actor, budgetInput);
        fixture.observation = { ...fixture.observation, sourceReferences: [{ kind: "budget_period", sourceId: budget.id, version: "1" }] };
        fixture.draft = progressEventDraft(fixture.observation, null);
        const original = await repo.appendForActor(actor, fixture.draft); originals.push(original);
        await budgets.closePeriodForActor(actor, "2026-08", 1, calculateBudget({ ...budgetInput, activities: [], plannedOutflows: [], categories: [],
          confirmedIncome: money(9007199254740993n, "ILS"), uncertainIncome: money(0n, "ILS") }));
        const corrected = progressEventDraft({ ...fixture.observation, outcome: "not_achieved",
          sourceReferences: [{ ...fixture.observation.sourceReferences[0]!, version: "2" }] }, "achieved");
        expect((await repo.appendForActor(actor, corrected)).supersedesId).toBe(original.id);
        await repo.savePreferencesForActor(actor, { ...fixture.settings, expectedVersion: null });
        await repo.savePreferencesForActor(actor, { ...fixture.settings, celebrationsEnabled: true, expectedVersion: 1 });
      }
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      const names = ["progressJourneyEvents", "progressJourneyPreferences", "budgetPeriods"];
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const inspect = (rows: Record<string, Document[]>) => inspectProgressRecoveryLinks({ events: rows.progressJourneyEvents!,
        budgets: rows.budgetPeriods!, snapshots: [], reports: [], goals: [] });
      expect(inspect(records)).toMatchObject({ releaseAllowed: false, matchedSources: 2, matchedParents: 2,
        unresolved: { changedSources: 2, missingParents: 0, historicalEvents: 4 } });
      const key = { version: 1, material: randomBytes(32) };
      const pack = createBackupPackage(records, initialRecoverySchemas, "a".repeat(64), key);
      expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, "a".repeat(64), key); const now = Date.now();
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restored = progressJourneyRepositoryForDatabase(target.database); await restored.ensureIndexes();
      await budgetRepositoryForDatabase(target.database).ensureIndexes();
      for (const name of names) {
        const survivors = opened[name]!.filter(row => !isSuppressed(row.userId.toHexString()));
        await target.database.collection(name).insertMany(survivors);
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        // Concurrent ensureIndexes does not guarantee list order; compare the complete named definitions.
        const byName = (left: Document, right: Document) => String(left.name).localeCompare(String(right.name));
        expect((await target.database.collection(name).listIndexes().toArray()).sort(byName))
          .toEqual((await source.database.collection(name).listIndexes().toArray()).sort(byName));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
        await expect(target.database.collection(name).insertOne({ ...survivors[0], _id: new ObjectId() })).rejects.toMatchObject({ code: 11000 });
      }
      expect(await restored.listEventsForActor(actors[0]!)).toEqual([]);
      expect(await restored.findPreferencesForActor(actors[0]!)).toBeNull();
      expect(await restored.findLatestForStableKey(actors[0]!, originals[1]!.stableKey)).toBeNull();
      expect((await restored.appendForActor(actors[1]!, fixtures[1]!.draft)).id).toBe(originals[1]!.id);
      expect(await restored.findPreferencesForActor(actors[1]!)).toMatchObject({ version: 2, celebrationsEnabled: true,
        progressNotificationsEnabled: false, streaksEnabled: false });
      await expect(restored.savePreferencesForActor(actors[1]!, { ...fixtures[1]!.settings, expectedVersion: 1 })).rejects.toThrow();
      const events = await restored.listEventsForActor(actors[1]!);
      expect(events).toHaveLength(2);
      expect(events.find(event => event.eventKind === "correction")?.supersedesId).toBe(originals[1]!.id);
      expect(await target.database.collection("notifications").countDocuments()).toBe(0);
      expect(await target.database.collection("goalProgress").countDocuments()).toBe(0);
      expect(inspect(Object.fromEntries(await Promise.all(names.map(async name => [name, await target!.database.collection(name).find().toArray()])))))
        .toMatchObject({ releaseAllowed: false, matchedSources: 1, matchedParents: 1,
          unresolved: { changedSources: 1, missingSources: 0, missingParents: 0, historicalEvents: 2 } });
      // Direct source metadata/lineage only: prior revisions and outcomes are not reconstructed or promoted.
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
