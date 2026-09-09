import { Auth } from "@auth/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const id = "100000000000000000000001";
const marker = "SYNTHETIC_SESSION_PRIVATE_MARKER";

beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    NODE_ENV: "production", AUTH_SECRET: "synthetic-session-secret-more-than-32-characters",
    AUTH_URL: "https://session.example.invalid", MONGODB_URI: "mongodb://fixture.invalid",
    MONGODB_DB_NAME: "fixture_auth", GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
  })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

async function exercise(state: "valid" | "expired" | "missing" | "anonymous") {
  const { authConfig } = await import("@/lib/auth/config");
  const expires = new Date(Date.now() + (state === "expired" ? -1_000 : 30 * 86400_000));
  const user = { id, name: "Fixture", email: "fixture@example.invalid", image: null,
    emailVerified: new Date(), extraPrivate: marker, refresh_token: marker };
  const session = { id: "200000000000000000000001", userId: id, sessionToken: marker, expires,
    extraPrivate: { credential: marker } };
  const getSessionAndUser = vi.fn(async () => state === "missing" ? null : { user, session });
  const deleteSession = vi.fn(async () => undefined);
  const updateSession = vi.fn(async () => null);
  const response = await Auth(new Request("https://session.example.invalid/api/auth/session", {
    headers: state === "anonymous" ? {} : { cookie: `${authConfig.cookies!.sessionToken!.name}=${marker}` },
  }), { ...authConfig, trustHost: true, basePath: "/api/auth",
    adapter: { ...authConfig.adapter, getSessionAndUser, deleteSession, updateSession } });
  return { response, body: await response.json(), expires, session, user, getSessionAndUser, deleteSession };
}

describe("public session allowlist through installed Auth.js HTTP handler", () => {
  it("returns only presentation fields and the authenticated actor ID, never database/session extras", async () => {
    const { response, body, expires, session, user } = await exercise("valid");
    expect(response.status).toBe(200);
    expect(body).toEqual({ user: { id, name: "Fixture", email: "fixture@example.invalid", image: null }, expires: expires.toISOString() });
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // Preserve normal HttpOnly cookie authentication, not a token in JSON.
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(session.sessionToken).toBe(marker);
    expect(user.extraPrivate).toBe(marker);
  });
  it.each(["expired", "missing", "anonymous"] as const)("does not return identity for %s sessions", async state => {
    const result = await exercise(state);
    expect(result.body).toBeNull();
    if (state === "expired") expect(result.deleteSession).toHaveBeenCalledExactlyOnceWith(marker);
    if (state === "anonymous") expect(result.getSessionAndUser).not.toHaveBeenCalled();
  });
  it("keeps JWT fallback identity server-derived and ignores client-supplied session updates", async () => {
    const { authConfig } = await import("@/lib/auth/config");
    const callback = authConfig.callbacks!.session!;
    const input = { session: { expires: "2030-01-01T00:00:00.000Z", user: { id: "untrusted", name: "Fixture" }, sessionToken: marker },
      token: { sub: id, secret: marker }, newSession: { user: { id: "attacker" } }, trigger: "update" };
    const result = await callback(input as unknown as Parameters<typeof callback>[0]);
    expect(result).toEqual({ expires: input.session.expires, user: { id, name: "Fixture", email: null, image: null } });
    expect(input.session.user.id).toBe("untrusted");
    const withoutIdentity = await callback({ ...input, token: {} } as unknown as Parameters<typeof callback>[0]);
    expect(withoutIdentity.user).not.toHaveProperty("id");
  });
});
