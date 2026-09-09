import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedReadiness, evaluateReadiness, parseOperatorAllowlist, singleFlightProbe } from "@/lib/operations/readiness";
import { UnauthenticatedError } from "@/lib/errors/application-error";

const operator = "100000000000000000000001";
const other = "100000000000000000000002";
const actor = (userId = operator) => ({ kind: "user" as const, userId });

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("metadata-only readiness", () => {
  it("fails closed for absent, malformed, wildcard, email, empty-entry and oversized allowlists", () => {
    for (const value of [undefined, "", "*", "admin@example.invalid", `${operator},`, `${operator},bad`, "x".repeat(2501)]) {
      expect(parseOperatorAllowlist(value)).toEqual([]);
    }
    expect(parseOperatorAllowlist(` ${operator},${operator}, ${other} `)).toEqual([operator, other]);
  });

  it("does no auth or probe work while disabled", async () => {
    const authenticate = vi.fn(); const probe = vi.fn();
    expect(await evaluateReadiness({ authenticate, probe, operatorIds: [] })).toEqual({ status: 403, category: "forbidden" });
    expect(authenticate).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
  });

  it("denies anonymous and second users before probing", async () => {
    const probe = vi.fn();
    expect(await evaluateReadiness({ authenticate: async () => { throw new UnauthenticatedError(); }, probe, operatorIds: [operator] })).toEqual({ status: 401, category: "authentication_required" });
    expect(await evaluateReadiness({ authenticate: async () => actor(other), probe, operatorIds: [operator] })).toEqual({ status: 403, category: "forbidden" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns only a bounded category for a successful authorized probe", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    expect(await evaluateReadiness({ authenticate: async () => actor(), probe, operatorIds: [operator] })).toEqual({ status: 200, category: "ready" });
    expect(probe).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not log or serialize authentication/database errors and sensitive causes", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const fail = async () => { throw new Error("SYNTHETIC_SECRET_BANK_AMOUNT_HOST_TOKEN", { cause: { secret: "SYNTHETIC_SECRET" } }); };
    for (const dependencies of [
      { authenticate: fail, probe: vi.fn(), operatorIds: [operator] },
      { authenticate: async () => actor(), probe: fail, operatorIds: [operator] },
    ]) expect(await evaluateReadiness(dependencies)).toEqual({ status: 503, category: "unavailable" });
    expect(output).not.toHaveBeenCalled();
  });

  it("bounds slow operations and observes late rejection", async () => {
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    const operation = new Promise<never>((_, failure) => { reject = failure; });
    const result = boundedReadiness(operation);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 503, category: "unavailable" });
    reject(new Error("synthetic late failure"));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears deadline timers on early completion and handles unexpected rejection", async () => {
    vi.useFakeTimers();
    expect(await boundedReadiness(Promise.resolve({ status: 200, category: "ready" }))).toEqual({ status: 200, category: "ready" });
    expect(await boundedReadiness(Promise.reject(new Error("synthetic")))).toEqual({ status: 503, category: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces only probes and permits recovery after failure", async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error("synthetic outage")).mockResolvedValue(undefined);
    const probe = singleFlightProbe(work);
    const first = probe(); const second = probe();
    expect(first).toBe(second);
    await expect(first).rejects.toThrow("synthetic outage");
    await probe();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("wires the route to server actor, ignores request identity, and minimizes cached output", async () => {
    const authenticate = vi.fn().mockResolvedValue(actor(other));
    const command = vi.fn().mockResolvedValue({ ok: 1, privateHost: "synthetic" });
    const getDatabase = vi.fn().mockResolvedValue({ command });
    vi.doMock("@/lib/auth/actor", () => ({ requireActor: authenticate }));
    vi.doMock("@/lib/db/mongodb", () => ({ getDatabase }));
    vi.stubEnv("OPERATIONS_OPERATOR_USER_IDS", operator);
    try {
      const { GET } = await import("@/app/api/ops/readiness/route");
      const denied = await GET();
      expect(denied.status).toBe(403); expect(command).not.toHaveBeenCalled();
      authenticate.mockResolvedValue(actor());
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ready" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Vary")).toBe("Cookie");
      expect(command).toHaveBeenCalledExactlyOnceWith({ ping: 1 }, { timeoutMS: 3000 });
    } finally {
      vi.doUnmock("@/lib/auth/actor"); vi.doUnmock("@/lib/db/mongodb");
    }
  });
});
