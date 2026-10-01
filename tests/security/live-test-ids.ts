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
/** `ctx.skip()` / `context.skip()` / a destructured `skip()` anywhere in the body makes the test dead. */
const skipsItself = (node: ts.Node): boolean => (ts.isCallExpression(node)
  && ((ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "skip") || (ts.isIdentifier(node.expression) && node.expression.text === "skip")))
  || ts.forEachChild(node, skipsItself) === true;
/** A test function that receives `{ skip }` from its context can skip itself. */
const receivesSkip = (body: ts.ArrowFunction | ts.FunctionExpression) => body.parameters.some((parameter) =>
  ts.isObjectBindingPattern(parameter.name) && parameter.name.elements.some((element) => (element.propertyName ?? element.name).getText() === "skip"));
const exits = (node: ts.Node): boolean => ts.isReturnStatement(node) || ts.isThrowStatement(node)
  || (!ts.isFunctionLike(node) && ts.forEachChild(node, exits) === true);
/** A `return`/`throw` reachable before the first statement that asserts (e.g. `if (!process.env.X) return;`) can end the test silently. */
function exitsBeforeAsserting(body: ts.ArrowFunction | ts.FunctionExpression, helpers: ReadonlyMap<string, ts.Node>): boolean {
  if (!ts.isBlock(body.body)) return false;
  for (const statement of body.body.statements) {
    if (asserts(statement, helpers)) return false;
    if (exits(statement)) return true;
  }
  return false;
}
/** A call whose callee is (or is called from) `describe.skipIf(...)`, `it.runIf(...)`, `.skip`, `.todo`, an alias of one, or `.each([])`. */
function skippingCallee(callee: ts.Expression, aliases: ReadonlySet<string>): boolean {
  for (let node: ts.Expression = callee; ;) {
    if (ts.isIdentifier(node)) return aliases.has(node.text);
    if (ts.isPropertyAccessExpression(node)) { if (SKIPPING.has(node.name.text)) return true; node = node.expression; }
    else if (ts.isCallExpression(node)) {
      const table = node.arguments[0];
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "each" && table && ts.isArrayLiteralExpression(table) && table.elements.length === 0) return true;
      node = node.expression;
    } else if (ts.isParenthesizedExpression(node)) node = node.expression;
    else return false;
  }
}
/** File-level names bound to a skipping describe/it (`const d = describe.skipIf(true)`, `const s = it.skip`). */
function skippingAliases(source: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !aliases.has(node.name.text)
        && (ts.isPropertyAccessExpression(node.initializer) || ts.isCallExpression(node.initializer) || ts.isIdentifier(node.initializer))
        && skippingCallee(node.initializer, aliases)) { aliases.add(node.name.text); changed = true; }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return aliases;
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
 * (expect*), never skips itself (`ctx.skip()`, a destructured `skip`), cannot `return`/`throw` before its first assertion, is not
 * placed conditionally (if/switch/loop/&&/ternary) and is not inside describe.skip/todo, a chained describe.skipIf(...)/runIf(...),
 * an alias of one, or an empty `.each([])`. The env-gated `(uri ? describe : describe.skip)` form used by the
 * integration suites stays live: CI fails if their database URIs are missing (route-authorization-inventory.test.ts).
 */
export function liveTestIds(): Set<string> {
  const ids = new Set<string>();
  for (const path of files("tests", (p) => /\.test\.(ts|tsx)$/.test(p))) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const helpers = localFunctions(source); const aliases = skippingAliases(source);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["it", "test"].includes(node.expression.text)) {
        const [title, body] = node.arguments;
        const match = title && ts.isStringLiteralLike(title) ? /^\[([a-z0-9-]+)\]/.exec(title.text) : null;
        let dead = body === undefined || !(ts.isArrowFunction(body) || ts.isFunctionExpression(body)) || !asserts(body, helpers) || skipsItself(body)
          || receivesSkip(body) || exitsBeforeAsserting(body, helpers);
        for (let child: ts.Node = node, parent: ts.Node | undefined = node.parent; parent && !dead; child = parent, parent = parent.parent) {
          // Conditional placement: if/else, `cond && it(...)`, ternaries, switch/loops around the declaration.
          if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent) || ts.isSwitchStatement(parent)
            || ts.isIterationStatement(parent, false)) dead = true;
          // Inside a skipped/conditional describe: describe.skip(...), describe.skipIf(c)(...), it.todo(...).
          if (ts.isCallExpression(parent) && parent.expression !== child && skippingCallee(parent.expression, aliases)) dead = true;
        }
        if (match && !dead) ids.add(match[1]!);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return ids;
}
