import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { inspectFile } from "../../scripts/security-check.mjs";
import { capabilityEnabled, assertCapabilityEnabled } from "@/lib/operations/controls";
import { safeProviderTelemetry } from "@/lib/operations/safe-telemetry";
import { erasurePlan } from "@/lib/operations/erasure-plan";
import { recoveryCollections, projectAuthLink } from "@/lib/operations/recovery-plan";
import { rehearseLoad, summarizeLoad, validateLoadTarget, type LoadTarget } from "@/lib/operations/load-rehearsal";
import { boundedReadiness, evaluateReadiness } from "@/lib/operations/readiness";
import { readJsonBody } from "@/lib/http/request-guards";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetModules(); vi.doUnmock("@/lib/auth/actor"); vi.doUnmock("@/lib/db/mongodb"); });

describe("Phase 18 operational safety", () => {
  it("rejects oversized chunked input before reading its remaining payload", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16_385)); }, cancel });
    const request = new Request("http://localhost:3001/api/profile", { method: "POST", body, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
    await expect(readJsonBody(request)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(cancel).toHaveBeenCalled();
    expect(await readJsonBody(new Request("http://localhost:3001/api/profile", { method: "POST", body: '{"label":"שלום"}', headers: { "content-type": "application/json" } }))).toEqual({ label: "שלום" });
  });
  it("rejects private artifacts and known credentials without returning contents", () => {
    for (const file of [".env.local", "nested/.env", "key.pem", "backup.bson", ".vercel/project.json"]) expect(inspectFile(file, "").length).toBeGreaterThan(0);
    expect(inspectFile(".env.example", "PLACEHOLDER=")).toEqual([]);
    expect(inspectFile("src/config.ts", "NEXT_PUBLIC_" + "SECRET=fixture")).toEqual(["public-secret-binding"]);
    expect(inspectFile("src/config.ts", "sk-ant-" + "api03-" + "x".repeat(40))).toEqual(["provider-token"]);
  });
  it("minimizes telemetry at runtime even with malicious extra fields and model/error labels", () => {
    const marker = "SYNTHETIC_PRIVATE";
    const event = { durationMs: 3, status: "failure", retryCount: 0, errorCategory: marker, model: marker, token: marker, requestId: marker, inputTokens: Infinity };
    const output = safeProviderTelemetry(event, "anthropic");
    expect(JSON.stringify(output)).not.toContain(marker);
    expect(output.errorCategory).toBe("UNKNOWN_FAILURE"); expect(output.inputTokens).toBeNull();
  });
  it("defaults controls to unchanged behavior and disables malformed explicit settings", () => {
    expect(capabilityEnabled("ai", {})).toBe(true);
    expect(capabilityEnabled("ai", { OPERATIONS_DISABLE_AI: "false" })).toBe(true);
    for (const value of ["true", "TRUE", "yes", "secret"]) expect(capabilityEnabled("ai", { OPERATIONS_DISABLE_AI: value })).toBe(false);
    vi.stubEnv("OPERATIONS_DISABLE_AI", "true");
    expect(() => assertCapabilityEnabled("ai")).toThrow();
    expect(capabilityEnabled("bankRefresh", {})).toBe(true);
  });
  it("blocks AI and paid refresh before dependency or financial work", async () => {
    vi.stubEnv("OPERATIONS_DISABLE_AI", "true"); vi.stubEnv("OPERATIONS_DISABLE_BANK_REFRESH", "true");
    const { sendAiMessage } = await import("@/lib/ai/ai-service");
    const { requestOpenBankingRefresh } = await import("@/lib/open-banking/open-banking-service");
    const actor = { kind: "user" as const, userId: "100000000000000000000001" };
    await expect(sendAiMessage(actor, {} as Parameters<typeof sendAiMessage>[1])).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    await expect(requestOpenBankingRefresh(actor, "synthetic")).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  });
  it("cannot smuggle nested credentials through identity linkage", () => {
    expect(() => projectAuthLink({ _id: { token: "fixture" }, userId: "100000000000000000000001", provider: "google", type: "oauth", providerAccountId: "fixture" })).toThrow("Invalid recovery linkage");
  });
  it("classifies every collection for erasure review without authorizing deletion or retention", () => {
    const plan = erasurePlan(); expect(plan.map(item => item.collection)).toEqual(recoveryCollections);
    expect(plan.every(item => !item.execute && item.release === "owner-policy-pending")).toBe(true);
  });
  it("keeps HTTP liveness independent of a failing Mongo readiness path", async () => {
    const operator = "100000000000000000000001";
    vi.stubEnv("OPERATIONS_OPERATOR_USER_IDS", operator);
    vi.doMock("@/lib/auth/actor", () => ({ requireActor: async () => ({ kind: "user", userId: operator }) }));
    vi.doMock("@/lib/db/mongodb", () => ({ getDatabase: async () => { throw new Error("SYNTHETIC_URI_PASSWORD"); } }));
    const readiness = await import("@/app/api/ops/readiness/route");
    const response = await readiness.GET();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "unavailable" });
    const liveness = await import("@/app/api/health/route");
    const alive = liveness.GET(); expect(alive.status).toBe(200);
    expect(await alive.json()).toEqual({ service: "financial-os", status: "ok" });
  });
  it("does not start a database probe after slow authentication exceeds the response budget", async () => {
    vi.useFakeTimers();
    const probe = vi.fn();
    const operation = evaluateReadiness({ operatorIds: ["fixture"], deadlineAt: Date.now() + 5_000,
      authenticate: () => new Promise(resolve => setTimeout(() => resolve({ kind: "user", userId: "fixture" }), 6_000)), probe });
    const result = boundedReadiness(operation);
    await vi.advanceTimersByTimeAsync(5_000); expect((await result).status).toBe(503);
    await vi.advanceTimersByTimeAsync(1_000); await operation; expect(probe).not.toHaveBeenCalled();
  });
  it("protects heavy export routes without adding OAuth protocol throttling", () => {
    for (const file of ["src/app/api/financial-data/export/route.ts", "src/app/api/reports/export/route.ts"]) {
      const text = readFileSync(file, "utf8"); expect(text).toContain("await consumeMutationRateLimit(actor,");
      expect(text.indexOf("await requireActor()")).toBeLessThan(text.indexOf("await consumeMutationRateLimit("));
    }
    expect(readFileSync("src/app/api/auth/[...nextauth]/route.ts", "utf8")).not.toContain("RateLimit");
  });
});

const target: LoadTarget = { origin: "http://localhost:3001", environment: "isolated-local", syntheticUsers: 10, durationMs: 1_800_000, operatorApprovedFixture: true };
describe("non-network synthetic load harness", () => {
  it("rejects staging, production, wrong port, credentials and unapproved scope", () => {
    for (const origin of ["https://financial-os-staging-nine.vercel.app", "https://production.invalid", "http://localhost:3000", "http://user:pass@localhost:3001", "http://localhost:3001/?x=1"]) expect(() => validateLoadTarget({ ...target, origin })).toThrow();
    expect(() => validateLoadTarget({ ...target, operatorApprovedFixture: false })).toThrow();
  });
  it("runs ten injected synthetic users and emits only aggregate measurements", async () => {
    let now = 0;
    const result = await rehearseLoad(target, { now: () => now, pause: async () => { now = 1_800_000; }, execute: async () => ({ durationMs: 5, outcome: "ok", phase: "cold" }) });
    expect(result.requests).toBe(10); expect(result.p95).toBe(5); expect(result.errorRate).toBe(0);
  });
  it("bounds stalled executors and aborts without dispatching overlapping retries", async () => {
    vi.useFakeTimers(); const signals: AbortSignal[] = [];
    const result = rehearseLoad(target, { now: Date.now, pause: async () => {}, execute: async (_user, _operation, signal) => { signals.push(signal); return new Promise(() => {}); } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).timeouts).toBe(10); expect(signals.every(signal => signal.aborted)).toBe(true);
  });
  it("calculates percentiles and represents no traffic as unknown rather than success", () => {
    expect(summarizeLoad([]).errorRate).toBeNull();
    const output = summarizeLoad([1, 2, 100].map(durationMs => ({ durationMs, outcome: "timeout", phase: "warm" })));
    expect(output.p50).toBe(2); expect(output.p99).toBe(100); expect(output.errorRate).toBe(1);
  });
});
