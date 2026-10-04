import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// CI dependency-audit gate: `npm audit` over ALL dependencies (dev included), failing on any high/critical advisory, with ONE
// temporary Owner-approved exception (2026-10-04, PHASE_18_AUDIT_EXCEPTION.md): GHSA-vfj7-8cjw-p6xm in braces@3.0.3, reachable only
// through dev lint tooling and never called by it. The exception is pinned to the exact state investigated on 2026-10-04 and fails
// closed on any difference: another high/critical advisory, another path/copy/version, an available fix or patched release, the
// configuration that would make the vulnerable code run, malformed output, or the hard expiry. No automatic renewal: extending it
// needs a new Owner decision on fresh evidence. When it fails because the advisory is gone or fixed, delete this exception.
export const EXCEPTION = Object.freeze({
  advisory: "GHSA-vfj7-8cjw-p6xm",
  approved: "2026-10-04",
  expiresAt: "2026-11-03T00:00:00.000Z", // the gate fails from 2026-11-03 00:00 UTC onwards
  // Installed chain, root devDependency first; each package exactly one copy, dev-only.
  chain: [["eslint-config-next", "16.3.8"], ["@next/eslint-plugin-next", "16.3.8"], ["fast-glob", "3.3.1"], ["micromatch", "4.0.8"], ["braces", "3.0.3"]],
  // Every braces version published on 2026-10-04 (none patched); a new release of any kind fails the gate.
  bracesVersions: ["0.1.0", "0.1.1", "0.1.2", "0.1.4", "0.1.5", "1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.6.0", "1.7.0", "1.8.0",
    "1.8.1", "1.8.2", "1.8.3", "1.8.4", "1.8.5", "2.0.0", "2.0.1", "2.0.2", "2.0.3", "2.0.4", "2.1.0", "2.1.1", "2.2.0", "2.2.1", "2.2.2", "2.3.0", "2.3.1",
    "2.3.2", "3.0.0", "3.0.1", "3.0.2", "3.0.3"],
  bracesLatest: "3.0.3",
});

// npm's proposed "fix" on 2026-10-04 is a semver-major DOWNGRADE to eslint-config-next 14.2.35 (peer eslint ^7||^8; this repository
// runs ESLint 9 flat config), i.e. not an applicable fix. It is pinned: any other fixAvailable value fails the gate.
const notAFix = { name: "eslint-config-next", version: "14.2.35", isSemVerMajor: true };
/** The exact npm audit (report v2) high-severity entries investigated on 2026-10-04. */
const APPROVED_ENTRIES = {
  "@next/eslint-plugin-next": { name: "@next/eslint-plugin-next", severity: "high", isDirect: false, via: ["fast-glob"], effects: ["eslint-config-next"],
    range: ">=14.3.0-canary.0", nodes: ["node_modules/@next/eslint-plugin-next"], fixAvailable: notAFix },
  braces: { name: "braces", severity: "high", isDirect: false, via: [{ source: 1240992, name: "braces", dependency: "braces",
    title: "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    severity: "high", cwe: ["CWE-674"], cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" }, range: "<=3.0.3" }],
    effects: ["micromatch"], range: "*", nodes: ["node_modules/braces"], fixAvailable: notAFix },
  "eslint-config-next": { name: "eslint-config-next", severity: "high", isDirect: true, via: ["@next/eslint-plugin-next"], effects: [],
    range: ">=14.3.0-canary.0", nodes: ["node_modules/eslint-config-next"], fixAvailable: notAFix },
  "fast-glob": { name: "fast-glob", severity: "high", isDirect: false, via: ["micromatch"], effects: ["@next/eslint-plugin-next"], range: "*",
    nodes: ["node_modules/fast-glob"], fixAvailable: notAFix },
  micromatch: { name: "micromatch", severity: "high", isDirect: false, via: ["braces"], effects: ["fast-glob"], range: ">=0.2.0",
    nodes: ["node_modules/micromatch"], fixAvailable: notAFix },
};
const SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".build", ".claude", ".vercel", "coverage", "out"]);
const ESLINT_CONFIG = /^(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\..+)?)$/;
const SOURCE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const DIRECT_IMPORT = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'](braces|micromatch|fast-glob)(?:\/[^"']*)?["']/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** Canonical JSON (sorted keys) for exact structural comparison. */
const canonical = (value) => JSON.stringify(value, (_key, v) => (isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const parse = (text, what, problems) => {
  try { return JSON.parse(text); } catch { problems.push(`${what}: output is not JSON`); return undefined; }
};

/**
 * Pure decision: [] means the audit passes (no high/critical advisory except the exact approved one). Every unexpected shape or
 * value adds a problem - the gate never passes on input it does not fully recognise.
 * @param {{ auditText: string, registryText: string, lock: unknown, eslintConfigs: { path: string, text: string }[], directImports: string[], now: Date }} input
 */
export function evaluateAuditGate({ auditText, registryText, lock, eslintConfigs, directImports, now }) {
  const problems = [];
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) problems.push("clock: invalid current time");
  else if (now.getTime() >= Date.parse(EXCEPTION.expiresAt)) problems.push(`exception ${EXCEPTION.advisory} expired at ${EXCEPTION.expiresAt}: remove it or obtain a new Owner decision on fresh evidence`);

  // 1. npm audit: only the approved entries may be high/critical, and they must be exactly as investigated.
  const audit = parse(auditText, "npm audit", problems);
  if (audit !== undefined) {
    const counts = isObject(audit) && isObject(audit.metadata) ? audit.metadata.vulnerabilities : undefined;
    if (!isObject(audit) || audit.auditReportVersion !== 2 || "error" in audit || !isObject(audit.vulnerabilities) || !isObject(counts)
      || ![...SEVERITIES, "total"].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) {
      problems.push("npm audit: unexpected report shape (expected auditReportVersion 2 with vulnerabilities and metadata counts)");
    } else {
      const entries = Object.entries(audit.vulnerabilities);
      for (const [name, entry] of entries) {
        if (!isObject(entry) || !SEVERITIES.has(entry.severity) || entry.name !== name) problems.push(`npm audit: unexpected entry for ${name}`);
      }
      const severe = entries.filter(([, entry]) => isObject(entry) && ["high", "critical"].includes(entry.severity)).map(([name]) => name).sort();
      if (severe.length === 0 && counts.high === 0 && counts.critical === 0) {
        problems.push(`npm audit: ${EXCEPTION.advisory} is no longer reported - delete the temporary exception and restore the plain audit gate`);
      } else {
        for (const name of severe) if (!(name in APPROVED_ENTRIES)) problems.push(`npm audit: unapproved ${audit.vulnerabilities[name].severity} advisory in ${name}`);
        for (const [name, approved] of Object.entries(APPROVED_ENTRIES)) {
          if (!(name in audit.vulnerabilities)) problems.push(`npm audit: approved entry ${name} missing - the investigated state changed`);
          else if (canonical(audit.vulnerabilities[name]) !== canonical(approved)) problems.push(`npm audit: ${name} differs from the investigated state (advisory, range, path, copies or fix changed)`);
        }
        if (counts.critical !== 0) problems.push(`npm audit: ${counts.critical} critical advisories`);
        if (counts.high !== Object.keys(APPROVED_ENTRIES).length) problems.push(`npm audit: ${counts.high} high advisories (only the ${Object.keys(APPROVED_ENTRIES).length} approved entries may be high)`);
      }
    }
  }

  // 2. Registry: no patched or any other new braces release, and latest is still the affected version.
  const registry = parse(registryText, "npm view braces", problems);
  if (registry !== undefined) {
    if (!isObject(registry) || !Array.isArray(registry.versions) || !isObject(registry["dist-tags"])) problems.push("npm view braces: unexpected shape");
    else {
      if (canonical(registry.versions) !== canonical(EXCEPTION.bracesVersions)) problems.push("npm view braces: the published versions changed (a patched or new release may exist) - re-evaluate and remove the exception");
      if (registry["dist-tags"].latest !== EXCEPTION.bracesLatest) problems.push(`npm view braces: latest is ${String(registry["dist-tags"].latest)}, not the investigated ${EXCEPTION.bracesLatest}`);
    }
  }

  // 3. Lockfile: each chain package installed exactly once, at the investigated version, dev-only, reached only through the chain.
  const packages = isObject(lock) && isObject(lock.packages) ? lock.packages : undefined;
  if (packages === undefined) problems.push("package-lock.json: unexpected shape (no packages map)");
  else {
    const dependents = (name) => Object.entries(packages).filter(([, meta]) => isObject(meta)
      && ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].some((field) => isObject(meta[field]) && name in meta[field])).map(([path]) => path).sort();
    EXCEPTION.chain.forEach(([name, version], index) => {
      const copies = Object.keys(packages).filter((path) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
      const meta = packages[`node_modules/${name}`];
      if (copies.length !== 1 || !isObject(meta)) problems.push(`package-lock.json: ${name} has ${copies.length} installed copies (expected exactly node_modules/${name})`);
      else {
        if (meta.version !== version) problems.push(`package-lock.json: ${name} is ${String(meta.version)}, not the investigated ${version}`);
        if (meta.dev !== true) problems.push(`package-lock.json: ${name} is no longer dev-only`);
      }
      if (index === 0) {
        const root = isObject(packages[""]) ? packages[""] : {};
        const declaredIn = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].filter((field) => isObject(root[field]) && name in root[field]);
        if (canonical(declaredIn) !== canonical(["devDependencies"])) problems.push(`package-lock.json: the root declares ${name} in ${declaredIn.join(", ") || "nothing"} (expected only devDependencies)`);
      }
      const parent = index === 0 ? "" : `node_modules/${EXCEPTION.chain[index - 1][0]}`;
      if (canonical(dependents(name)) !== canonical([parent])) problems.push(`package-lock.json: ${name} is required by ${dependents(name).join(", ") || "nothing"} (expected only ${parent || "the root package"})`);
    });
  }

  // 4. Exposure guard: the vulnerable code runs only if the Next ESLint plugin globs `settings.next.rootDir`, or if repository code
  //    calls braces/micromatch/fast-glob itself. Exactly one ESLint config (eslint.config.mjs) with no `settings`/`rootDir` is allowed.
  if (canonical(eslintConfigs.map((config) => config.path)) !== canonical(["eslint.config.mjs"])) {
    problems.push(`eslint config: expected only eslint.config.mjs, found ${eslintConfigs.map((config) => config.path).join(", ") || "none"}`);
  }
  for (const config of eslintConfigs) {
    if (/rootDir|\bsettings\b/.test(config.text)) problems.push(`eslint config ${config.path}: \`settings\`/\`rootDir\` would make the Next plugin glob patterns through braces`);
  }
  for (const site of directImports) problems.push(`direct use of a vulnerable-chain package: ${site}`);
  return problems;
}

/** Repository side of the exposure guard: every ESLint config (incl. package.json eslintConfig) and any direct import of the chain. */
export function collectRepoGuards(root = ".") {
  const eslintConfigs = []; const directImports = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path); continue; }
      if (ESLINT_CONFIG.test(entry.name)) eslintConfigs.push({ path, text: readFileSync(join(root, path), "utf8") });
      if (SOURCE.test(entry.name) && path !== "scripts/audit-gate.mjs" && DIRECT_IMPORT.test(readFileSync(join(root, path), "utf8"))) directImports.push(path);
    }
  };
  walk("");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if ("eslintConfig" in manifest) eslintConfigs.push({ path: "package.json#eslintConfig", text: JSON.stringify(manifest.eslintConfig) });
  return { eslintConfigs, directImports };
}

function npm(args) {
  // npm sets npm_execpath when this runs as `npm run security:audit` (CI does): run its CLI with this node, no shell. Without it the
  // command output is empty and the gate fails closed.
  const cli = process.env.npm_execpath;
  if (!cli || !/npm-cli\.js$/.test(cli)) return "";
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.error ? "" : result.stdout; // npm audit exits non-zero when it finds advisories; the JSON body is what is judged
}

export function runAuditGate() {
  const problems = evaluateAuditGate({
    auditText: npm(["audit", "--json"]),
    registryText: npm(["view", "braces", "versions", "dist-tags", "--json"]),
    lock: JSON.parse(readFileSync("package-lock.json", "utf8")),
    ...collectRepoGuards("."),
    now: new Date(),
  });
  for (const problem of problems) console.error(`Audit gate: ${problem}`);
  if (problems.length === 0) console.info(`Audit gate: no unapproved high/critical advisories; temporary exception ${EXCEPTION.advisory} (braces@3.0.3, dev lint tooling only) expires ${EXCEPTION.expiresAt}`);
  return problems.length === 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = runAuditGate() ? 0 : 1;
