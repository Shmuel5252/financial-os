import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectRepoGuards, evaluateAuditGate, EXCEPTION } from "../../scripts/audit-gate.mjs";

// The temporary GHSA-vfj7-8cjw-p6xm audit exception (PHASE_18_AUDIT_EXCEPTION.md) must pass ONLY the exact state investigated on
// 2026-10-04 (recorded npm audit / npm view output and the real lockfile) and fail closed on everything else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded npm/lockfile JSON, mutated field by field by the cases below
type Json = Record<string, any>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const recordedAudit = JSON.parse(readFileSync("tests/fixtures/npm-audit-ghsa-vfj7-8cjw-p6xm.json", "utf8")) as Json;
const recordedRegistry = JSON.parse(readFileSync("tests/fixtures/npm-view-braces.json", "utf8")) as Json;
const realLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as Json;
const config = { path: "eslint.config.mjs", text: readFileSync("eslint.config.mjs", "utf8") };
const before = new Date("2026-10-04T12:00:00.000Z");

function gate(change: { audit?: (a: Json) => void; registry?: (r: Json) => void; lock?: (l: Json) => void; auditText?: string; registryText?: string;
  lockValue?: unknown; eslintConfigs?: { path: string; text: string }[]; directImports?: string[]; now?: Date } = {}): string[] {
  const audit = clone(recordedAudit); change.audit?.(audit);
  const registry = clone(recordedRegistry); change.registry?.(registry);
  const lock = clone(realLock); change.lock?.(lock);
  return evaluateAuditGate({
    auditText: change.auditText ?? JSON.stringify(audit), registryText: change.registryText ?? JSON.stringify(registry),
    lock: "lockValue" in change ? change.lockValue : lock, eslintConfigs: change.eslintConfigs ?? [config], directImports: change.directImports ?? [], now: change.now ?? before,
  });
}
const failsWith = (problems: string[], pattern: RegExp) => { expect(problems.length).toBeGreaterThan(0); expect(problems.join("\n")).toMatch(pattern); };
const advisory = (name: string, severity: string, id: number) => ({ name, severity, isDirect: false, effects: [], range: "*", nodes: [`node_modules/${name}`], fixAvailable: true,
  via: [{ source: id, name, dependency: name, title: "synthetic", url: `https://github.com/advisories/GHSA-test-${id}`, severity, cwe: [], cvss: { score: 9, vectorString: null }, range: "*" }] });

describe("temporary audit exception GHSA-vfj7-8cjw-p6xm (scripts/audit-gate.mjs)", () => {
  it("passes the exact approved state (recorded audit, registry, real lockfile and repository) and nothing broader", () => {
    expect(gate()).toEqual([]);
    expect(collectRepoGuards(".")).toEqual({ eslintConfigs: [config], directImports: [] });
    expect(EXCEPTION).toMatchObject({ advisory: "GHSA-vfj7-8cjw-p6xm", approved: "2026-10-04", expiresAt: "2026-11-03T00:00:00.000Z" });
    // Other protections stay as the plain `npm audit --audit-level=high`: a moderate advisory alone does not fail, a high one does.
    expect(gate({ audit: (a) => { a.vulnerabilities.minimist = { ...advisory("minimist", "moderate", 900001) }; a.metadata.vulnerabilities.moderate = 1; a.metadata.vulnerabilities.total = 6; } })).toEqual([]);
  });

  it("1. fails on any unrelated high or critical advisory, or a second advisory on an approved package", () => {
    failsWith(gate({ audit: (a) => { a.vulnerabilities.lodash = advisory("lodash", "high", 900002); a.metadata.vulnerabilities.high = 6; } }), /unapproved high advisory in lodash/);
    failsWith(gate({ audit: (a) => { a.vulnerabilities.lodash = advisory("lodash", "critical", 900003); a.metadata.vulnerabilities.critical = 1; } }), /unapproved critical advisory in lodash|1 critical/);
    failsWith(gate({ audit: (a) => { a.vulnerabilities.braces.via.push(advisory("braces", "high", 900004).via[0]); } }), /braces differs from the investigated state/);
    failsWith(gate({ audit: (a) => { a.vulnerabilities.micromatch.via.push(advisory("micromatch", "high", 900005).via[0]); } }), /micromatch differs/);
    failsWith(gate({ audit: (a) => { a.metadata.vulnerabilities.high = 6; } }), /6 high advisories/);
  });

  it("2. fails on an additional or different vulnerable path or copy", () => {
    failsWith(gate({ audit: (a) => { a.vulnerabilities.braces.nodes.push("node_modules/chokidar/node_modules/braces"); } }), /braces differs/);
    failsWith(gate({ lock: (l) => { l.packages["node_modules/chokidar/node_modules/braces"] = { version: "3.0.3", dev: true }; } }), /braces has 2 installed copies/);
    failsWith(gate({ lock: (l) => { l.packages["node_modules/chokidar"] = { version: "3.6.0", dev: true, dependencies: { braces: "~3.0.2" } }; } }), /braces is required by .*node_modules\/chokidar/);
    failsWith(gate({ lock: (l) => { l.packages["node_modules/tailwindcss"] = { ...l.packages["node_modules/tailwindcss"], dependencies: { "fast-glob": "^3.3.0" } }; } }), /fast-glob is required by/);
    failsWith(gate({ lock: (l) => { delete l.packages["node_modules/braces"].dev; } }), /braces is no longer dev-only/);
    failsWith(gate({ lock: (l) => { l.packages[""].dependencies["eslint-config-next"] = "16.3.8"; } }), /root declares eslint-config-next in dependencies, devDependencies/);
    failsWith(gate({ lock: (l) => { l.packages[""].dependencies["eslint-config-next"] = "16.3.8"; delete l.packages[""].devDependencies["eslint-config-next"]; } }), /expected only devDependencies/);
  });

  it("3. fails on a changed affected version or advisory range", () => {
    failsWith(gate({ lock: (l) => { l.packages["node_modules/braces"].version = "3.0.2"; } }), /braces is 3\.0\.2, not the investigated 3\.0\.3/);
    failsWith(gate({ lock: (l) => { l.packages["node_modules/fast-glob"].version = "3.3.3"; } }), /fast-glob is 3\.3\.3/);
    failsWith(gate({ audit: (a) => { a.vulnerabilities.braces.via[0].range = "<=3.0.4"; } }), /braces differs/);
  });

  it("4. fails when npm reports a fix or a patched/new braces release appears", () => {
    failsWith(gate({ audit: (a) => { for (const entry of Object.values(a.vulnerabilities) as Json[]) entry.fixAvailable = true; } }), /differs from the investigated state/);
    failsWith(gate({ audit: (a) => { a.vulnerabilities.braces.fixAvailable = { name: "eslint-config-next", version: "16.4.0", isSemVerMajor: false }; } }), /braces differs/);
    failsWith(gate({ registry: (r) => { r.versions.push("3.0.4"); } }), /published versions changed/);
    failsWith(gate({ registry: (r) => { r["dist-tags"].latest = "3.0.4"; } }), /latest is 3\.0\.4/);
    failsWith(gate({ registry: (r) => { r.versions.push("4.0.0-beta.1"); } }), /published versions changed/);
  });

  it("5. hard-expires at 2026-11-03 00:00 UTC (no renewal path)", () => {
    expect(gate({ now: new Date("2026-11-02T23:59:59.999Z") })).toEqual([]);
    failsWith(gate({ now: new Date("2026-11-03T00:00:00.000Z") }), /expired at 2026-11-03/);
    failsWith(gate({ now: new Date("2027-06-01T00:00:00.000Z") }), /expired/);
    failsWith(gate({ now: new Date("not a date") }), /invalid current time/);
  });

  it("6. fails when configuration or code would make the vulnerable code reachable", () => {
    failsWith(gate({ eslintConfigs: [{ path: "eslint.config.mjs", text: `${config.text}\nexport const x = { settings: { next: { rootDir: "apps/*/" } } };` }] }), /settings`\/`rootDir/);
    failsWith(gate({ eslintConfigs: [{ path: "eslint.config.mjs", text: config.text.replace("defineConfig([", "defineConfig([{ settings: { next: {} } },") }] }), /settings`\/`rootDir/);
    failsWith(gate({ eslintConfigs: [config, { path: "apps/web/.eslintrc.json", text: "{}" }] }), /expected only eslint\.config\.mjs/);
    failsWith(gate({ eslintConfigs: [config, { path: "package.json#eslintConfig", text: "{}" }] }), /expected only eslint\.config\.mjs/);
    failsWith(gate({ eslintConfigs: [] }), /found none/);
    failsWith(gate({ directImports: ["scripts/find-files.mjs"] }), /direct use of a vulnerable-chain package: scripts\/find-files\.mjs/);
    // The collector really finds them (temporary directory outside the repository).
    const root = mkdtempSync(join(tmpdir(), "audit-gate-"));
    try {
      mkdirSync(join(root, "src")); mkdirSync(join(root, "node_modules", "x"), { recursive: true });
      writeFileSync(join(root, "eslint.config.mjs"), "export default [{ settings: { next: { rootDir: 'a/' } } }];");
      writeFileSync(join(root, ".eslintrc.cjs"), "module.exports = {};");
      // Built at run time so this test file itself never matches the repository scan.
      const quoted = (name: string) => `"${name}"`;
      writeFileSync(join(root, "src", "a.ts"), `import fg from ${quoted("fast-glob")};`);
      writeFileSync(join(root, "src", "b.cjs"), `const m = require( ${quoted("micromatch/lib")} );`);
      writeFileSync(join(root, "src", "c.mts"), `const b = await import(${quoted("braces")});`);
      writeFileSync(join(root, "node_modules", "x", "d.js"), `require(${quoted("braces")});`); // dependencies are judged by the lockfile, not scanned
      writeFileSync(join(root, "package.json"), JSON.stringify({ eslintConfig: { settings: {} } }));
      const guards = collectRepoGuards(root);
      expect(guards.eslintConfigs.map((c) => c.path).sort()).toEqual([".eslintrc.cjs", "eslint.config.mjs", "package.json#eslintConfig"]);
      expect(guards.directImports.sort()).toEqual(["src/a.ts", "src/b.cjs", "src/c.mts"]);
      failsWith(gate(guards), /rootDir|expected only/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("7. fails closed on malformed or unexpected audit, registry or lockfile input", () => {
    failsWith(gate({ auditText: "" }), /npm audit: output is not JSON/);
    failsWith(gate({ auditText: "npm ERR! network" }), /not JSON/);
    failsWith(gate({ auditText: JSON.stringify({ error: { code: "ENOAUDIT", summary: "registry unavailable" } }) }), /unexpected report shape/);
    failsWith(gate({ audit: (a) => { a.auditReportVersion = 1; } }), /unexpected report shape/);
    failsWith(gate({ audit: (a) => { delete a.vulnerabilities; } }), /unexpected report shape/);
    failsWith(gate({ audit: (a) => { a.metadata.vulnerabilities.high = "5"; } }), /unexpected report shape/);
    failsWith(gate({ audit: (a) => { a.vulnerabilities.braces.severity = "severe"; } }), /unexpected entry for braces/);
    failsWith(gate({ auditText: "[]" }), /unexpected report shape/);
    failsWith(gate({ registryText: "" }), /npm view braces: output is not JSON/);
    failsWith(gate({ registry: (r) => { delete r["dist-tags"]; } }), /npm view braces: unexpected shape/);
    failsWith(gate({ lockValue: null }), /package-lock\.json: unexpected shape/);
    failsWith(gate({ lockValue: { lockfileVersion: 3 } }), /unexpected shape/);
  });

  it("fails when the advisory is no longer reported, so the exception is removed rather than left dormant", () => {
    failsWith(gate({ audit: (a) => { a.vulnerabilities = {}; a.metadata.vulnerabilities.high = 0; a.metadata.vulnerabilities.total = 0; } }), /no longer reported - delete the temporary exception/);
  });
});
