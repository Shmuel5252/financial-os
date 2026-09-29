import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { aiHistoryRecoveryFixture } from "../helpers/ai-history-recovery-fixture";
import { aiConversationRepositoryForDatabase } from "@/lib/ai/ai-conversation-repository";
import { reportSummaryRepositoryForDatabase } from "@/lib/reports/report-summary-repository";
import type { AiConversationMessage } from "@/lib/ai/ai";
import type { ReportAiSummary } from "@/lib/reports/report-summary";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { beginDeletion, restorationSuppression } from "@/lib/operations/deletion-ledger";

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
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      const conversationIds: string[] = []; const reportIds: string[] = []; const summaryInputs: Omit<ReportAiSummary, "id" | "createdAt">[] = [];
      const retryKeys: string[] = []; const hiddenIds: string[] = [];
      for (const actor of actors) {
        const fixture = aiHistoryRecoveryFixture(new ObjectId(actor.userId)); const row = fixture.summary;
        const first = await conversations.createForActor(actor, fixture.conversation.title, fixture.conversation.messages as AiConversationMessage[]);
        conversationIds.push(first.id);
        await conversations.appendForActor(actor, first.id, 1, (fixture.conversation.messages as AiConversationMessage[]).map(message => ({ ...message, id: randomUUID() })));
        const input: Omit<ReportAiSummary, "id" | "createdAt"> = { evidence: row.evidence, model: row.model, policyVersion: row.policyVersion,
          provider: row.provider, reportId: row.reportId.toHexString(), reportSourceFingerprint: row.reportSourceFingerprint, response: row.response, usage: row.usage, version: 1 };
        summaryInputs.push(input); reportIds.push(input.reportId); const retry = randomUUID(); retryKeys.push(retry);
        const hidden = await summaries.createForActor(actor, input, retry); hiddenIds.push(hidden.id);
        await summaries.deleteForActor(actor, hidden.id, 1);
        await summaries.createForActor(actor, { ...input, version: 2 }, randomUUID());
      }
      const names = ["aiConversations", "reportAiSummaries"];
      const records: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []]));
      for (const name of names) records[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const pack = createBackupPackage(records, initialRecoverySchemas, digest, key); expect(pack.manifest.releaseAllowed).toBe(false);
      const opened = openBackupPackage(pack, initialRecoverySchemas, digest, key); const now = Date.now();
      const { isSuppressed } = restorationSuppression({ environment: "isolated-test", keys: [key], now, ledgerReadAt: now, maxLedgerAgeMs: 0,
        authoritativeRevision: 1, suppliedRevision: 1, receipts: [beginDeletion(actors[0]!, "isolated-test", randomUUID(), now, key)] });
      const restoredConversations = aiConversationRepositoryForDatabase(target.database); await restoredConversations.ensureIndexes();
      const restoredSummaries = reportSummaryRepositoryForDatabase(target.database); await restoredSummaries.ensureIndexes();
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
      // Canonical source ownership and current individual history deletion are separate release barriers.
    } finally { if (target) await target.dispose(); await source.dispose(); }
  }, 30000);
});
