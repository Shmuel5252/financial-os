import { existsSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Phase 18 rows 18-07/18-20: every place where repository code can write to a log, terminal, telemetry or external service.
// Keys are `<file> <kind>`; values count occurrences. Line numbers are deliberately not part of the key.
//
// Kinds (anything that is not a plain, classified use shows up as its own kind and fails the inventory until classified):
// - `console.<method>` (direct member use), `console` (any other use: aliasing, destructuring, passing it, globalThis.console)
// - `process.<member>` for every member outside the inert allowlist (stdout, stderr, emitWarning, ... all count), `process` for
//   any other use of the identifier (aliasing, destructuring, element access)
// - `element:<name>` for element access with a sink-like string key (`globalThis["console"]`, `x["stdout"]`)
// - `import:<module>` / `import:<module>.<name>` for imports and require()/import() of console/process modules and of sink APIs
//   (util.debuglog/debug, fs.writeSync), `api:<name>` for other sink APIs (Console, debuglog, writeSync, sendBeacon)
// - `aws:<Command>` for every AWS SDK command named by a string or imported by name, `sdk:<package>` for every @aws-sdk module
//   string (static, dynamic or load()): each is an external write or read and is classified
// - `emit` for any `.emit(` call, `config:<key>` for logger/debug/logging configuration keys
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
export const EMISSION_ROOTS = ["src", "workers", "scripts"] as const;
const ROOT_CONFIG = ["next.config.ts", "next.config.mjs", "next.config.js"];
const CONFIG_KEYS = new Set(["logger", "debug", "logging"]);
const INERT_PROCESS = new Set(["env", "argv", "cwd", "execPath", "exit", "exitCode"]);
const SINK_KEYS = new Set(["console", "process", "stdout", "stderr", "log", "info", "warn", "error", "debug", "trace", "dir", "write", "emitWarning"]);
const SINK_MODULES = new Set(["console", "node:console", "process", "node:process"]);
const SINK_NAMED = new Map([["util", ["debuglog", "debug"]], ["node:util", ["debuglog", "debug"]], ["fs", ["writeSync"]], ["node:fs", ["writeSync"]]]);
const SINK_APIS = new Set(["Console", "debuglog", "writeSync", "sendBeacon"]);

export function emissionSites(): Map<string, number> {
  const sites = new Map<string, number>();
  const paths = [...EMISSION_ROOTS.flatMap((root) => files(root, (p) => SOURCE.test(p))), ...ROOT_CONFIG.filter((p) => existsSync(p))];
  for (const path of paths) {
    const file = path.split(sep).join("/");
    const add = (kind: string) => sites.set(`${file} ${kind}`, (sites.get(`${file} ${kind}`) ?? 0) + 1);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const moduleUse = (specifier: string, names: readonly string[]) => {
      if (SINK_MODULES.has(specifier)) add(`import:${specifier}`);
      for (const name of SINK_NAMED.get(specifier) ?? []) if (names.includes(name)) add(`import:${specifier}.${name}`);
    };
    const visit = (node: ts.Node): void => {
      const parent = node.parent;
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause; const bindings = clause?.namedBindings;
        const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map((e) => (e.propertyName ?? e.name).text) : ["*"];
        moduleUse(node.moduleSpecifier.text, names.includes("*") ? [...(SINK_NAMED.get(node.moduleSpecifier.text) ?? [])] : names);
      } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
        && ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
        moduleUse(node.arguments[0].text, [...(SINK_NAMED.get(node.arguments[0].text) ?? [])]);
      } else if (ts.isIdentifier(node) && node.text === "console") {
        add(ts.isPropertyAccessExpression(parent) && parent.expression === node ? `console.${parent.name.text}` : "console");
      } else if (ts.isIdentifier(node) && node.text === "process" && !(ts.isPropertyAccessExpression(parent) && parent.name === node)) {
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) { if (!INERT_PROCESS.has(parent.name.text)) add(`process.${parent.name.text}`); }
        else add("process");
      } else if (ts.isIdentifier(node) && SINK_APIS.has(node.text) && !ts.isImportSpecifier(parent)) {
        add(`api:${node.text}`);
      } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && SINK_KEYS.has(node.argumentExpression.text)) {
        add(`element:${node.argumentExpression.text}`);
      } else if (ts.isStringLiteralLike(node) && /^[A-Z][A-Za-z0-9]+Command$/.test(node.text)) {
        add(`aws:${node.text}`);
      } else if (ts.isStringLiteralLike(node) && node.text.startsWith("@aws-sdk/")) {
        add(`sdk:${node.text}`);
      } else if (ts.isImportSpecifier(node) && ts.isStringLiteral(node.parent.parent.parent.moduleSpecifier)
        && node.parent.parent.parent.moduleSpecifier.text.startsWith("@aws-sdk/") && /Command$/.test((node.propertyName ?? node.name).text)) {
        add(`aws:${(node.propertyName ?? node.name).text}`);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "emit") add("emit");
      else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node))
        && node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && CONFIG_KEYS.has(node.name.text)
        && ts.isObjectLiteralExpression(node.parent)) add(`config:${node.name.text}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

/** Exact source text of every console call's arguments in operator-run code (workers' CLIs and scripts), per file. */
export function operatorOutputs(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const paths = [...files("workers", (p) => /[\\/]cli\.ts$/.test(p)), ...files("scripts", (p) => p.endsWith(".mjs"))];
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "console") out.push(node.arguments.map((argument) => argument.getText().replace(/\s+/g, " ")).join(", "));
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (out.length > 0) result[path.split(sep).join("/")] = out;
  }
  return result;
}
