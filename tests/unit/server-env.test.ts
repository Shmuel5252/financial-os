import { describe, expect, it } from "vitest";

import {
  getConfigurationStatus,
  parseServerEnv,
} from "@/lib/config/server-env";

describe("server environment configuration", () => {
  it("supports a credential-free build while marking capabilities unavailable", () => {
    const env = parseServerEnv({ NODE_ENV: "test" });
    const status = getConfigurationStatus(env);

    expect(status.database.ready).toBe(false);
    expect(status.authentication.ready).toBe(false);
    expect(status.authentication.missing).toContain("AUTH_SECRET");
    expect(status.authentication.missing).toContain("MONGODB_URI");
  });

  it("marks authentication ready only when auth and database inputs exist", () => {
    const env = parseServerEnv({
      AUTH_SECRET: "a-secure-development-secret-at-least-32-chars",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      MONGODB_DB_NAME: "financial_os_test",
      MONGODB_URI: "mongodb://localhost:27017",
      AUTH_URL: "http://localhost:3000",
      NODE_ENV: "test",
    });

    expect(getConfigurationStatus(env).authentication).toEqual({
      missing: [],
      ready: true,
    });
  });

  it("rejects malformed and weak security configuration", () => {
    expect(() =>
      parseServerEnv({
        AUTH_SECRET: "too-short",
        MONGODB_URI: "https://database.example",
        NODE_ENV: "production",
      }),
    ).toThrow();
  });

  it("requires HTTPS for a production authentication origin", () => {
    expect(() =>
      parseServerEnv({
        AUTH_URL: "http://financial-os.example",
        NODE_ENV: "production",
      }),
    ).toThrow(/AUTH_URL must use HTTPS/);
  });

  it("does not treat copied example placeholders as configured credentials", () => {
    expect(() =>
      parseServerEnv({
        AUTH_SECRET: "<generate-a-random-secret-of-at-least-32-characters>",
        GOOGLE_CLIENT_ID: "<google-oauth-client-id>",
        NODE_ENV: "development",
      }),
    ).toThrow(/placeholder/);
  });

  it("reports only readiness and variable names, never secret values", () => {
    const secret = "a-secure-development-secret-at-least-32-chars";
    const status = getConfigurationStatus(
      parseServerEnv({
        ANTHROPIC_API_KEY: secret,
        NODE_ENV: "test",
      }),
    );

    expect(JSON.stringify(status)).not.toContain(secret);
    expect(status.futureAdapters.anthropicConfigured).toBe(true);
  });
});
