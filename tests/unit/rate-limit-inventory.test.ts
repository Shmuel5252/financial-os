import { describe, expect, it } from "vitest";
import { files } from "../security/live-test-ids";
import { rateLimitFindings, rateLimitMatrix, type Identity } from "../security/rate-limit-matrix";
import { routeLimiterUses } from "../security/rate-limit-sites";
import { pageMatrix, routeMatrix, serverActionMatrix, type Authentication } from "../security/route-authorization-matrix";

// Phase 18 row 18-05 (repository portion): tests/security/rate-limit-matrix.ts must describe exactly which limiter every route
// method actually consumes, and must decide explicitly (with a rationale) for every unthrottled route, page and server action.
const posix = (path: string) => path.replaceAll("\\", "/");
const entries = Object.entries(rateLimitMatrix);
const kind = (key: string) => key.split(" ")[0]!;

describe("rate-limit inventory (18-05)", () => {
  const scan = routeLimiterUses();

  it("classifies exactly every route method, page/layout file and server-action module: no missing or stale entry", () => {
    const authjs = routeMatrix.filter((entry) => entry.authentication === "auth-protocol").map((entry) => `${entry.method} ${entry.route}`);
    const pages = files("src/app", (path) => /(^|[\\/])(page|layout|error|not-found)\.tsx$/.test(path)).map((path) => `PAGE ${posix(path)}`);
    const expected = [...scan.routes.keys(), ...authjs, ...pages, ...serverActionMatrix.map((entry) => `ACTION ${entry.file}`)];
    expect(Object.keys(rateLimitMatrix).sort()).toEqual([...new Set(expected)].sort());
    // Same universe as the 18-14 authorization matrix (a route Auth.js re-exports is invisible to the scan, so it comes from there).
    expect([...routeMatrix.map((entry) => `${entry.method} ${entry.route}`)].sort()).toEqual(entries.filter(([key]) => !["PAGE", "ACTION"].includes(kind(key))).map(([key]) => key).sort());
    expect(pageMatrix.map((entry) => `PAGE ${entry.file}`).sort()).toEqual(pages.sort());
  }, 60_000);

  it("pins the exact limiter (policy and scope) each route handler consumes; `none` means the handler consumes none", () => {
    for (const [key, entry] of entries.filter(([key]) => !["PAGE", "ACTION"].includes(kind(key)))) {
      const actual = scan.routes.get(key)?.limiters;
      if (entry.policy === "authjs") { expect(actual, `${key}: an Auth.js re-export is not a scanned handler`).toBeUndefined(); continue; }
      const expected = entry.policy === "none" ? [] : [`${entry.policy}:${entry.scope}`];
      expect(actual, `${key}: limiter calls in the handler (and its same-file helpers)`).toEqual(expected);
    }
  }, 60_000);

  it("finds no limiter call outside a route handler (pages and server actions are unthrottled by decision, not by accident)", () => {
    expect(scan.unrouted).toEqual([]);
    for (const [key, entry] of entries.filter(([key]) => ["PAGE", "ACTION"].includes(kind(key)))) expect(["none", "authjs"], key).toContain(entry.policy);
  }, 60_000);

  it("consumes the limiter after authentication (and the origin check) and before the body is read", () => {
    for (const [key, use] of scan.routes) {
      if (use.limiters.length === 0) continue;
      const at = (step: string) => use.order.indexOf(step);
      expect(at("actor"), `${key}: limiter keyed on an authenticated actor`).toBeGreaterThanOrEqual(0);
      expect(at("actor"), `${key}: actor before limiter`).toBeLessThan(at("limiter"));
      if (at("origin") >= 0) expect(at("origin"), `${key}: origin before limiter`).toBeLessThan(at("limiter"));
      if (key.startsWith("GET ")) expect(at("origin"), `${key}: a limited GET has no origin check`).toBe(-1);
      else expect(at("origin"), `${key}: a limited mutation checks its origin first`).toBe(0);
      if (at("body") >= 0) expect(at("limiter"), `${key}: limiter before body parsing`).toBeLessThan(at("body"));
      expect(use.order.filter((step) => step === "limiter"), `${key}: exactly one limiter`).toHaveLength(1);
    }
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
      if (entry.cost === "provider" && entry.policy === "mutation") expect(entry.findings.length + entry.rationale.length, `${key}: explain the provider budget`).toBeGreaterThan(0);
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
