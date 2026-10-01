import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Phase 18 rows 18-07/18-20: every place where repository code can write to a log, terminal, telemetry or external service.
// Keys are `<file> <kind>`; values count occurrences. Line numbers are deliberately not part of the key.
//
// Kinds (anything that is not a plain, classified use shows up as its own kind and fails the inventory until classified):
// - `console.<method>` (direct member use), `console` (any other use: aliasing, destructuring, passing it, `x.console`)
// - `process.<member>` for every member outside the inert allowlist (stdout, stderr, emitWarning, ... all count), `process` for
//   any other use of the identifier, including as a property name (`globalThis.process`, `window.process`)
// - `string:<s>` for the string literals "console" | "process" | "stdout" | "stderr" anywhere (`Reflect.get(globalThis, "console")`,
//   `x["stdout"]`), `global:<name>` for any reference to globalThis/global/self, `element:dynamic-global` for computed access on window
// - `import:<module>` / `import:<module>.<name>` for import, export-from, require() and import() (string or template) of
//   console/process/child_process/network modules and of named sink APIs (`import:dynamic` for a computed specifier); `api:<name>` for
//   sink APIs used anywhere (Console as a value, debuglog, fs write functions, sendBeacon, XMLHttpRequest, WebSocket, EventSource,
//   eval, Function)
// - `http:fetch` for every fetch-like call (fetch, fetchImpl, fetchImplementation, ...) whose URL is not a same-origin path literal
//   (protocol-relative `//host` counts as external); `jsx:external-url` for a literal external URL in any JSX attribute (scripts,
//   images, links, forms); `import:next/script` for Next's third-party script loader
// - `aws:<Command>` / `sdk:<package>` for AWS SDK command names and @aws-sdk modules
// - `emit` for any `.emit(` call, `config:<key>` for logger/debug/logging configuration keys
// LIMIT: this is a syntactic regression guard against accidental logging and egress. Deliberately obfuscated code beyond the flagged
// primitives (eval, Function, dynamic import, global objects) is a code-review/CodeQL concern, not something this test can prove absent.
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
export const EMISSION_ROOTS = ["src", "workers", "scripts"] as const;
const ROOT_CONFIG = ["next.config.ts", "next.config.mjs", "next.config.js"];
const CONFIG_KEYS = new Set(["logger", "debug", "logging"]);
const INERT_PROCESS = new Set(["env", "argv", "cwd", "execPath", "exit", "exitCode"]);
const SINK_STRINGS = new Set(["console", "process", "stdout", "stderr"]);
const GLOBALS = new Set(["globalThis", "global", "self"]);
const SINK_MODULES = new Set([...["console", "process", "child_process", "http", "https", "http2", "net", "tls", "dgram", "worker_threads"]
  .flatMap((name) => [name, `node:${name}`]), "next/script"]);
const FS_WRITES = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "writeSync", "writev", "writevSync", "write"];
const SINK_NAMED = new Map<string, readonly string[]>([...["util", "node:util"].map((m) => [m, ["debuglog", "debug"]] as const),
  ...["fs", "node:fs", "fs/promises", "node:fs/promises"].map((m) => [m, [...FS_WRITES, "open", "openSync", "copyFile", "cp", "rename"]] as const)]);
const SINK_APIS = new Set(["Console", "debuglog", "sendBeacon", "XMLHttpRequest", "WebSocket", "EventSource", "eval", "Function",
  ...FS_WRITES.filter((name) => name !== "write")]);
const isTypePosition = (node: ts.Node) => ts.isTypeReferenceNode(node.parent) || ts.isExpressionWithTypeArguments(node.parent) || ts.isTypeQueryNode(node.parent)
  || ts.isQualifiedName(node.parent) || ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent) || ts.isImportClause(node.parent);
const moduleText = (node: ts.Expression | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
const calleeName = (callee: ts.Expression) => (ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "");

export function emissionSites(): Map<string, number> {
  const sites = new Map<string, number>();
  const paths = [...EMISSION_ROOTS.flatMap((root) => files(root, (p) => SOURCE.test(p))), ...ROOT_CONFIG.filter((p) => existsSync(p))];
  for (const path of paths) {
    const file = path.split(sep).join("/");
    const add = (kind: string) => sites.set(`${file} ${kind}`, (sites.get(`${file} ${kind}`) ?? 0) + 1);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const moduleUse = (specifier: string | undefined, names: readonly string[] | "all") => {
      if (specifier === undefined) return;
      if (SINK_MODULES.has(specifier)) add(`import:${specifier}`);
      for (const name of SINK_NAMED.get(specifier) ?? []) if (names === "all" || names.includes(name)) add(`import:${specifier}.${name}`);
    };
    const visit = (node: ts.Node): void => {
      const parent = node.parent;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        const named = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
          ? bindings.elements.map((element) => (element.propertyName ?? element.name).text) : "all";
        moduleUse(moduleText(node.moduleSpecifier), named);
      } else if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
        const specifier = moduleText(node.arguments[0]);
        if (specifier === undefined) add("import:dynamic"); else moduleUse(specifier, "all");
      } else if (ts.isIdentifier(node) && node.text === "console" && !isTypePosition(node)) {
        add(ts.isPropertyAccessExpression(parent) && parent.expression === node ? `console.${parent.name.text}` : "console");
      } else if (ts.isIdentifier(node) && node.text === "process" && !isTypePosition(node)) {
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) { if (!INERT_PROCESS.has(parent.name.text)) add(`process.${parent.name.text}`); }
        else add("process");
      } else if (ts.isIdentifier(node) && GLOBALS.has(node.text) && !isTypePosition(node) && !ts.isModuleDeclaration(parent) && !(ts.isPropertyAccessExpression(parent) && parent.name === node)) {
        add(`global:${node.text}`);
      } else if (ts.isIdentifier(node) && SINK_APIS.has(node.text) && !isTypePosition(node)) {
        add(`api:${node.text}`);
      } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "window" && !ts.isStringLiteralLike(node.argumentExpression)) {
        add("element:dynamic-global");
      } else if (ts.isStringLiteralLike(node) && SINK_STRINGS.has(node.text)) {
        add(`string:${node.text}`);
      } else if (ts.isCallExpression(node) && /^fetch/i.test(calleeName(node.expression))) {
        const url = node.arguments[0];
        const head = url && ts.isStringLiteralLike(url) ? url.text : url && ts.isTemplateExpression(url) ? url.head.text : undefined;
        if (!(head !== undefined && head.startsWith("/") && !head.startsWith("//"))) add("http:fetch");
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && /^(https?:)?\/\//i.test(node.initializer.text)) {
        add("jsx:external-url");
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

/**
 * SHA-256 of every operator-run file (all of scripts/, every workers/<name>/cli.ts), line endings normalized. Any edit to what can
 * print to an operator terminal - including a changed VALUE behind an unchanged console call, or a PowerShell Write-Host - fails CI
 * until the pin is updated in a reviewed change.
 */
export function operatorFileDigests(): Record<string, string> {
  const paths = [...files("workers", (p) => /[\\/]cli\.ts$/.test(p)), ...files("scripts", () => true)];
  return Object.fromEntries(paths.map((path) => [path.split(sep).join("/"),
    createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex")] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1)));
}
