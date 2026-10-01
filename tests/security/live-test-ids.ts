import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export function files(directory: string, match: (path: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path, match) : match(path) ? [path] : [];
  });
}

const SKIPPING = new Set(["skip", "todo", "skipIf", "runIf", "fails"]);
/** Root identifier of a call's callee chain: `expect(x).not.toBe(y)` -> expect, `expectIsolated(...)` -> expectIsolated. */
function calleeRoot(expression: ts.Expression): string | undefined {
  let node: ts.Expression = expression;
  for (;;) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node) || ts.isNonNullExpression(node)
      || ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) node = node.expression;
    else return undefined;
  }
}
/**
 * Asserts: CALLS `expect(...)`/`expect.*`/an expect* helper (expectIsolated, expectNoSentinel, ...) or a same-file helper function
 * that does. A mere identifier such as `const expected = 1` is not an assertion.
 */
function asserts(node: ts.Node, helpers: ReadonlyMap<string, ts.Node>, seen = new Set<string>()): boolean {
  if (ts.isCallExpression(node)) {
    const root = calleeRoot(node.expression);
    if (root !== undefined && /^expect/.test(root)) return true;
    const helper = root === undefined ? undefined : helpers.get(root);
    if (root !== undefined && helper && !seen.has(root)) { seen.add(root); if (asserts(helper, helpers, seen)) return true; }
  }
  return ts.forEachChild(node, (child) => asserts(child, helpers, seen) || undefined) === true;
}
/** `ctx.skip()` / `context.skip()` / `t.skip()` anywhere in the body makes the test dead. */
const skipsItself = (node: ts.Node): boolean => (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "skip")
  || ts.forEachChild(node, skipsItself) === true;
/** A call whose callee is (or is called from) `describe.skipIf(...)`, `it.runIf(...)`, `.skip`, `.todo`, ... */
function skippingCallee(callee: ts.Expression): boolean {
  for (let node: ts.Expression = callee; ;) {
    if (ts.isPropertyAccessExpression(node)) { if (SKIPPING.has(node.name.text)) return true; node = node.expression; }
    else if (ts.isCallExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
    else return false;
  }
}

function localFunctions(source: ts.SourceFile): Map<string, ts.Node> {
  const helpers = new Map<string, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) helpers.set(node.name.text, node.body);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) helpers.set(node.name.text, node.initializer.body);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return helpers;
}

/**
 * Ids that start a REAL test title: `it("[id] ...")` / `test("[id] ...")` (not it.skip/todo/skipIf), whose body CALLS an assertion
 * (expect*) and never calls `.skip()`, not placed conditionally (if/switch/loop/&&/ternary) and not inside describe.skip/todo or a
 * chained describe.skipIf(...)/runIf(...). The env-gated `(uri ? describe : describe.skip)` form used by the
 * integration suites stays live: CI fails if their database URIs are missing (route-authorization-inventory.test.ts).
 */
export function liveTestIds(): Set<string> {
  const ids = new Set<string>();
  for (const path of files("tests", (p) => /\.test\.(ts|tsx)$/.test(p))) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const helpers = localFunctions(source);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["it", "test"].includes(node.expression.text)) {
        const [title, body] = node.arguments;
        const match = title && ts.isStringLiteralLike(title) ? /^\[([a-z0-9-]+)\]/.exec(title.text) : null;
        let dead = body === undefined || !(ts.isArrowFunction(body) || ts.isFunctionExpression(body)) || !asserts(body, helpers) || skipsItself(body);
        for (let child: ts.Node = node, parent: ts.Node | undefined = node.parent; parent && !dead; child = parent, parent = parent.parent) {
          // Conditional placement: if/else, `cond && it(...)`, ternaries, switch/loops around the declaration.
          if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent) || ts.isSwitchStatement(parent)
            || ts.isIterationStatement(parent, false)) dead = true;
          // Inside a skipped/conditional describe: describe.skip(...), describe.skipIf(c)(...), it.todo(...).
          if (ts.isCallExpression(parent) && parent.expression !== child && skippingCallee(parent.expression)) dead = true;
        }
        if (match && !dead) ids.add(match[1]!);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return ids;
}
