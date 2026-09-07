import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Auth } from "@auth/core";
// Exercise the installed Auth.js cookie merge and PKCE implementation, not a mock.
import { init } from "../../node_modules/@auth/core/lib/init.js";
import { pkce } from "../../node_modules/@auth/core/lib/actions/callback/oauth/checks.js";

const driver = vi.hoisted(() => ({ connect: vi.fn(), construct: vi.fn(), findOne: vi.fn() }));
vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  return {
    ...actual,
    MongoClient: class {
      constructor(uri: string, options: unknown) { driver.construct(uri, options); }
      connect() { return driver.connect(this); }
      db() { return { collection: () => ({ findOne: driver.findOne }) }; }
    },
  };
});

const fixtureSecret = "synthetic-auth-lifecycle-secret-over-32-characters";

describe("Auth.js / MongoDB lazy connection lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    driver.connect.mockReset().mockImplementation(async (client) => client);
    driver.construct.mockReset();
    driver.findOne.mockReset().mockResolvedValue(null);
    globalThis.financialOsMongoClientPromise = undefined;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", fixtureSecret);
    vi.stubEnv("AUTH_URL", "https://staging.example.invalid");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-client-secret");
    vi.stubEnv("MONGODB_URI", "mongodb://fixture.invalid");
    vi.stubEnv("MONGODB_DB_NAME", "fixture_auth");
  });
  afterEach(() => { globalThis.financialOsMongoClientPromise = undefined; vi.unstubAllEnvs(); });

  it("initializes auth configuration and Auth.js without starting a connection that could reject unobserved", async () => {
    driver.connect.mockImplementation(() => new Promise(() => {}));
    const { authConfig } = await import("@/lib/auth/config");
    const response = await Auth(new Request("https://staging.example.invalid/api/auth/providers"), { ...authConfig, basePath: "/api/auth", trustHost: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(response.status).toBe(200);
    expect(driver.construct).not.toHaveBeenCalled();
    expect(driver.connect).not.toHaveBeenCalled();
  });

  it("awaits a cold connection beyond five seconds and shares it across concurrent adapter operations", async () => {
    vi.useFakeTimers();
    try {
      driver.connect.mockImplementation((client) => new Promise((resolve) => setTimeout(() => resolve(client), 6_000)));
      const { authConfig } = await import("@/lib/auth/config");
      let completed = 0;
      const first = Promise.resolve(authConfig.adapter!.getUserByEmail!("fixture@example.invalid")).then(() => { completed++; });
      const second = Promise.resolve(authConfig.adapter!.getUserByEmail!("fixture@example.invalid")).then(() => { completed++; });
      await vi.advanceTimersByTimeAsync(5_001);
      expect(completed).toBe(0);
      expect(driver.connect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      await Promise.all([first, second]);
      expect(completed).toBe(2);
      await authConfig.adapter!.getUserByEmail!("fixture@example.invalid");
      expect(driver.connect).toHaveBeenCalledTimes(1);
      expect(driver.construct.mock.calls[0]?.[1]).toMatchObject({ serverSelectionTimeoutMS: 30_000, maxPoolSize: 20, minPoolSize: 0, promoteLongs: false });
    } finally { vi.useRealTimers(); }
  });

  it("delivers initial failure to the awaiting operation and lets the same adapter recover on the next operation", async () => {
    driver.connect.mockRejectedValueOnce(new Error("synthetic unavailable database"));
    const { authConfig } = await import("@/lib/auth/config");
    await expect(authConfig.adapter!.getUserByEmail!("fixture@example.invalid")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", message: "MongoDB is unavailable." });
    expect(driver.findOne).not.toHaveBeenCalled();
    await expect(authConfig.adapter!.getUserByEmail!("fixture@example.invalid")).resolves.toBeNull();
    expect(driver.connect).toHaveBeenCalledTimes(2);
    expect(driver.findOne).toHaveBeenCalledTimes(1);
  });

  it("reuses the development cache across module reloads and keeps the local timeout", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const first = await import("@/lib/db/mongodb");
    const connection = first.getMongoClientPromise();
    await connection;
    vi.resetModules();
    const second = await import("@/lib/db/mongodb");
    expect(second.getMongoClientPromise()).toBe(connection);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(driver.construct.mock.calls[0]?.[1]).toMatchObject({ serverSelectionTimeoutMS: 5_000 });
  });

  it("retains the configured secret across module initialization and database-backed session policy", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "different-synthetic-legacy-secret-over-32-characters");
    const first = (await import("@/lib/auth/config")).authConfig;
    vi.resetModules();
    const second = (await import("@/lib/auth/config")).authConfig;
    expect(first.secret).toBe(fixtureSecret);
    expect(second.secret).toBe(first.secret);
    expect(second.session?.strategy).toBe("database");
    expect(second.useSecureCookies).toBe(true);
    expect(second.cookies?.pkceCodeVerifier?.name).toBe("__Secure-financial-os.authjs.pkce.code-verifier");
    expect(second.providers).toHaveLength(1);
  });

  it("preserves effective secure cookie defaults and validates PKCE independently of database availability", async () => {
    const { authConfig } = await import("@/lib/auth/config");
    const { options } = await init({
      url: new URL("https://staging.example.invalid/api/auth/callback/google"),
      authOptions: { ...authConfig, basePath: "/api/auth" },
      providerId: "google", action: "callback", csrfDisabled: false,
      isPost: false, cookies: {},
    });
    expect(options.cookies.pkceCodeVerifier.options).toMatchObject({
      httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 900,
    });
    expect(options.cookies.pkceCodeVerifier.options.domain).toBeUndefined();
    expect(options.cookies.csrfToken.name).toBe("__Host-financial-os.authjs.csrf-token");
    expect(options.provider.checks).toContain("pkce");
    const sealed = await pkce.create(options as Parameters<typeof pkce.create>[0]);
    const cookies = { [sealed.cookie.name]: sealed.cookie.value };
    driver.connect.mockRejectedValueOnce(new Error("synthetic unavailable database"));
    await expect(authConfig.adapter!.getUserByEmail!("fixture@example.invalid")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    await expect(pkce.use(cookies, [], options as Parameters<typeof pkce.use>[2])).resolves.toEqual(expect.any(String));
    const wrongSecret = { ...options, jwt: { ...options.jwt, secret: "different-synthetic-secret-over-32-characters" } };
    await expect(pkce.use(cookies, [], wrongSecret as Parameters<typeof pkce.use>[2])).rejects.toMatchObject({ type: "InvalidCheck" });
    await expect(pkce.use({}, [], options as Parameters<typeof pkce.use>[2])).rejects.toMatchObject({ type: "InvalidCheck" });
    expect(driver.connect).toHaveBeenCalledTimes(1);
  });
});
