// Phase 18 row 18-14: authentication and boundary checks through the REAL route handlers (synthetic data, isolated loopback
// MongoDB). (1) Every route method found on disk refuses an unauthenticated caller with 401 and changes nothing - new routes are
// included automatically. (2) Operator routes refuse signed-in non-operators. (3) Open banking: only the actor bound to the
// configured provider subject passes the binding gate; the provider is a local fake (no network).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, call, expectIsolated, expectRefused, newActor, openHarness, type Harness } from "../security/route-harness";
import { routeMatrix } from "../security/route-authorization-matrix";

vi.mock("@/lib/auth/actor", async () => (await import("../security/route-harness")).mockedActorModule());
const SUBJECT = "synthetic-provider-subject";
vi.mock("@/lib/adapters/financy/financy-open-banking-provider", () => ({
  getFinancyOpenBankingProvider: () => new Proxy({
    listConnections: async () => [{ expiryDate: null, externalId: "synthetic-connection", lastFetchedAt: null, lastFetchedDataDate: null, mode: null,
      providerExternalId: "synthetic-provider", status: "ACTIVE", subjectExternalId: "synthetic-provider-subject" }],
  }, { get: (target, key) => key in target ? (target as Record<string | symbol, unknown>)[key]
    : async () => { throw new Error(`fake provider: ${String(key)} must not be reached in these tests`); } }),
}));

const uri = process.env.MONGODB_TEST_URI;
const profile = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" };

function routeMethods(): { route: string; method: string }[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : /[\\/]route\.ts$/.test(path) ? [path] : [];
  });
  return walk("src/app/api").flatMap((path) => {
    const route = relative("src/app/api", path).split(sep).join("/").replace(/\/route\.ts$/, "");
    const source = readFileSync(path, "utf8");
    return ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`).test(source))
      .map((method) => ({ route, method }));
  });
}
const paramsFor = (route: string) => Object.fromEntries([...route.matchAll(/\[(?:\.\.\.)?([A-Za-z]+)\]/g)].map(([, name]) => [name!, name === "section" ? "accounts" : "a".repeat(24)]));
// Public by design: liveness, and the Auth.js protocol endpoint (its own suites cover it; it is not an application resource).
const PUBLIC = new Set(["GET health", "GET auth/[...nextauth]", "POST auth/[...nextauth]"]);

(uri ? describe : describe.skip)("authentication and boundaries through real routes (18-14)", () => {
  let h: Harness;
  const bound = newActor(); const other = newActor(); const operator = newActor();

  beforeAll(async () => {
    h = await openHarness(uri!);
    vi.stubEnv("OPERATIONS_OPERATOR_USER_IDS", operator.userId);
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "synthetic-client"); vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "synthetic-secret"); vi.stubEnv("OPEN_FINANCE_USER_ID", SUBJECT);
    for (const actor of [bound, other, operator]) { actAs(actor); expect((await call("profile", "PUT", { body: profile })).status).toBe(200); }
  }, 60_000);
  afterAll(async () => { actAs(null); await h?.dispose(); });

  it("[iso-unauthenticated] every session route method in the matrix refuses an anonymous caller with 401 and changes nothing", async () => {
    // Iterates the CI-enforced matrix (identical to the routes on disk), so no classified route can escape the sweep.
    const sessionRoutes = routeMatrix.filter((e) => e.authentication === "session" || e.authentication === "session+operator-allowlist");
    const publicRoutes = routeMatrix.filter((e) => e.authentication === "public" || e.authentication === "auth-protocol").map((e) => `${e.method} ${e.route.slice(4)}`);
    expect([...publicRoutes].sort()).toEqual([...PUBLIC].sort());
    expect(sessionRoutes.length + publicRoutes.length).toBe(routeMatrix.length);
    actAs(null);
    for (const entry of sessionRoutes) {
      const route = entry.route.slice("api/".length);
      await expectRefused(h.db, () => call(route, entry.method, { params: paramsFor(route), ...(entry.method === "GET" ? {} : { body: {} }) }), [], [401]);
    }
    // The independent file-system discovery must agree with the matrix (a second guard next to the inventory test).
    expect(routeMethods().length).toBe(routeMatrix.length);
    expect((await call("health", "GET")).status).toBe(200);
  }, 120_000);

  it("[iso-mutation-origin] a mutation from a foreign or missing Origin is refused before authentication and changes nothing", async () => {
    actAs(other);
    for (const origin of ["https://attacker.example.invalid", null]) {
      await expectRefused(h.db, () => call("profile", "PUT", { body: profile, origin }), [], [403]);
      await expectRefused(h.db, () => call("financial-data/[section]", "POST", { params: { section: "accounts" }, origin,
        body: { idempotencyKey: randomUUID(), fields: { balance: { amount: "1.00", currency: "ILS" }, name: "x", type: "bank" } } }), [], [403]);
    }
  });

  it("[iso-operator] operator routes refuse signed-in non-operators; the allowlisted operator gets metadata only", async () => {
    actAs(other);
    for (const route of ["ops/readiness", "ops/bindings"]) await expectRefused(h.db, () => call(route, "GET"), [], [403]);
    actAs(operator);
    const ready = await call("ops/readiness", "GET");
    expect(ready.status).toBe(200); expect(ready.json).toEqual({ status: "ready" });
  });

  it("[iso-open-banking] only the actor bound to the configured provider subject passes the binding gate", async () => {
    const { openBankingRepositoryForDatabase } = await import("@/lib/open-banking/open-banking-repository");
    const { bankAlias } = await import("@/lib/open-banking/account-identity");
    await openBankingRepositoryForDatabase(h.db).claimBinding(bound, bankAlias("subject", SUBJECT));
    const victimBinding = String((await h.db.collection("bankProviderBindings").findOne({}))!._id);
    actAs(other);
    const center = await expectIsolated(h.db, () => call("open-banking", "GET"), bound.userId, []);
    expect(center.text).not.toContain(victimBinding);
    await expectRefused(h.db, () => call("open-banking/claim", "POST", { body: { confirmation: "CLAIM_CONFIGURED_FINANCY_SUBJECT" } }), [], [403]);
    await expectRefused(h.db, () => call("open-banking/sync", "POST", { body: { idempotencyKey: randomUUID() } }), [], [403]);
    await expectRefused(h.db, () => call("open-banking/refresh", "POST", { body: { confirmation: "CONFIRM_20_CREDIT_REFRESH", idempotencyKey: randomUUID() } }), [], [403]);
    await expectRefused(h.db, () => call("open-banking/disconnect", "POST", { body: { confirmation: "DELETE_FINANCY_CONNECTION", connectionId: "a".repeat(24),
      expectedVersion: 1, idempotencyKey: randomUUID() } }), [], [403]);
    await expectRefused(h.db, () => call("open-banking/reconciliation", "GET"), [], [403]);
    await expectRefused(h.db, () => call("open-banking/reconciliation", "POST", { body: { candidateKey: null, confirmation: false,
      decision: "cannot_determine", idempotencyKey: randomUUID(), legacyKey: "a".repeat(64), reviewToken: "a".repeat(64) } }), [], [403]);
  });
});
