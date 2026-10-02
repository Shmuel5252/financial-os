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
//   `x["stdout"]`), `string:csp` for any Content-Security-Policy header name (headers set outside next.config.ts),
//   `global:<name>` for any reference to globalThis/global/self, `element:dynamic-global` for computed access on window
// - `import:<module>` / `import:<module>.<name>` for import, export-from, require() and import() (string or template) of
//   console/process/child_process/network modules and of named sink APIs (`import:dynamic` for a computed specifier); `api:<name>` for
//   sink APIs used anywhere (Console as a value, debuglog, fs write functions, sendBeacon, XMLHttpRequest, WebSocket, EventSource,
//   eval, Function)
// - `http:fetch` for every fetch-like call (fetch, fetchImpl, fetchImplementation, ...) whose URL is not a same-origin path literal
//   (protocol-relative `//host` counts as external); `url:external` for any string or template literal that starts with an external
//   URL in src/ or workers/ (JSX attributes and expressions, constants, templates: third-party scripts, beacons, provider endpoints);
//   `import:next/script` for Next's third-party script loader
// - `aws:<Command>` / `sdk:<package>` for AWS SDK command names and @aws-sdk modules
// - `emit` for any `.emit(` call, `config:<key>` for logger/debug/logging configuration keys
// LIMIT: this is a syntactic regression guard against accidental logging and egress. Deliberately obfuscated code beyond the flagged
// primitives (eval, Function, dynamic import, global objects) is a code-review/CodeQL concern, not something this test can prove absent.
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
export const EMISSION_ROOTS = ["src", "workers", "scripts"] as const;
const ROOT_CONFIG = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"];
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
/** Callee names, seeing through parentheses and `a ?? b` / `a || b` / `cond ? a : b` (e.g. `(input.fetch ?? fetch)(...)`). */
function calleeNames(callee: ts.Expression): string[] {
  if (ts.isIdentifier(callee)) return [callee.text];
  if (ts.isPropertyAccessExpression(callee)) return [callee.name.text];
  if (ts.isParenthesizedExpression(callee) || ts.isNonNullExpression(callee) || ts.isAsExpression(callee)) return calleeNames(callee.expression);
  if (ts.isBinaryExpression(callee)) return [...calleeNames(callee.left), ...calleeNames(callee.right)];
  if (ts.isConditionalExpression(callee)) return [...calleeNames(callee.whenTrue), ...calleeNames(callee.whenFalse)];
  return [];
}

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
      } else if (ts.isStringLiteralLike(node) && /^content-security-policy(-report-only)?$/i.test(node.text)) {
        add("string:csp");
      } else if (ts.isCallExpression(node) && calleeNames(node.expression).some((name) => /^fetch/i.test(name))) {
        const url = node.arguments[0];
        const head = url && ts.isStringLiteralLike(url) ? url.text : url && ts.isTemplateExpression(url) ? url.head.text : undefined;
        if (!(head !== undefined && head.startsWith("/") && !head.startsWith("//"))) add("http:fetch");
      } else if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && /^(https?:)?\/\/[^/]/i.test(node.text) && !file.startsWith("scripts/")) {
        add("url:external");
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

/**
 * How request query strings are read or built in src/ (they reach platform request logs, F-18-20-01): `<file> query:get:<name>` for
 * `searchParams.get("name")`, `query:<member>` for any other member use (entries, getAll, ...), `query:use` for any other reference
 * (page `searchParams` props), `query:URLSearchParams` for every URLSearchParams constructed. Pinned in logging-sink-matrix.ts
 * `queryParameters`; names read through `entries()` are pinned through the parsing schema (searchQueryKeys).
 */
export function queryParameterSites(): Map<string, number> {
  const sites = new Map<string, number>();
  for (const path of files("src", (p) => /\.(ts|tsx)$/.test(p))) {
    const file = path.split(sep).join("/");
    const add = (kind: string) => sites.set(`${file} ${kind}`, (sites.get(`${file} ${kind}`) ?? 0) + 1);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "searchParams" && !isTypePosition(node)) {
        const parent = node.parent;
        const access = ts.isPropertyAccessExpression(parent) && parent.name === node ? parent : undefined;
        const member = access && ts.isPropertyAccessExpression(access.parent) && access.parent.expression === access ? access.parent : undefined;
        if (member && member.name.text === "get" && ts.isCallExpression(member.parent) && member.parent.arguments[0] && ts.isStringLiteralLike(member.parent.arguments[0])) {
          add(`query:get:${member.parent.arguments[0].text}`);
        } else if (member) add(`query:${member.name.text}`);
        else add("query:use");
      }
      // Every URLSearchParams constructed in src/ is pinned: client URLs (query strings that reach request logs) and, over-inclusively,
      // outbound provider/STS request bodies and queries.
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URLSearchParams") add("query:URLSearchParams");
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}
