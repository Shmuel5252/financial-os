import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import type { AiProvider } from "@/lib/ai/ai-provider";
import { aiConversationRepositoryForDatabase } from "@/lib/ai/ai-conversation-repository";
import type { AiTelemetryEvent, AiTelemetrySink } from "@/lib/ai/ai-telemetry";
import { deleteAiConversation, listAiConversations, sendAiMessage } from "@/lib/ai/ai-service";
import {
  calculateFinancialEngine,
  type FinancialEngineInput,
} from "@/lib/domain/financial-engine/financial-engine";
import { money } from "@/lib/domain/money/money";
import { DependencyUnavailableError, NotFoundError } from "@/lib/errors/application-error";
import type { FinancialEngineSnapshot } from "@/lib/financial-engine/financial-engine-snapshot";

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("Phase 8 AI persistence, minimization, and isolation", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured");
  const firstActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const secondActor: Actor = { kind: "user", userId: new ObjectId().toHexString() };
  const now = new Date("2026-09-01T10:00:00.000Z");
  let database: Db;
  let repository: ReturnType<typeof aiConversationRepositoryForDatabase>;

  function engineSnapshot(): FinancialEngineSnapshot {
    const input: FinancialEngineInput = {
      accountBalance: money(1_000_000n, "ILS"),
      actualMonthlyExpenses: money(100_000n, "ILS"),
      actualMonthlyIncome: money(500_000n, "ILS"),
      asOf: "2026-09-01T09:00:00.000Z",
      availableCash: money(1_000_000n, "ILS"),
      creditLimit: money(0n, "ILS"),
      creditUsed: money(0n, "ILS"),
      currency: "ILS",
      debtBalance: money(0n, "ILS"),
      events: [],
      horizonDays: 30,
      monthlyConfirmedIncomeBasis: [],
      safetyMargin: { amount: money(100_000n, "ILS"), kind: "fixed" },
      savingsBalance: money(0n, "ILS"),
      timeZone: "Asia/Jerusalem",
    };
    return {
      calculatedAt: now,
      engineVersion: "financial-engine/1.0.0",
      id: "507f1f77bcf86cd799439012",
      inputHash: "a".repeat(64),
      kind: "engine_result",
      policyVersion: "financial-policy/2026-08-31",
      result: calculateFinancialEngine(input),
      schemaVersion: 1,
      sourceManifestId: "507f1f77bcf86cd799439013",
    };
  }

  beforeAll(async () => {
    await client.connect();
    database = client.db(databaseName);
    repository = aiConversationRepositoryForDatabase(database, () => now);
    await repository.ensureIndexes();
    await database.collection("accounts").insertOne({
      _id: new ObjectId(),
      balance: "canonical-sentinel",
      userId: new ObjectId(firstActor.userId),
    });
    await database.collection("financialSnapshots").insertOne({
      _id: new ObjectId(),
      kind: "canonical-sentinel",
      userId: new ObjectId(firstActor.userId),
    });
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("stores only a sanitized owner-scoped visible exchange and safe telemetry", async () => {
    const capturedContexts: unknown[] = [];
    const telemetry: AiTelemetryEvent[] = [];
    const provider: AiProvider = {
      generate: vi.fn(async (request) => {
        capturedContexts.push(request.context);
        return {
          model: "claude-test-model",
          provider: "anthropic" as const,
          response: {
            fact: [{ evidenceRefs: ["engine.safe_to_spend"], text: "הסכום הבטוח מבוסס על נתוני המנוע." }],
            insight: [{ evidenceRefs: ["engine.minimum_balance"], text: "מרווח ההוצאה מוגבל לפי נקודת המינימום." }],
            recommendation: [{ evidenceRefs: ["engine.shortfall"], text: "כדאי לעיין בהתחייבויות הקרובות." }],
          },
          usage: { inputTokens: 50, outputTokens: 25 },
        };
      }),
    };
    const sink: AiTelemetrySink = { emit: (event) => telemetry.push(event) };
    const rawSecret = ["sk-ant-", "not-a-real-credential-value"].join("");
    const beforeAccounts = await database.collection("accounts").find({}).toArray();
    const beforeSnapshots = await database.collection("financialSnapshots").find({}).toArray();

    const created = await sendAiMessage(
      firstActor,
      {
        focus: "safe_to_spend",
        includeRecentHistory: false,
        question: `למה הסכום נמוך? api_key=${rawSecret}`,
      },
      {
        loadLatestEngine: async () => engineSnapshot(),
        now: () => now,
        provider,
        repository,
        telemetry: sink,
      },
    );

    expect(created.messages).toHaveLength(2);
    expect(created.messages[0]?.role).toBe("user");
    expect(created.messages[0]?.role === "user" ? created.messages[0].text : "").toContain("[REDACTED_");
    const stored = await database.collection("aiConversations").findOne({ _id: new ObjectId(created.id) });
    const storedText = JSON.stringify(stored);
    expect(stored?.userId).toEqual(new ObjectId(firstActor.userId));
    expect(storedText).not.toContain(rawSecret);
    expect(storedText).not.toContain("systemPrompt");
    expect(storedText).not.toContain("untrustedUserText");
    expect(storedText).not.toContain("rawContext");

    const providerText = JSON.stringify(capturedContexts[0]);
    expect(providerText).not.toContain(firstActor.userId);
    expect(providerText).not.toContain(engineSnapshot().id);
    expect(providerText).not.toContain(rawSecret);
    expect((capturedContexts[0] as { evidence: unknown[] }).evidence).toHaveLength(7);

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toEqual(
      expect.objectContaining({
        errorCategory: null,
        inputTokens: 50,
        outputTokens: 25,
        status: "success",
      }),
    );
    const telemetryText = JSON.stringify(telemetry);
    expect(telemetryText).not.toContain(firstActor.userId);
    expect(telemetryText).not.toContain("273000");
    expect(telemetryText).not.toContain("למה");

    expect(await database.collection("accounts").find({}).toArray()).toEqual(beforeAccounts);
    expect(await database.collection("financialSnapshots").find({}).toArray()).toEqual(beforeSnapshots);

    const continued = await sendAiMessage(
      firstActor,
      {
        conversationId: created.id,
        expectedVersion: created.version,
        focus: "safe_to_spend",
        includeRecentHistory: true,
        question: "מה כדאי לבדוק עכשיו?",
      },
      {
        loadLatestEngine: async () => engineSnapshot(),
        now: () => now,
        provider,
        repository,
        telemetry: sink,
      },
    );
    expect(continued.version).toBe(2);
    expect(continued.messages).toHaveLength(4);
    expect((capturedContexts[1] as { untrustedRecentHistory: unknown[] }).untrustedRecentHistory).toHaveLength(2);
  });

  it("prevents cross-user reads, continuation, and deletion", async () => {
    const owned = (await listAiConversations(firstActor, 10, { repository }))[0];
    expect(owned).toBeDefined();
    expect(await listAiConversations(secondActor, 10, { repository })).toHaveLength(0);
    expect(await repository.findForActor(secondActor, owned?.id ?? "")).toBeNull();
    await expect(
      sendAiMessage(
        secondActor,
        {
          conversationId: owned?.id,
          expectedVersion: owned?.version,
          focus: "safe_to_spend",
          includeRecentHistory: false,
          question: "נסה לפתוח שיחה זרה",
        },
        { repository },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteAiConversation(secondActor, owned?.id ?? "", owned?.version ?? 0, { repository }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await repository.findForActor(firstActor, owned?.id ?? "")).not.toBeNull();
  });

  it("hard-deletes only the owned conversation and leaves canonical financial data unchanged", async () => {
    const owned = (await listAiConversations(firstActor, 10, { repository }))[0];
    const accountsBefore = await database.collection("accounts").find({}).toArray();
    const snapshotsBefore = await database.collection("financialSnapshots").find({}).toArray();
    await deleteAiConversation(firstActor, owned?.id ?? "", owned?.version ?? 0, { repository });
    expect(await listAiConversations(firstActor, 10, { repository })).toHaveLength(0);
    expect(await database.collection("accounts").find({}).toArray()).toEqual(accountsBefore);
    expect(await database.collection("financialSnapshots").find({}).toArray()).toEqual(snapshotsBefore);
  });

  it("records only safe failure metadata and creates no partial conversation", async () => {
    const telemetry: AiTelemetryEvent[] = [];
    const before = await database.collection("aiConversations").countDocuments({});
    await expect(
      sendAiMessage(
        firstActor,
        {
          focus: "safe_to_spend",
          includeRecentHistory: false,
          question: "הסבר את תמונת המצב",
        },
        {
          loadLatestEngine: async () => engineSnapshot(),
          provider: {
            generate: async () => {
              throw new DependencyUnavailableError("Safe provider failure.");
            },
          },
          repository,
          telemetry: { emit: (event) => telemetry.push(event) },
        },
      ),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(await database.collection("aiConversations").countDocuments({})).toBe(before);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toEqual(
      expect.objectContaining({
        errorCategory: "DEPENDENCY_UNAVAILABLE",
        inputTokens: null,
        outputTokens: null,
        status: "failure",
      }),
    );
    expect(JSON.stringify(telemetry)).not.toContain("הסבר");
  });

  it("creates owner-first indexes for conversation reads and concurrency", async () => {
    const indexes = await database.collection("aiConversations").listIndexes().toArray();
    for (const name of ["ai_conversations_owner_updated", "ai_conversations_owner_version"]) {
      const index = indexes.find((candidate) => candidate.name === name);
      expect(index).toBeDefined();
      expect(Object.keys(index?.key ?? {})[0]).toBe("userId");
    }
  });
});
