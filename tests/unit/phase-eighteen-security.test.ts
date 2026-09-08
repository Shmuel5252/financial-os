import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterError, InvalidCheck } from "@auth/core/errors";
import { setLogger } from "../../node_modules/@auth/core/lib/utils/logger.js";
import { getConfigurationStatus, parseServerEnv } from "@/lib/config/server-env";
import { financialOsAuthCookies } from "@/lib/auth/cookies";
import nextConfig from "../../next.config";
import { assertTrustedMutationOrigin } from "@/lib/http/request-guards";
import { GET as liveness } from "@/app/api/health/route";

const fixture = {
  NODE_ENV: "production", AUTH_URL: "https://staging.example.invalid",
  AUTH_SECRET: "synthetic-phase-eighteen-secret-over-32-characters",
  GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  MONGODB_URI: "mongodb://fixture.invalid", MONGODB_DB_NAME: "fixture_staging",
};

describe("Phase 18 non-mutating configuration and logging contracts", () => {
  beforeEach(() => { vi.resetModules(); Object.entries(fixture).forEach(([key, value]) => vi.stubEnv(key, value)); });
  afterEach(() => vi.unstubAllEnvs());

  it("does not serialize Auth.js messages, causes, stacks, OAuth codes or adapter arguments", async () => {
    const output: unknown[][] = [];
    for (const method of ["error", "warn", "log", "info"] as const) vi.spyOn(console, method).mockImplementation((...args) => { output.push(args); });
    const { authConfig } = await import("@/lib/auth/config");
    const logger = setLogger({ ...authConfig });
    const marker = "SYNTHETIC_SENSITIVE_PAYLOAD";
    const cause = new Error(marker, { cause: { authorization: marker, accountNumber: marker } });
    logger.error(new InvalidCheck(marker, { cause: { err: cause, callbackUrl: `https://fixture.invalid/?code=${marker}`, args: [marker] } }));
    logger.error(new AdapterError("synthetic adapter failure", { cause: { err: cause } }));
    logger.error(Object.assign(new Error(marker), { name: marker }));
    logger.warn(marker as Parameters<typeof logger.warn>[0]);
    logger.debug(marker, { token: marker, balance: marker });
    expect(output.length).toBeGreaterThan(0);
    expect(JSON.stringify(output).includes(marker)).toBe(false);
    expect(output.map((entry) => (entry[1] as { category: string }).category)).toEqual([
      "InvalidCheck", "AdapterError", "UnexpectedAuthError", "AuthWarning",
    ]);
  });

  it("requires application credentials, not test credentials, for authenticated runtime readiness", () => {
    const env = parseServerEnv(fixture);
    expect(getConfigurationStatus(env).authentication.ready).toBe(true);
    expect(env.MONGODB_TEST_URI).toBeUndefined();
    expect(env.MONGODB_TEST_DB_NAME).toBeUndefined();
    const testOnly = parseServerEnv({ MONGODB_TEST_URI: "mongodb://fixture.invalid", MONGODB_TEST_DB_NAME: "fixture_tests" });
    expect(getConfigurationStatus(testOnly).database.ready).toBe(false);
    expect(getConfigurationStatus(testOnly).authentication.ready).toBe(false);
  });

  it("treats empty provider settings as unavailable without pretending core auth is unavailable", () => {
    const env = parseServerEnv({ ...fixture, ANTHROPIC_API_KEY: "", RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", OPEN_FINANCE_CLIENT_SECRET: "", OPEN_FINANCE_CLIENT_ID: "", OPEN_FINANCE_USER_ID: "" });
    const status = getConfigurationStatus(env);
    expect(status.authentication.ready).toBe(true);
    expect(status.futureAdapters).toEqual({ anthropicConfigured: false, openBankingConfigured: false, resendConfigured: false });
    expect(getConfigurationStatus(parseServerEnv({ ...fixture, GOOGLE_CLIENT_SECRET: "" })).authentication.ready).toBe(false);
  });

  it("preserves explicit HTTPS staging and port-3001 loopback contracts", () => {
    expect(() => parseServerEnv({ ...fixture, AUTH_URL: "http://staging.example.invalid" })).toThrow();
    expect(parseServerEnv({ ...fixture, AUTH_URL: "http://localhost:3001" }).AUTH_URL).toBe("http://localhost:3001");
    expect(financialOsAuthCookies(true).sessionToken?.name).toBe("__Secure-financial-os.authjs.session-token");
    expect(financialOsAuthCookies(false).sessionToken?.name).toBe("financial-os.authjs.session-token");
  });

  it("keeps the existing header baseline without claiming nonce CSP or HTTPS deployment verification", async () => {
    const rules = await nextConfig.headers!();
    const headers = Object.fromEntries(rules.flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])));
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("does not accept a loopback or unrelated preview origin as staging authorization", () => {
    for (const origin of ["http://localhost:3001", "https://preview.example.invalid"]) {
      expect(() => assertTrustedMutationOrigin(new Request(fixture.AUTH_URL, { headers: { origin } }))).toThrow();
    }
    expect(() => assertTrustedMutationOrigin(new Request(fixture.AUTH_URL, { headers: { origin: fixture.AUTH_URL } }))).not.toThrow();
  });

  it("reports only no-store liveness without implying database readiness", async () => {
    const response = liveness();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ service: "financial-os", status: "ok" });
  });
});
