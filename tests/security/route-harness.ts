// Shared harness for the 18-14 authorization/isolation tests: real route handlers, real services and repositories, a real
// isolated loopback MongoDB database, and a controllable authenticated actor in place of the Auth.js session lookup.
// Synthetic data only. Never point it at a deployed database.
import { createHash, randomBytes } from "node:crypto";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

export const ORIGIN = "http://localhost:3001";
const state: { actor: Actor | null } = { actor: null };

/** Call from a vi.mock factory for "@/lib/auth/actor" (the session lookup itself is covered by the session tests): requireActor
 * returns the current synthetic actor or fails unauthenticated, exactly like a missing session. */
export async function mockedActorModule() {
  const { UnauthenticatedError } = await import("@/lib/errors/application-error");
  return {
    requireActor: async () => { if (state.actor === null) throw new UnauthenticatedError(); return state.actor; },
    actorFromSession: () => { throw new Error("actorFromSession is not used by route handlers"); },
  };
}

export const newActor = (): Actor => ({ kind: "user", userId: new ObjectId().toHexString() });
export function actAs(actor: Actor | null): void { state.actor = actor; }

export type Harness = Readonly<{ db: Db; client: MongoClient; dispose: () => Promise<void> }>;

/** Loopback-only test database with a random name; the route code reaches it through MONGODB_URI/MONGODB_DB_NAME. */
export async function openHarness(uri: string): Promise<Harness> {
  const url = new URL(uri);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("authorization harness requires a loopback database");
  const name = `authz_${randomBytes(6).toString("hex")}`;
  vi.stubEnv("MONGODB_URI", uri); vi.stubEnv("MONGODB_DB_NAME", name);
  vi.stubEnv("AUTH_URL", ORIGIN); vi.stubEnv("AUTH_SECRET", randomBytes(32).toString("hex"));
  const client = await new MongoClient(uri).connect();
  return { db: client.db(name), client, dispose: async () => { await client.db(name).dropDatabase(); await client.close(); } };
}

type Init = Readonly<{ body?: unknown; query?: Record<string, string>; params?: Record<string, string>; origin?: string | null }>;
export type Called = Readonly<{ status: number; text: string; json: unknown }>;

/** Invokes the exported handler of src/app/api/<route>/route.ts exactly as Next would (Request + async params). */
export async function call(route: string, method: string, init: Init = {}): Promise<Called> {
  const routeModule = (await import(/* @vite-ignore */ `@/app/api/${route}/route`)) as Record<string, unknown>;
  const handler = routeModule[method] as ((request: Request, context: unknown) => Promise<Response>) | undefined;
  if (handler === undefined) throw new Error(`no ${method} handler for ${route}`);
  const url = new URL(`${ORIGIN}/api/${route}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const headers = new Headers();
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const request = new Request(url, { method, headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  const response = await handler(request, { params: Promise.resolve(init.params ?? {}) });
  const text = await response.text();
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* non-JSON (e.g. CSV) */ }
  return { status: response.status, text, json };
}

/** Digest of every document in every collection except the rate-limiter counters (the only state a refused request may change).
 * With `ownerUserId`, only documents owned by that user (userId / ownerUserId / invitedByUserId) - for attacker requests that
 * legitimately write the attacker's own data but must leave the victim's untouched. */
export async function fingerprint(db: Db, ownerUserId?: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const owner = ownerUserId === undefined ? undefined : new ObjectId(ownerUserId);
  const filter = owner === undefined ? {} : { $or: [{ userId: owner }, { ownerUserId: owner }, { invitedByUserId: owner }] };
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name === "rateLimits" || name.startsWith("system.")) continue;
    const documents = await db.collection(name).find(filter, { promoteLongs: false }).sort({ _id: 1 }).toArray();
    if (documents.length > 0) result[name] = createHash("sha256").update(BSON.serialize({ documents })).digest("hex");
  }
  return result;
}

/** A refused attempt: an error status, nothing of the victim in the response, and no state change anywhere. */
export async function expectRefused(db: Db, attempt: () => Promise<Called>, victimMarkers: readonly string[],
  statuses: readonly number[] = [403, 404, 409]): Promise<Called> {
  const before = await fingerprint(db);
  const response = await attempt();
  const after = await fingerprint(db);
  if (!statuses.includes(response.status)) throw new Error(`expected one of ${statuses.join("/")}, got ${response.status}: ${response.text.slice(0, 200)}`);
  for (const marker of victimMarkers) if (response.text.includes(marker)) throw new Error(`response disclosed a victim marker (${marker.slice(0, 6)}…)`);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`state changed: ${JSON.stringify(Object.keys(after).filter((k) => after[k] !== before[k]).concat(Object.keys(before).filter((k) => !(k in after))))}`);
  return response;
}

/** An allowed (2xx) request by another user: nothing of the victim in the response, and the victim's own documents unchanged. */
export async function expectIsolated(db: Db, attempt: () => Promise<Called>, victimUserId: string, victimMarkers: readonly string[]): Promise<Called> {
  const before = await fingerprint(db, victimUserId);
  const response = await attempt();
  const after = await fingerprint(db, victimUserId);
  if (response.status < 200 || response.status > 299) throw new Error(`expected success, got ${response.status}: ${response.text.slice(0, 200)}`);
  for (const marker of victimMarkers) if (response.text.includes(marker)) throw new Error(`response disclosed a victim marker (${marker.slice(0, 6)}…)`);
  if (response.text.includes(victimUserId)) throw new Error("response disclosed the victim's user id");
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("the victim's documents changed");
  return response;
}

export const marker = (label: string) => `${label}-${randomBytes(5).toString("hex")}`;
