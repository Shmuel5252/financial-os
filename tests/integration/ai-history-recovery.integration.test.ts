import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { aiHistoryRecoveryFixture } from "../helpers/ai-history-recovery-fixture";
import { progressSourceFixture } from "../helpers/progress-source-fixture";
import { aiConversationRepositoryForDatabase } from "@/lib/ai/ai-conversation-repository";
import { reportSummaryRepositoryForDatabase } from "@/lib/reports/report-summary-repository";
import type { AiConversationMessage } from "@/lib/ai/ai";
import type { ReportAiSummary } from "@/lib/reports/report-summary";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";
import { inspectAiHistoryRecoveryLinks } from "@/lib/operations/ai-history-recovery-links";
import { financialEngineSnapshotRepositoryForDatabase } from "@/lib/financial-engine/financial-engine-snapshot-repository";
import { financialReportRepositoryForDatabase } from "@/lib/reports/report-repository";
import { calculateFinancialReport } from "@/lib/domain/reports/report-engine";
import { money } from "@/lib/domain/money/money";
import { buildReportSummaryContext } from "@/lib/reports/report-summary-service";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real isolated AI history recovery", () => {
  it("preserves user-visible history and hidden summaries with owner suppression, without model or financial replay", async () => {
    const source = await createIsolatedRecoveryTarget(uri!);
    let target: Awaited<ReturnType<typeof createIsolatedRecoveryTarget>> | undefined;
    try {
      target = await createIsolatedRecoveryTarget(uri!);
      const conversations = aiConversationRepositoryForDatabase(source.database);
      const summaries = reportSummaryRepositoryForDatabase(source.database);
      await conversations.ensureIndexes(); await summaries.ensureIndexes();
      await financialEngineSnapshotRepositoryForDatabase(source.database).ensureIndexes();
      const reports = financialReportRepositoryForDatabase(source.database); await reports.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const conversationIds: string[] = []; const reportIds: string[] = []; const summaryInputs: Omit<ReportAiSummary, "id" | "createdAt">[] = [];
      const retryKeys: string[] = []; const hiddenIds: string[] = [];
      for (const actor of actors) {
        const fixture = aiHistoryRecoveryFixture(new ObjectId(actor.userId)); const row = fixture.summary;
        const snapshot = progressSourceFixture("engine_snapshot").row; snapshot.userId = new ObjectId(actor.userId);
        snapshot.auditTrail[0].actorUserId = snapshot.userId;
        await source.database.collection("financialSnapshots").insertOne(snapshot);
        fixture.conversation.messages[1].sourceReferences = [{ alias: "engine.current", kind: "financial_engine_snapshot",
          sourceId: snapshot._id.toHexString(), version: `${snapshot.engineVersion}/${snapshot.policyVersion}` }];
        const first = await conversations.createForActor(actor, fixture.conversation.title, fixture.conversation.messages as AiConversationMessage[]);
        conversationIds.push(first.id);
        await conversations.appendForActor(actor, first.id, 1, (fixture.conversation.messages as AiConversationMessage[]).map(message => ({ ...message, id: randomUUID() })));
        const report = calculateFinancialReport({ accounts: [{ id: new ObjectId().toHexString(), amount: money(9007199254740993n, "ILS"), label: "Synthetic", version: 1 }],
          budget: [], goals: [], liabilities: [], netWorth: [],
          savings: [{ id: new ObjectId().toHexString(), amount: money(9007199254740993n, "ILS"), label: "Synthetic", version: 1 }], subscriptions: [], transactions: [],
          generatedAt: row.createdAt.toISOString(), timeZone: "Asia/Jerusalem", period: { kind: "month", value: "2026-09" }, scope: { kind: "personal" } });
        const saved = await reports.createForActor(actor, { authorizationFingerprint: null, idempotencyKey: randomUUID(), idempotencyPayload: { kind: "synthetic" },
          report, restatementReason: null, supersedes: null });
        const context = buildReportSummaryContext(saved);
        const response = { fact: [{ evidenceRefs: [context.evidence[0]!.ref], text: "הסבר סינתטי בלבד" }], insight: [], recommendation: [] };
        const input: Omit<ReportAiSummary, "id" | "createdAt"> = { evidence: context.evidence, model: row.model, policyVersion: row.policyVersion,
          provider: row.provider, reportId: saved.id, reportSourceFingerprint: saved.report.sourceFingerprint, response, usage: row.usage, version: 1 };
        summaryInputs.push(input); reportIds.push(input.reportId); const retry = randomUUID(); retryKeys.push(retry);
        const hidden = await summaries.createForActor(actor, input, retry); hiddenIds.push(hidden.id);
        await summaries.deleteForActor(actor, hidden.id, 1);
        await summaries.createForActor(actor, { ...input, version: 2 }, randomUUID());
      }
      const names = ["aiConversations", "reportAiSummaries", "financialSnapshots", "financialReports"];
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const inspect = (rows: Record<string, Document[]>) => inspectAiHistoryRecoveryLinks({ conversations: rows.aiConversations!, summaries: rows.reportAiSummaries!,
        snapshots: rows.financialSnapshots!, reports: rows.financialReports!, budgets: [], goals: [], purchases: [] });
      expect(inspect(records)).toMatchObject({ releaseAllowed: false, matched: 8, unresolved: { missing: 0, changed: 0, historicalResponses: 8 } });
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const pack = createBackupPackage(records, initialRecoverySchemas, digest, key); expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, digest, key); const now = Date.now();
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restoredConversations = aiConversationRepositoryForDatabase(target.database); await restoredConversations.ensureIndexes();
      const restoredSummaries = reportSummaryRepositoryForDatabase(target.database); await restoredSummaries.ensureIndexes();
      await financialEngineSnapshotRepositoryForDatabase(target.database).ensureIndexes();
      await financialReportRepositoryForDatabase(target.database).ensureIndexes();
      for (const name of names) {
        await target.database.collection(name).insertMany(opened[name]!.filter(row => !isSuppressed(row.userId.toHexString())));
        expect(BSON.serialize({ rows: await target.database.collection(name).find().sort({ _id: 1 }).toArray() }))
          .toEqual(BSON.serialize({ rows: records[name]!.filter(row => row.userId.toHexString() === actors[1]!.userId) }));
        expect(await target.database.collection(name).countDocuments({ userId: new ObjectId(actors[0]!.userId) })).toBe(0);
        const byName = (left: Document, right: Document) => String(left.name).localeCompare(String(right.name));
        expect((await target.database.collection(name).listIndexes().toArray()).sort(byName))
          .toEqual((await source.database.collection(name).listIndexes().toArray()).sort(byName));
        expect(BSON.serialize({ rows: await source.database.collection(name).find().sort({ _id: 1 }).toArray() })).toEqual(BSON.serialize({ rows: records[name] }));
      }
      expect(await restoredConversations.findForActor(actors[0]!, conversationIds[1]!)).toBeNull();
      expect(await restoredSummaries.listForReportActor(actors[0]!, reportIds[1]!)).toEqual([]);
      expect(await restoredConversations.findForActor(actors[1]!, conversationIds[1]!)).toMatchObject({ version: 2, messages: expect.any(Array) });
      await expect(restoredConversations.appendForActor(actors[1]!, conversationIds[1]!, 1,
        aiHistoryRecoveryFixture().conversation.messages as AiConversationMessage[])).rejects.toThrow();
      expect(await restoredSummaries.findForActor(actors[1]!, hiddenIds[1]!)).toBeNull();
      expect((await restoredSummaries.listForReportActor(actors[1]!, reportIds[1]!)).map(row => row.version)).toEqual([2]);
      expect((await restoredSummaries.createForActor(actors[1]!, summaryInputs[1]!, retryKeys[1]!)).id).toBe(hiddenIds[1]);
      expect(await target.database.collection("reportAiSummaries").countDocuments()).toBe(2);
      for (const name of ["transactions", "notifications", "authSessions", "authVerificationTokens"]) expect(await target.database.collection(name).countDocuments()).toBe(0);
      expect(inspect(Object.fromEntries(await Promise.all(names.map(async name => [name, await target!.database.collection(name).find().toArray()])))))
        .toMatchObject({ releaseAllowed: false, matched: 4, unresolved: { missing: 0, changed: 0, historicalResponses: 4, currentHistoryDeletion: 3 } });
      // Transitive canonical ownership/historical correctness and current individual deletion remain release barriers.
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
