import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { emissionSites, operatorFileDigests } from "../security/emission-sites";
import { files, liveTestIds } from "../security/live-test-ids";
import nextConfig from "../../next.config";
import { contentSecurityPolicy, operatorFiles, operatorPowerShell, reviewedDependencies, securityHeaders, sinkMatrix } from "../security/logging-sink-matrix";

// Phase 18 rows 18-07/18-20: every emission point (console.*, process stdout/stderr/emitWarning, telemetry .emit(), logger/debug/
// logging configuration keys) in src/, workers/, scripts/ and next.config is classified exactly once, with a live sentinel test.
const parse = (path: string) => ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
function walk(node: ts.Node, visit: (node: ts.Node) => void): void { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }
const LOGGING_PACKAGES = /^(@vercel\/analytics|@vercel\/speed-insights|@next\/third-parties|pino|winston|bunyan|log4js|loglevel|signale|consola|debug|morgan|@sentry\/.*|@opentelemetry\/.*|@vercel\/otel|dd-trace|@datadog\/.*|newrelic|posthog.*|mixpanel.*|@segment\/.*|amplitude.*|logrocket.*|@logtail\/.*|@axiomhq\/.*|@highlight-run\/.*)$/;

describe("logging and telemetry sink inventory (18-07/18-20)", () => {
  it("classifies exactly every emission point, each in one sink, with live sentinel tests", () => {
    const classified = new Map<string, number>(); const live = liveTestIds();
    for (const [sink, entry] of Object.entries(sinkMatrix)) {
      for (const [site, count] of Object.entries(entry.sites)) {
        expect(classified.has(site), `${site}: classified in two sinks`).toBe(false);
        classified.set(site, count);
      }
      if (entry.logSink) expect(entry.sentinelTests.length, `${sink}: sentinel tests`).toBeGreaterThan(0);
      for (const id of entry.sentinelTests) expect(live.has(id), `${sink}: [${id}] is a live it()/test() title`).toBe(true);
      expect(Object.keys(entry.payload).length, `${sink}: payload treatment`).toBeGreaterThan(0);
    }
    expect(Object.fromEntries([...emissionSites()].sort())).toEqual(Object.fromEntries([...classified].sort()));
  }, 30_000);

  it("pins every operator-run file (scripts/, workers/*/cli.ts): any change to what an operator terminal can print needs re-review", () => {
    expect(operatorFileDigests()).toEqual(operatorFiles);
  }, 30_000);

  it("lists every PowerShell operator script", () => {
    expect(files("scripts", (p) => p.endsWith(".ps1")).map((p) => p.replaceAll("\\", "/")).sort()).toEqual(Object.keys(operatorPowerShell).sort());
  });

  it("adds no unreviewed dependency (allowlist) and enables no driver command logging in code", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, Record<string, string> | undefined>;
    const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies });
    expect(packages.sort(), "review a new package for logging/telemetry/egress, then add it to reviewedDependencies").toEqual(Object.keys(reviewedDependencies).sort());
    expect(packages.filter((name) => LOGGING_PACKAGES.test(name)), "a logging/telemetry SDK must be classified as a sink first").toEqual([]);
    for (const path of ["src", "workers", "scripts"].flatMap((root) => files(root, (p) => /\.(ts|tsx|mjs|js)$/.test(p)))) {
      expect(/monitorCommands|mongodbLog(Path|ComponentSeverities|MaxDocumentLength)|MONGODB_LOG_/.test(readFileSync(path, "utf8")), `${path}: MongoDB driver logging`).toBe(false);
    }
  });

  it("serves exactly the pinned security headers and CSP (evaluated at run time: no extra route, directive or origin can slip in)", async () => {
    expect(await nextConfig.headers?.()).toEqual(securityHeaders(contentSecurityPolicy.join("; ")));
    // Request entry points that could set headers outside next.config.ts are inventoried in route-authorization-inventory.test.ts
    // (middleware/proxy/instrumentation must not exist unclassified); a CSP string anywhere else is an emission site (`string:csp`).
  });

  it("[log-auth-config] configures Auth.js with debug: false and the redacting logger", () => {
    const values = new Map<string, string>();
    walk(parse("src/lib/auth/config.ts"), (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ["debug", "logger"].includes(node.name.text)) values.set(node.name.text, node.initializer.getText());
    });
    expect(Object.fromEntries(values)).toEqual({ debug: "false", logger: "safeAuthLogger" });
    const methods: string[] = [];
    walk(parse("src/lib/auth/safe-logger.ts"), (node) => { if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) methods.push(node.name.text); });
    expect(methods.sort(), "every Auth.js logger level is overridden").toEqual(["debug", "error", "warn"]);
  });

  it("[log-operator-scripts] operator scripts never print environment values, URIs, secrets or raw error messages", () => {
    const forbidden = /^(uri|url|password|secret|token|apiKey|key|email|credentials?|connectionString)$/i;
    for (const path of files("scripts", (p) => p.endsWith(".mjs"))) {
      walk(parse(path), (node) => {
        if (!(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console")) return;
        for (const argument of node.arguments) {
          walk(argument, (inner) => {
            if (ts.isPropertyAccessExpression(inner) && ["env", "message", "stack", "cause"].includes(inner.name.text)) expect.fail(`${path}: prints ${inner.getText()}`);
            if (ts.isIdentifier(inner) && forbidden.test(inner.text)) expect.fail(`${path}: prints ${inner.text}`);
          });
        }
      });
    }
    // The ledger-rebuild CLI prints a fixed projection of the plan (checked against plan data in [log-ledger-rebuild-output]).
    let summaryKeys: string[] = [];
    walk(parse("workers/ledger-rebuild/cli.ts"), (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "summary" && node.initializer && ts.isArrowFunction(node.initializer)) {
        const body = node.initializer.body; const literal = ts.isParenthesizedExpression(body) ? body.expression : body;
        if (ts.isObjectLiteralExpression(literal)) summaryKeys = literal.properties.map((property) => property.getText());
      }
    });
    expect(summaryKeys).toEqual(["head: plan.head", "rows: plan.rows.length", "digest: plan.digest", "baseMirror: plan.baseMirror", "baseHead: plan.baseHead",
      "mirrors: plan.mirrors", "journalApplied: plan.journalApplied"]);
  });
});
