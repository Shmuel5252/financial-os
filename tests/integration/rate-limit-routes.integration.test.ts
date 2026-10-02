import { createHash, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { actAs, call, fingerprint, newActor, openHarness, type Harness } from "../security/route-harness";
import { captureOutput, dump, expectNoSentinel, sentinels } from "../security/log-capture";
import { rateLimitMatrix } from "../security/rate-limit-matrix";

// Phase 18 row 18-05: limiter behaviour through the REAL route handlers on a loopback MongoDB (synthetic data only):
// the 429 response, budget accounting order, anonymous callers, and a failing limiter store. Provider-cost reproductions use
// counting stubs in place of Anthropic/Financy - nothing leaves the machine.
const uri = process.env.MONGODB_TEST_URI;
const limiterFault = vi.hoisted(() => ({ error: undefined as Error | undefined, refuse: false, calls: [] as { kind: string; scope: string; userId: string }[] }));
vi.mock("@/lib/auth/actor", async () => (await import("../security/route-harness")).mockedActorModule());
const providerCalls = vi.hoisted(() => ({ count: 0, barrier: 0, waiting: [] as (() => void)[] }));
vi.mock("@/lib/adapters/anthropic/anthropic-ai-provider", () => ({
  getAnthropicAiProvider: () => ({ generate: async (request: { context: { sourceReferences: readonly { alias: string }[] } }) => {
    providerCalls.count += 1;
    if (providerCalls.barrier > 0) { // hold every request at the provider until all have arrived: a deterministic race
      await new Promise<void>((resolve, reject) => {
        providerCalls.waiting.push(resolve);
        if (providerCalls.waiting.length === providerCalls.barrier) for (const release of providerCalls.waiting.splice(0)) release();
        setTimeout(() => reject(new Error("provider barrier timeout")), 10_000);
      });
    }
    return { model: "synthetic-model", provider: "anthropic" as const, usage: { inputTokens: 1, outputTokens: 1 },
      response: { fact: [{ evidenceRefs: [request.context.sourceReferences[0]?.alias ?? "report.fact.1"], text: "synthetic" }], insight: [], recommendation: [] } };
  } }),
}));
vi.mock("@/lib/security/rate-limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limiter")>();
  const { RateLimitedError } = await import("@/lib/errors/application-error");
  // refuse: record (kind, scope, userId) and refuse every call, so a route that really consumes its limiter answers 429 untouched.
  const record = (kind: string, actor: Actor, scope: string) => { limiterFault.calls.push({ kind, scope, userId: actor.userId }); throw new RateLimitedError(); };
  return { ...actual,
    consumeMutationRateLimit: async (actor: Actor, scope: string) => {
      if (limiterFault.refuse) record("mutation", actor, scope);
      if (limiterFault.error) { const error = limiterFault.error; limiterFault.error = undefined; throw error; }
      return actual.consumeMutationRateLimit(actor, scope);
    },
    consumeAiRequestRateLimit: async (actor: Actor) => {
      if (limiterFault.refuse) record("ai", actor, "ai-copilot");
      return actual.consumeAiRequestRateLimit(actor);
    } };
});

/** The routes use the real clock and a fixed 60 s window: start a 31-request sequence early in a window so it cannot straddle a reset. */
async function freshWindow(): Promise<void> {
  const intoWindow = Date.now() % 60_000;
  if (intoWindow > 35_000) await new Promise((resolve) => setTimeout(resolve, 60_000 - intoWindow + 50));
}
const preferences = (expectedVersion: number | null) => ({ emailEnabled: false, expectedVersion, inAppEnabled: true, quietHours: { enabled: false, endHour: 7, startHour: 22 } });

const ils = (amount: string) => ({ amount, currency: "ILS" });
async function seedProfileAndAccount(): Promise<string> {
  const profile = await call("profile", "PUT", { body: { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" } });
  expect(profile.status, profile.text.slice(0, 300)).toBe(200);
  return post("accounts", { balance: ils("5000.00"), name: "Synthetic account", type: "bank" });
}
async function post(section: string, fields: unknown): Promise<string> {
  const response = await call("financial-data/[section]", "POST", { params: { section }, body: { idempotencyKey: randomUUID(), fields } });
  expect(response.status, response.text.slice(0, 300)).toBe(201); return (response.json as { record: { id: string } }).record.id;
}
/** A synthetic personal report for 2026-09 with one expense, so the AI summary has deterministic facts to explain. */
async function seedClosedReport(): Promise<string> {
  const account = await seedProfileAndAccount();
  await post("transactions", { accountId: account, amount: ils("120.00"), category: "food", confidenceBps: 10_000, date: "2026-09-05",
    destinationAccountId: null, merchant: "Synthetic merchant", notes: null, recurring: false, type: "expense" });
  await freshWindow();
  const close = await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" }, scope: { kind: "personal" } } });
  expect(close.status, close.text.slice(0, 300)).toBe(201);
  return (close.json as { report: { id: string } }).report.id;
}
const summarize = (reportId: string, expectedSummaryVersion: number | null, idempotencyKey: string = randomUUID()) =>
  call("report-summaries", "POST", { body: { expectedSummaryVersion, idempotencyKey, reportId } });

(uri ? describe : describe.skip)("rate limits through real routes (18-05)", () => {
  let h: Harness;
  beforeAll(async () => { h = await openHarness(uri!); });
  afterAll(async () => { await h.dispose(); });

  it("[rlx-429-safe] the 31st write in a window is refused with a fixed 429 body: no ids, scope, key, retry hint or log line", async () => {
    const s = sentinels(); const actor = newActor(); actAs(actor);
    await freshWindow();
    for (let i = 0; i < 30; i += 1) expect([200, 409]).toContain((await call("notification-preferences", "PUT", { body: preferences(null) })).status);
    const calls = captureOutput();
    const routeModule = await import("@/app/api/notification-preferences/route");
    const response = await routeModule.PUT(new Request("http://localhost:3001/api/notification-preferences", {
      method: "PUT", headers: { origin: "http://localhost:3001", "content-type": "application/json" }, body: JSON.stringify({ ...preferences(null), note: s.email }),
    }));
    const text = await response.text();
    expect(response.status).toBe(429);
    expect(JSON.parse(text)).toEqual({ correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/), error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." } });
    expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-type"]); // no Retry-After / X-RateLimit-*
    expect(response.headers.get("cache-control")).toBe("no-store");
    for (const value of [actor.userId, "notification-preferences"]) expect(text).not.toContain(value);
    expect(text).not.toMatch(/[0-9a-f]{64}/); // never the counter key's user hash
    expect(calls).toEqual([]); // a refusal is not logged
    expectNoSentinel(text + dump(calls.flat()), s, "429 response");
  }, 90_000);

  it("[rlx-invalid-consumes] invalid requests consume the budget (the limiter runs before body parsing), refused origins and anonymous calls do not", async () => {
    const actor = newActor(); actAs(actor);
    await freshWindow();
    for (let i = 0; i < 5; i += 1) expect((await call("notification-preferences", "PUT", { origin: "https://evil.example" , body: preferences(null) })).status).toBe(403);
    actAs(null);
    for (let i = 0; i < 5; i += 1) expect((await call("notification-preferences", "PUT", { body: preferences(null) })).status).toBe(401);
    const actorKey = createHash("sha256").update(actor.userId).digest("hex");
    expect(await h.db.collection("rateLimits").countDocuments({ _id: { $regex: `^notification-preferences:${actorKey}:` } as never }), "refused origins/anonymous calls consumed nothing").toBe(0);
    actAs(actor);
    for (let i = 0; i < 30; i += 1) expect((await call("notification-preferences", "PUT", { body: { garbage: true } })).status).toBe(400);
    expect((await call("notification-preferences", "PUT", { body: preferences(null) })).status).toBe(429);
  }, 90_000);

  it("[rlx-store-failure] a failing limiter store fails the request closed: 500, generic body, no work done, one literal log line", async () => {
    const actor = newActor(); actAs(actor);
    const before = await fingerprint(h.db);
    limiterFault.error = Object.assign(new Error("connection 3 to 127.0.0.1:27017 closed"), { name: "MongoNetworkError" });
    const calls = captureOutput();
    const response = await call("notification-preferences", "PUT", { body: preferences(null) });
    expect(response.status).toBe(500);
    expect(response.json).toEqual({ correlationId: expect.any(String), error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
    expect(await fingerprint(h.db)).toEqual(before); // nothing was written: the limiter runs before the work
    expect(calls.map(([level, message]) => [level, message])).toEqual([["error", "Unhandled route error"]]);
  });

  it("[rlx-anonymous-no-key] anonymous callers never get a limiter key (they are refused before the limiter)", async () => {
    actAs(null);
    const before = await h.db.collection("rateLimits").countDocuments();
    for (const [route, method] of [["notification-preferences", "PUT"], ["households", "POST"], ["reports/export", "GET"]] as const) {
      expect((await call(route, method, method === "GET" ? { query: { format: "json" } } : { body: {} })).status).toBe(401);
    }
    expect(await h.db.collection("rateLimits").countDocuments()).toBe(before);
  });

  it("[rlx-summary-provider-budget] AI report summaries reach the provider 30 times a minute (mutation budget), not 10 an hour; concurrent requests all reach it (F-18-05-01)", async () => {
    const actor = newActor(); actAs(actor);
    const reportId = await seedClosedReport();
    // Concurrency: 5 simultaneous first summaries (same expected version) all pass the version check and all call the provider.
    providerCalls.count = 0; providerCalls.barrier = 5;
    const logged = captureOutput();
    let burst: Awaited<ReturnType<typeof call>>[];
    try { burst = await Promise.all(Array.from({ length: 5 }, () => call("report-summaries", "POST", { body: { expectedSummaryVersion: null, idempotencyKey: randomUUID(), reportId } }))); }
    finally { providerCalls.barrier = 0; providerCalls.waiting.splice(0); }
    expect(providerCalls.count, burst.map((r) => r.text.slice(0, 200)).join(" | ")).toBe(5);
    // The version race is settled only by the unique (userId, reportId, version) index AFTER the paid call: the losers are 500s.
    expect(burst.map((response) => response.status).sort()).toEqual([201, 500, 500, 500, 500]);
    expect(logged.filter(([level]) => level === "error").map(([level, message]) => [level, message])).toEqual(Array.from({ length: 4 }, () => ["error", "Unhandled route error"]));
    // Sequential regeneration: every request that carries the current version is another provider call, until the 30/min budget.
    let version = Math.max(...(await h.db.collection("reportAiSummaries").find({ userId: new ObjectId(actor.userId) }).toArray()).map((d) => d.version as number));
    for (let i = 5; i < 30; i += 1) {
      const response = await call("report-summaries", "POST", { body: { expectedSummaryVersion: version, idempotencyKey: randomUUID(), reportId } });
      expect(response.status, response.text.slice(0, 300)).toBe(201); version += 1;
    }
    expect(providerCalls.count).toBe(30); // 3x the copilot's hourly AI budget inside one minute; ~1,800/hour sustained
    expect((await call("report-summaries", "POST", { body: { expectedSummaryVersion: version, idempotencyKey: randomUUID(), reportId } })).status).toBe(429);
    expect(providerCalls.count).toBe(30);
    const actorKey = createHash("sha256").update(actor.userId).digest("hex");
    expect(await h.db.collection("rateLimits").countDocuments({ _id: { $regex: `^ai-copilot:${actorKey}:` } as never }), "the AI policy is never consulted").toBe(0);
  }, 90_000);

  it("[rlx-summary-replay-and-delete] a replayed key at the current version and any regeneration after deleting the latest summary each pay the provider (F-18-05-01)", async () => {
    actAs(newActor());
    const reportId = await seedClosedReport();
    providerCalls.count = 0;
    const key = randomUUID();
    const first = await summarize(reportId, null, key); expect(first.status).toBe(201);
    const firstSummary = (first.json as { summary: { id: string; version: number } }).summary;
    // Same idempotency key, now-current version: passes the read-only version check, calls the provider, then returns the stored row.
    const replay = await summarize(reportId, firstSummary.version, key);
    expect(replay.status).toBe(201);
    expect((replay.json as { summary: { id: string } }).summary.id).toBe(firstSummary.id);
    expect(providerCalls.count, "a replay is not free").toBe(2);
    // Soft-deleting the latest summary keeps its (userId, reportId, version) slot in the unique index, but the version check ignores
    // deleted rows: every regeneration from then on calls the provider and then fails with a 500 on the duplicate version.
    const removed = await call("report-summaries/[summaryId]", "DELETE", { params: { summaryId: firstSummary.id }, query: { reportId }, body: { expectedVersion: firstSummary.version } });
    expect(removed.status, removed.text.slice(0, 300)).toBe(200);
    const logged = captureOutput();
    for (let i = 0; i < 3; i += 1) expect((await summarize(reportId, null)).status).toBe(500);
    expect(providerCalls.count, "three paid calls, nothing stored").toBe(5);
    expect(logged.filter(([level]) => level === "error").map(([level, message]) => [level, message])).toEqual(Array.from({ length: 3 }, () => ["error", "Unhandled route error"]));
  }, 90_000);

  it("[rlx-budget-far-month] a far-future budget month makes recurring expansion throw after the period is already saved: the write lands, the response is a 500", async () => {
    const actor = newActor(); actAs(actor);
    const account = await seedProfileAndAccount();
    await post("recurring_transactions", { accountId: account, active: true, amount: ils("10.00"), category: "food", endDate: null, frequency: "weekly", interval: 1,
      merchant: null, name: "Synthetic weekly", nextOccurrenceDate: "2026-10-05", startDate: "2026-10-05", type: "expense" });
    const near = await call("budgets/periods", "PUT", { body: { allocations: [], calendarMonth: "2026-11", expectedVersion: null } });
    expect(near.status, near.text.slice(0, 300)).toBe(200);
    const logged = captureOutput();
    const far = await call("budgets/periods", "PUT", { body: { allocations: [], calendarMonth: "2300-01", expectedVersion: null } }); // schema accepts years 1000-9999
    expect(far.status).toBe(500);
    expect(far.json).toEqual({ correlationId: expect.any(String), error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
    expect(logged.filter(([level]) => level === "error").map(([level, message]) => [level, message])).toEqual([["error", "Unhandled route error"]]);
    expect(await h.db.collection("budgetPeriods").countDocuments({ userId: new ObjectId(actor.userId), calendarMonth: "2300-01" }), "the period was persisted before the failure").toBe(1);
  }, 90_000);

  it("[rlx-policies] the exported policies are exactly 30 per 60 s (mutation, per scope) and 10 per hour (AI, scope ai-copilot)", async () => {
    const { consumeAiRequestRateLimit, consumeMutationRateLimit } = await import("@/lib/security/rate-limiter");
    const { RateLimitedError } = await import("@/lib/errors/application-error");
    const actor = newActor(); const actorKey = createHash("sha256").update(actor.userId).digest("hex");
    const counter = async (scope: string) => (await h.db.collection<{ _id: string; count: number; expiresAt: Date }>("rateLimits").find({ _id: { $regex: `^${scope}:${actorKey}:` } }).toArray());
    for (let i = 0; i < 10; i += 1) await consumeAiRequestRateLimit(actor);
    await expect(consumeAiRequestRateLimit(actor)).rejects.toBeInstanceOf(RateLimitedError);
    const [ai] = await counter("ai-copilot"); const aiStart = Number(ai!._id.split(":")[2]);
    expect(aiStart % 3_600_000).toBe(0); expect(ai!.expiresAt.getTime() - aiStart).toBe(2 * 3_600_000);
    await freshWindow();
    await consumeMutationRateLimit(actor, "policy-probe");
    const [mutation] = await counter("policy-probe"); const start = Number(mutation!._id.split(":")[2]);
    expect(start % 60_000).toBe(0); expect(mutation!.expiresAt.getTime() - start).toBe(120_000);
  }, 90_000);

  it("[rlx-route-sweep] every limited route method is refused by its own limiter: 429, exact scope, the actor's own key, nothing written", async () => {
    const id = () => new ObjectId().toHexString();
    const actor = newActor(); actAs(actor);
    const limited = Object.entries(rateLimitMatrix).filter(([key, entry]) => key.includes(" api/") && (entry.policy === "mutation" || entry.policy === "ai"));
    expect(limited).toHaveLength(59);
    const before = await fingerprint(h.db);
    limiterFault.refuse = true;
    try {
      for (const [key, entry] of limited) {
        const [method, path] = key.split(" ") as [string, string];
        const route = path.slice("api/".length);
        const params = Object.fromEntries([...route.matchAll(/\[([A-Za-z]+)\]/g)].map(([, name]) => [name!, name === "section" ? "accounts" : id()]));
        limiterFault.calls = [];
        const response = await call(route, method, { params, ...(method === "GET" ? {} : { body: {} }) });
        const scope = entry.policy === "ai" ? "ai-copilot" : entry.scope!.replace(/^`|`$/g, "").replace("${section}", "accounts");
        expect(response.status, `${key}: refused by its limiter`).toBe(429);
        expect(limiterFault.calls, `${key}: exactly one limiter call, own scope, keyed on the actor`).toEqual([{ kind: entry.policy, scope, userId: actor.userId }]);
        if (route.includes("[section]")) { // a templated scope is built only from a validated section: an invalid one never reaches the limiter
          limiterFault.calls = [];
          const invalid = await call(route, method, { params: { ...params, section: "not-a-section" }, ...(method === "GET" ? {} : { body: {} }) });
          expect(invalid.status, `${key}: invalid section`).not.toBe(429);
          expect(limiterFault.calls, `${key}: no budget for an invalid section`).toEqual([]);
        }
      }
    } finally { limiterFault.refuse = false; }
    expect(await fingerprint(h.db), "a refused request writes nothing").toEqual(before);
  }, 120_000);
});
