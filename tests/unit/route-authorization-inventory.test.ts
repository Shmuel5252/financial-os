import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { routeMatrix, serverActionMatrix } from "../security/route-authorization-matrix";

// Phase 18 row 18-14: every API route method and every server-action module must be classified in the matrix, and every
// classified ownership boundary must name a negative test that exists. A new or renamed route/method fails CI until reviewed.
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function files(directory: string, match: (path: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path, match) : match(path) ? [path] : [];
  });
}
const posix = (path: string) => path.split(sep).join("/");

function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  for (const method of methods) {
    const patterns = [new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`), new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`)];
    if (patterns.some((pattern) => pattern.test(source))) found.add(method);
  }
  return [...found].sort();
}

describe("route authorization inventory (18-14)", () => {
  const routes = files("src/app", (path) => /[\\/]route\.(ts|tsx|js|mjs)$/.test(path)).map((path) => ({
    route: posix(relative("src/app", path)).replace(/\/route\.(ts|tsx|js|mjs)$/, ""),
    methods: exportedMethods(readFileSync(path, "utf8")),
  }));

  it("classifies exactly every exported route method - no unclassified, stale or duplicate entry", () => {
    const actual = routes.flatMap((r) => r.methods.map((m) => `${m} /${r.route}`)).sort();
    const classified = routeMatrix.map((e) => `${e.method} /${e.route}`).sort();
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified).toEqual(actual);
    expect(routes.every((r) => r.methods.length > 0)).toBe(true);
  });

  it("classifies exactly every server-action module", () => {
    const actual = files("src", (path) => /\.(ts|tsx)$/.test(path))
      .filter((path) => /^\s*["']use server["']/m.test(readFileSync(path, "utf8"))).map(posix).sort();
    expect(serverActionMatrix.map((e) => e.file).sort()).toEqual(actual);
  });

  it("separates authentication from authorization and names a real negative test for every ownership boundary", () => {
    const testSources = files("tests", (path) => /\.test\.(ts|tsx)$/.test(path)).map((path) => readFileSync(path, "utf8")).join("\n");
    for (const entry of [...routeMatrix, ...serverActionMatrix]) {
      expect(entry.authorization.length, `${"route" in entry ? entry.route : entry.file}: authorization rule`).toBeGreaterThan(10);
      if (entry.ownership !== "none") {
        expect(entry.negativeTests.length, `${"route" in entry ? `${entry.method} ${entry.route}` : entry.file}: negative test`).toBeGreaterThan(0);
        for (const id of entry.negativeTests) expect(testSources.includes(`[${id}]`), `negative test [${id}] exists`).toBe(true);
      }
      for (const identifier of entry.identifiers) expect(identifier.enforcement.length, `${identifier.name}: enforcement`).toBeGreaterThan(5);
    }
  });
});
