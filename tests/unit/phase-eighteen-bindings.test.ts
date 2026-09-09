import type { Db } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectStagingBinding } from "@/lib/operations/environment-binding";

const input = {
  FINANCIAL_OS_ENVIRONMENT: "staging", NODE_ENV: "production",
  MONGODB_DB_NAME: "financial_os_staging", AUTH_URL: "https://financial-os-staging-nine.vercel.app",
};
const db = (name = "financial_os_staging", collections = [{ name: "authUsers" }]) => ({
  databaseName: name, listCollections: vi.fn(() => ({ toArray: async () => collections })),
}) as unknown as Db;
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("bounded staging binding contract", () => {
  it("proves only namespace/schema matches, not cluster identity or credentials", async () => {
    const result = await inspectStagingBinding(input, async () => db());
    expect(result).toEqual({ policy: "staging-binding-v1", classification: "match", configuredDatabase: "match",
      connectedNamespace: "match", authOrigin: "match", requiredConfiguration: "incomplete", clusterIdentity: "unknown", credentialIdentity: "unknown" });
  });
  it("does not infer staging from Production or inspect mismatched/unclassified data", async () => {
    const factory = vi.fn();
    for (const override of [{ FINANCIAL_OS_ENVIRONMENT: undefined, VERCEL_ENV: "production" }, { FINANCIAL_OS_ENVIRONMENT: "production" }, { MONGODB_DB_NAME: "other" }]) {
      expect((await inspectStagingBinding({ ...input, ...override }, factory)).connectedNamespace).toBe("unknown");
    }
    expect(factory).not.toHaveBeenCalled();
  });
  it("does not claim an empty database or failed connection proves a namespace", async () => {
    expect((await inspectStagingBinding(input, async () => db("financial_os_staging", []))).connectedNamespace).toBe("unknown");
    expect((await inspectStagingBinding(input, async () => db("other"))).connectedNamespace).toBe("mismatch");
    expect((await inspectStagingBinding(input, async () => { throw new Error("SYNTHETIC_PRIVATE_ERROR"); })).connectedNamespace).toBe("unknown");
  });
  it("never echoes arbitrary environment values or exceptions", async () => {
    const marker = "SYNTHETIC_PRIVATE_SENTINEL";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await inspectStagingBinding({ ...input, AUTH_SECRET: marker, MONGODB_URI: marker, GOOGLE_CLIENT_SECRET: marker }, async () => db());
    expect(result.requiredConfiguration).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain(marker); expect(log).not.toHaveBeenCalled();
  });
  it("does not disclose bindings to an ordinary user through the actual route", async () => {
    const read = vi.fn();
    vi.doMock("@/lib/auth/actor", () => ({ requireActor: async () => ({ kind: "user", userId: "200000000000000000000001" }) }));
    vi.doMock("@/lib/db/mongodb", () => ({ getDatabase: read }));
    vi.stubEnv("OPERATIONS_OPERATOR_USER_IDS", "100000000000000000000001");
    try {
      const { GET } = await import("@/app/api/ops/bindings/route");
      const response = await GET();
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ status: "forbidden" });
      expect(read).not.toHaveBeenCalled(); expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally { vi.doUnmock("@/lib/auth/actor"); vi.doUnmock("@/lib/db/mongodb"); }
  });
});
