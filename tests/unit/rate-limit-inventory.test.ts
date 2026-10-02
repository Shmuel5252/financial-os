import { describe, expect, it } from "vitest";
import { rateLimitFindings, rateLimitMatrix, type Identity } from "../security/rate-limit-matrix";
import { limiterModuleExports, limiterModuleReferences, routeLimiterUses, serverActionFiles } from "../security/rate-limit-sites";
import { pageMatrix, routeMatrix, serverActionMatrix, type Authentication } from "../security/route-authorization-matrix";

// Phase 18 row 18-05 (repository portion): tests/security/rate-limit-matrix.ts must describe exactly which limiter every route
// method actually consumes, and must decide explicitly (with a rationale) for every unthrottled route, page and server action.
// Structural only: tests/integration/rate-limit-routes.integration.test.ts [rlx-route-sweep] proves every limited route is refused.
const entries = Object.entries(rateLimitMatrix);
const kind = (key: string) => key.split(" ")[0]!;
const isRoute = (key: string) => !["PAGE", "ACTION"].includes(kind(key));

describe("rate-limit inventory (18-05)", () => {
  const scan = routeLimiterUses();

  it("classifies exactly every route method, page/special file and server-action module: no missing or stale entry", () => {
    // Auth.js re-exports its handlers (invisible to the scan): exactly these two keys come from the 18-14 matrix instead.
    const authjs = routeMatrix.filter((entry) => entry.authentication === "auth-protocol").map((entry) => `${entry.method} ${entry.route}`);
    expect(authjs.sort()).toEqual(["GET api/auth/[...nextauth]", "POST api/auth/[...nextauth]"]);
    // Pages/special files: the 18-14 page matrix, which its own inventory pins to every Next.js special file on disk.
    const pages = pageMatrix.map((entry) => `PAGE ${entry.file}`);
    // Server actions: every file with a "use server" directive anywhere (AST: file or function prologue, any formatting).
    expect(serverActionFiles(), "server-action modules (AST) vs the 18-14 serverActionMatrix").toEqual(serverActionMatrix.map((entry) => entry.file).sort());
    const expected = [...scan.routes.keys(), ...authjs, ...pages, ...serverActionMatrix.map((entry) => `ACTION ${entry.file}`)];
    expect(Object.keys(rateLimitMatrix).sort()).toEqual([...new Set(expected)].sort());
    expect(routeMatrix.map((entry) => `${entry.method} ${entry.route}`).sort()).toEqual(entries.filter(([key]) => isRoute(key)).map(([key]) => key).sort());
  }, 60_000);

  it("pins the exact limiter (policy and scope) each route handler consumes; `none` means the handler consumes none", () => {
    for (const [key, entry] of entries.filter(([key]) => isRoute(key))) {
      const actual = scan.routes.get(key)?.limiters;
      if (entry.policy === "authjs") { expect(actual, `${key}: an Auth.js re-export is not a scanned handler`).toBeUndefined(); continue; }
      const expected = entry.policy === "none" ? [] : [`${entry.policy}:${entry.scope}`];
      expect(actual, `${key}: limiter calls in the handler (and its same-file helpers)`).toEqual(expected);
    }
  }, 60_000);

  it("finds no limiter call outside a route handler body (pages, server actions, helpers and libraries are unthrottled by decision)", () => {
    expect(scan.unrouted).toEqual([]);
    for (const [key, entry] of entries.filter(([key]) => !isRoute(key))) expect(["none", "authjs"], key).toContain(entry.policy);
  }, 60_000);

  it("consumes the limiter once, awaited directly in the handler, after authentication (and the origin check) and before the body", () => {
    for (const [key, use] of scan.routes) {
      if (use.limiters.length === 0) continue;
      const at = (step: string) => use.order.indexOf(step);
      expect(at("actor"), `${key}: limiter keyed on an authenticated actor`).toBeGreaterThanOrEqual(0);
      expect(at("actor"), `${key}: actor before limiter`).toBeLessThan(at("limiter"));
      if (key.startsWith("GET ")) expect(at("origin"), `${key}: a limited GET has no origin check`).toBe(-1);
      else expect(at("origin"), `${key}: a limited mutation checks its origin first`).toBe(0);
      if (at("body") >= 0) expect(at("limiter"), `${key}: limiter before body parsing`).toBeLessThan(at("body"));
      expect(use.order.filter((step) => step === "limiter"), `${key}: exactly one limiter`).toHaveLength(1);
    }
    // Presence is not effect: no conditional, unawaited, swallowed, deferred or re-keyed call, and no exit path before it.
    expect(scan.structure).toEqual([]);
  }, 60_000);

  it("imports the limiter only as its two named wrappers, only in limited route files (no alias, namespace, dynamic import or shadowing)", () => {
    const byFile = new Map<string, Set<string>>();
    for (const [key, use] of scan.routes) for (const limiter of use.limiters) {
      const file = `src/app/${key.split(" ")[1]}/route.ts`;
      byFile.set(file, new Set([...(byFile.get(file) ?? []), limiter.startsWith("ai:") ? "consumeAiRequestRateLimit" : "consumeMutationRateLimit"]));
    }
    expect(limiterModuleReferences()).toEqual([
      ...[...byFile].map(([file, names]) => `${file} ${[...names].sort().join(",")}`),
      // Deploy-time index creation builds the counters' TTL index; it never consumes a budget.
      "src/lib/operations/application-indexes.ts rateLimiterForDatabase",
    ].sort());
    expect(limiterModuleExports(), "a new limiter-module export (another limiter, policy or bypass) must be reviewed")
      .toEqual(["MongoRateLimiter", "RateLimitPolicy", "consumeAiRequestRateLimit", "consumeMutationRateLimit", "rateLimiterForDatabase"]);
  }, 60_000);

  it("makes `none` an explicit decision: concrete rationale, cost, and a cited finding for every heavy or provider-backed surface", () => {
    for (const [key, entry] of entries) {
      for (const id of entry.findings) expect(rateLimitFindings, `${key}: cites an undefined finding`).toHaveProperty([id]);
      if (entry.policy === "none" || entry.policy === "authjs") {
        expect(entry.rationale.length, `${key}: rationale`).toBeGreaterThanOrEqual(40);
        expect(entry.scope, `${key}: an unthrottled entry has no scope`).toBeUndefined();
        if (["heavy", "provider"].includes(entry.cost)) expect(entry.findings.length, `${key}: an unthrottled ${entry.cost} surface must cite a finding`).toBeGreaterThan(0);
      } else {
        expect(entry.scope, `${key}: a limited entry names its scope`).toBeTruthy();
        expect(entry.identity, `${key}: the limiter keys on the actor`).toBe("actor");
      }
      if (entry.cost === "provider" && entry.policy === "mutation" && entry.findings.length === 0) {
        expect(entry.rationale.length, `${key}: a provider-backed route on the generic budget needs a finding or a rationale`).toBeGreaterThanOrEqual(40);
      }
    }
    expect(new Set(entries.flatMap(([, entry]) => entry.findings)), "every finding is cited by at least one surface or documented as cross-cutting")
      .toEqual(new Set(Object.keys(rateLimitFindings).filter((id) => !["F-18-05-03", "F-18-05-06", "F-18-05-07", "F-18-05-13"].includes(id))));
  });

  it("identifies callers consistently with the 18-14 authentication classes", () => {
    const identity: Readonly<Record<Authentication, Identity>> = { public: "anonymous", "auth-protocol": "authjs", session: "actor", "session+operator-allowlist": "operator" };
    for (const entry of routeMatrix) expect(rateLimitMatrix[`${entry.method} ${entry.route}`]!.identity, `${entry.method} ${entry.route}`).toBe(identity[entry.authentication]);
    for (const entry of pageMatrix) {
      const expected = entry.authentication === "session" ? "actor" : "anonymous";
      expect(rateLimitMatrix[`PAGE ${entry.file}`]!.identity, entry.file).toBe(expected);
    }
  });
});
