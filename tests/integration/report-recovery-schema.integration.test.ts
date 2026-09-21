import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { financialReportRepositoryForDatabase } from "@/lib/reports/report-repository";
import { calculateFinancialReport } from "@/lib/domain/reports/report-engine";
import { money } from "@/lib/domain/money/money";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { projectRecoveryReport } from "@/lib/operations/report-recovery-schema";

const uri = process.env.MONGODB_TEST_URI;
(uri ? describe : describe.skip)("real saved-report recovery schema and integrity", () => {
  it("preserves actual repository BSON/hash, exact money, restatement and owner isolation", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const repo = financialReportRepositoryForDatabase(source.database); const restored = financialReportRepositoryForDatabase(target.database);
      await repo.ensureIndexes(); await restored.ensureIndexes();
      const actor = { kind: "user" as const, userId: new ObjectId().toHexString() };
      const foreign = { kind: "user" as const, userId: new ObjectId().toHexString() };
      const report = calculateFinancialReport({ accounts: [{ id: new ObjectId().toHexString(), amount: money(9007199254740993n, "ILS"), label: "Synthetic", version: 1 }],
        budget: [], goals: [], liabilities: [], netWorth: [], savings: [], subscriptions: [], transactions: [],
        generatedAt: new Date(0).toISOString(), timeZone: "Asia/Jerusalem", period: { kind: "month", value: "2026-09" }, scope: { kind: "personal" } });
      const first = await repo.createForActor(actor, { authorizationFingerprint: null, idempotencyKey: randomUUID(),
        idempotencyPayload: { kind: "synthetic" }, report, restatementReason: null, supersedes: null });
      await repo.createForActor(actor, { authorizationFingerprint: null, idempotencyKey: randomUUID(),
        idempotencyPayload: { kind: "synthetic-restatement" }, report, restatementReason: "Synthetic correction", supersedes: first });
      await repo.hideForActor(actor, first.id, first.version);
      const rows = await source.database.collection("financialReports").find().toArray();
      const input: Record<string, Document[]> = Object.fromEntries(recoveryCollections.map(name => [name, []])); input.financialReports = rows;
      const key = { version: 1, material: randomBytes(32) }; const digest = "a".repeat(64);
      const opened = openBackupPackage(createBackupPackage(input, initialRecoverySchemas, digest, key), initialRecoverySchemas, digest, key);
      await target.database.collection("financialReports").insertMany(opened.financialReports!);
      for (const row of rows) {
        expect(BSON.serialize((await target.database.collection("financialReports").findOne({ _id: row._id }))!)).toEqual(BSON.serialize(row));
        expect(await restored.findForActor(foreign, row._id.toHexString(), true)).toBeNull();
        expect((await restored.findForActor(actor, row._id.toHexString(), true))!.report.sections.accounts[0]!.amount.amountMinor).toBe(9007199254740993n);
        for (const tampered of [{ ...row, payloadHash: "0".repeat(64) }, { ...row, unexpected: true },
          { ...row, report: { ...row.report, hiddenPrivateField: "synthetic" } }, { ...row, auditTrail: [{ ...row.auditTrail[0], actorUserId: new ObjectId() }] }])
          expect(() => projectRecoveryReport(tampered)).toThrow("Report recovery validation failed");
      }
      expect(await restored.findForActor(actor, first.id)).toBeNull();
      expect(await source.database.collection("financialReports").countDocuments()).toBe(2);
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});
