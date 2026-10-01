import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { aiConversationRepositoryForDatabase } from "@/lib/ai/ai-conversation-repository";
import { sendAiMessage } from "@/lib/ai/ai-service";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";
import { captureOutput, dump, expectNoSentinel, hostile, sentinels } from "../security/log-capture";

// Phase 18 rows 18-07/18-20: the real AI service, repository and DEFAULT console telemetry sink, fed a question, a provider
// response and a provider failure that all carry synthetic secrets, contact data, ids, amounts and financial text.
const testUri = process.env.MONGODB_TEST_URI;

(testUri ? describe : describe.skip)("AI service logging sentinels (18-07/18-20)", () => {
  const client = new MongoClient(testUri ?? "mongodb://not-configured");
  let database: Db;
  const s = sentinels();
  const actor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const engine = (): FinancialEngineSnapshot => ({
    calculatedAt: new Date(), engineVersion: "financial-engine/1.0.0", id: new ObjectId().toHexString(), inputHash: "a".repeat(64), kind: "engine_result",
    policyVersion: "financial-policy/2026-08-31", schemaVersion: 1, sourceManifestId: new ObjectId().toHexString(),
    result: calculateFinancialEngine({ accountBalance: money(BigInt(s.amountMinor), "ILS"), actualMonthlyExpenses: money(100_000n, "ILS"), actualMonthlyIncome: money(500_000n, "ILS"),
      asOf: "2026-09-01T09:00:00.000Z", availableCash: money(BigInt(s.amountMinor), "ILS"), creditLimit: money(0n, "ILS"), creditUsed: money(0n, "ILS"), currency: "ILS",
      debtBalance: money(0n, "ILS"), events: [], horizonDays: 30, monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: money(100_000n, "ILS"), kind: "fixed" },
      savingsBalance: money(0n, "ILS"), timeZone: "Asia/Jerusalem" }),
  });

  beforeAll(async () => { await client.connect(); database = client.db(`financial_os_log_sentinel_${randomUUID().replaceAll("-", "")}`); });
  afterAll(async () => { await database.dropDatabase(); await client.close(); });

  it("[log-ai-service-path] logs only projected telemetry for a successful and a failed AI call", async () => {
    const repository = aiConversationRepositoryForDatabase(database, () => new Date());
    await repository.ensureIndexes();
    const calls = captureOutput();
    const question = `${s.merchant} ${s.hebrewNote} ${s.email} ${s.amountText}`;
    const created = await sendAiMessage(actor, { focus: "safe_to_spend", includeRecentHistory: false, question }, {
      loadLatestEngine: async () => engine(), repository,
      provider: { generate: async () => ({ model: s.merchant, provider: "anthropic" as const, usage: { inputTokens: 50, outputTokens: 25 },
        response: { fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: s.hebrewNote }], insight: [], recommendation: [] } }) },
    });
    await expect(sendAiMessage(actor, { focus: "safe_to_spend", includeRecentHistory: false, question }, {
      loadLatestEngine: async () => engine(), repository,
      provider: { generate: async () => { throw Object.assign(hostile(s).error as Error, { providerCategory: `TIMEOUT ${s.email}` }); } },
    })).rejects.toBeDefined();
    expect(created.messages).toHaveLength(2);
    expect(calls.map(([level, message]) => [level, message])).toEqual([["info", "AI provider telemetry"], ["warn", "AI provider telemetry"]]);
    expect(calls[1]![2]).toMatchObject({ status: "failure", errorCategory: "UNKNOWN_FAILURE" });
    const text = dump(calls.flat());
    expectNoSentinel(text, s, "AI service telemetry");
    expect(text).not.toContain(actor.userId); expect(text).not.toContain(created.id);
  }, 30_000);
});
