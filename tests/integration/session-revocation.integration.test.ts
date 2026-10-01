// Phase 18 row 18-14: session revocation through the INSTALLED Auth.js HTTP handler with the REAL MongoDB adapter on an
// isolated loopback database (synthetic user, session and tokens). Sign-out deletes the session row and the same cookie stops
// resolving to a user immediately; expired and deleted rows never authenticate; and the app's actor resolution turns a missing
// session into 401. requireActor itself calls auth(), which performs exactly this database session lookup on every request.
import { randomBytes } from "node:crypto";
import { Auth } from "@auth/core";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ORIGIN, openHarness, type Harness } from "../security/route-harness";

// auth() is replaced by the REAL Auth.js session endpoint for the current cookie (the same adapter lookup auth() performs), so the
// app's own requireActor is exercised against real session rows. (Importing next-auth itself fails under Node's ESM loader.)
const cookieJar = vi.hoisted(() => ({ token: "", lookup: undefined as undefined | ((token: string) => Promise<unknown>) }));
vi.mock("@/lib/auth", () => ({ auth: async () => cookieJar.token === "" ? null : cookieJar.lookup!(cookieJar.token) }));

const uri = process.env.MONGODB_TEST_URI;

(uri ? describe : describe.skip)("session revocation through the real Auth.js handler and MongoDB adapter (18-14)", () => {
  let h: Harness;
  let config: Awaited<typeof import("@/lib/auth/config")>["authConfig"];
  const userId = new ObjectId();

  beforeAll(async () => {
    h = await openHarness(uri!);
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
    config = (await import("@/lib/auth/config")).authConfig;
    cookieJar.lookup = async (token) => { const body = await sessionFor(token); return body?.user?.id === undefined ? null : body; };
    await h.db.collection("authUsers").insertOne({ _id: userId, email: "session@example.invalid", emailVerified: null, image: null, name: "Synthetic" });
  }, 60_000);
  afterAll(async () => {
    const { getMongoClientPromise } = await import("@/lib/db/mongodb");
    await (await getMongoClientPromise()).close().catch(() => undefined);
    await h?.dispose();
  });

  const sessionCookie = () => config.cookies!.sessionToken!.name!;
  const handle = (request: Request) => Auth(request, { ...config, trustHost: true, basePath: "/api/auth" });
  async function newSession(expires: Date): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await h.db.collection("authSessions").insertOne({ expires, sessionToken: token, userId });
    return token;
  }
  async function sessionFor(token: string) {
    const response = await handle(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie: `${sessionCookie()}=${token}` } }));
    return (await response.json()) as { user?: { id?: string } } | null;
  }

  it("[iso-session-signout] sign-out deletes the database session and the same cookie stops authenticating immediately", async () => {
    const token = await newSession(new Date(Date.now() + 86_400_000));
    expect((await sessionFor(token))?.user?.id).toBe(userId.toHexString());

    const csrf = await handle(new Request(`${ORIGIN}/api/auth/csrf`));
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const csrfCookie = csrf.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    const signedOut = await handle(new Request(`${ORIGIN}/api/auth/signout`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${csrfCookie}; ${sessionCookie()}=${token}`, origin: ORIGIN },
      body: new URLSearchParams({ csrfToken, callbackUrl: ORIGIN }) }));
    expect(signedOut.status).toBeLessThan(400);
    expect(await h.db.collection("authSessions").countDocuments({ sessionToken: token })).toBe(0);
    const after = await sessionFor(token);
    expect(after?.user?.id).toBeUndefined();
    expect(JSON.stringify(after ?? null)).not.toContain(userId.toHexString());
  });

  it("[iso-session-invalid] expired and deleted session rows never authenticate, and the actor boundary maps that to 401", async () => {
    const expired = await newSession(new Date(Date.now() - 1_000));
    expect((await sessionFor(expired))?.user?.id).toBeUndefined();
    const deleted = await newSession(new Date(Date.now() + 86_400_000));
    expect((await sessionFor(deleted))?.user?.id).toBe(userId.toHexString());
    await h.db.collection("authSessions").deleteOne({ sessionToken: deleted }); // e.g. revoked by an operator or another sign-out path
    expect((await sessionFor(deleted))?.user?.id).toBeUndefined();
    expect((await sessionFor(randomBytes(32).toString("hex")))?.user?.id).toBeUndefined();
    const { actorFromSession, requireActor } = await import("@/lib/auth/actor");
    const { UnauthenticatedError } = await import("@/lib/errors/application-error");
    // The app's requireActor over real session rows: authenticated while the row exists, 401 as soon as it is gone.
    const live = await newSession(new Date(Date.now() + 86_400_000));
    cookieJar.token = live;
    expect(await requireActor()).toEqual({ kind: "user", userId: userId.toHexString() });
    await h.db.collection("authSessions").deleteOne({ sessionToken: live });
    await expect(requireActor()).rejects.toBeInstanceOf(UnauthenticatedError);
    cookieJar.token = expired;
    await expect(requireActor()).rejects.toBeInstanceOf(UnauthenticatedError);
    cookieJar.token = "";
    await expect(requireActor()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(() => actorFromSession(null)).toThrow(UnauthenticatedError);
    expect(() => actorFromSession({ expires: new Date().toISOString(), user: {} } as never)).toThrow(UnauthenticatedError);
  });
});
