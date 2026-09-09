import { afterEach, describe, expect, it, vi } from "vitest";

const operator = "100000000000000000000001";
const ordinary = "200000000000000000000001";
const sentinel = "SYNTHETIC_PRIVATE_SENTINEL_OVER_32_CHARACTERS";

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs();
  vi.doUnmock("@/lib/auth/actor"); vi.doUnmock("@/lib/db/mongodb"); vi.resetModules();
});

async function route(authenticate: () => Promise<unknown>, failDatabase = false) {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    OPERATIONS_OPERATOR_USER_IDS: operator, FINANCIAL_OS_ENVIRONMENT: "staging",
    MONGODB_DB_NAME: "financial_os_staging", NODE_ENV: "production",
    AUTH_URL: "https://financial-os-staging-nine.vercel.app", AUTH_SECRET: sentinel,
    MONGODB_URI: `mongodb://${sentinel}:${sentinel}@private-fixture.invalid`,
    GOOGLE_CLIENT_ID: sentinel, GOOGLE_CLIENT_SECRET: sentinel,
    ANTHROPIC_API_KEY: sentinel, ANTHROPIC_WORKSPACE_ID: "", RESEND_API_KEY: sentinel,
    RESEND_FROM_EMAIL: "", OPEN_FINANCE_CLIENT_SECRET: sentinel,
    OPEN_FINANCE_CLIENT_ID: sentinel, OPEN_FINANCE_USER_ID: sentinel,
  })) vi.stubEnv(key, value);
  const listCollections = vi.fn(() => ({ toArray: async () => [{ name: "authUsers", privatePayload: sentinel }] }));
  const getDatabase = vi.fn(async () => {
    if (failDatabase) throw new Error(sentinel, { cause: { token: sentinel, userId: ordinary } });
    return { databaseName: "financial_os_staging", listCollections };
  });
  vi.doMock("@/lib/auth/actor", () => ({ requireActor: authenticate }));
  vi.doMock("@/lib/db/mongodb", () => ({ getDatabase }));
  const handler = await import("@/app/api/ops/bindings/route");
  return { ...handler, getDatabase, listCollections };
}

describe("bindings endpoint final security review", () => {
  it.each(["anonymous", "ordinary", "auth-failure", "disabled", "malformed"])("returns no binding metadata for %s", async (kind) => {
    const authenticate = vi.fn(async () => {
      if (kind === "anonymous") {
        const { UnauthenticatedError } = await import("@/lib/errors/application-error");
        throw new UnauthenticatedError();
      }
      if (kind === "auth-failure") throw new Error(sentinel);
      return { kind: "user", userId: kind === "ordinary" ? ordinary : operator };
    });
    const { GET, getDatabase } = await route(authenticate);
    if (kind === "disabled") vi.stubEnv("OPERATIONS_OPERATOR_USER_IDS", "");
    if (kind === "malformed") vi.stubEnv("OPERATIONS_OPERATOR_USER_IDS", operator + ",*");
    const response = await GET();
    const category = kind === "anonymous" ? "authentication_required" : kind === "auth-failure" ? "unavailable" : "forbidden";
    expect(await response.json()).toEqual({ status: category });
    expect(response.status).toBe(kind === "anonymous" ? 401 : kind === "auth-failure" ? 503 : 403);
    expect(getDatabase).not.toHaveBeenCalled();
    if (kind === "disabled" || kind === "malformed") expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns exactly fixed assertions to an operator and ignores inspection parameters", async () => {
    const logs = ["log", "info", "warn", "error", "debug"].map(method => vi.spyOn(console, method as "log").mockImplementation(() => {}));
    const { GET, listCollections } = await route(async () => ({ kind: "user", userId: operator }));
    const request = new Request("https://staging.example.invalid/api/ops/bindings?key=AUTH_SECRET&database=admin&userId=" + ordinary, {
      headers: { "x-user-id": ordinary, authorization: "Bearer " + sentinel },
    });
    const response = await (GET as (request: Request) => Promise<Response>)(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ policy: "staging-binding-v1", classification: "match",
      configuredDatabase: "match", connectedNamespace: "match", authOrigin: "match",
      requiredConfiguration: "present", clusterIdentity: "unknown", credentialIdentity: "unknown" });
    expect(listCollections).toHaveBeenCalledExactlyOnceWith({ name: "authUsers" }, { nameOnly: true, timeoutMS: 3000 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    logs.forEach(log => expect(log).not.toHaveBeenCalled());
  });

  it("never serializes a driver error even to an authorized operator", async () => {
    const { GET } = await route(async () => ({ kind: "user", userId: operator }), true);
    const response = await GET();
    expect(await response.json()).toEqual({ policy: "staging-binding-v1", classification: "match",
      configuredDatabase: "match", connectedNamespace: "unknown", authOrigin: "match",
      requiredConfiguration: "present", clusterIdentity: "unknown", credentialIdentity: "unknown" });
  });
});
