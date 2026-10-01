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
/** Asserts: uses `expect`/an expect* helper (expectIsolated, expectNoSentinel, ...), directly or through a same-file helper function. */
function asserts(node: ts.Node, helpers: ReadonlyMap<string, ts.Node>, seen = new Set<string>()): boolean {
  if (ts.isIdentifier(node)) {
    if (/^expect/.test(node.text)) return true;
    const helper = helpers.get(node.text);
    if (helper && !seen.has(node.text)) { seen.add(node.text); if (asserts(helper, helpers, seen)) return true; }
  }
  return ts.forEachChild(node, (child) => asserts(child, helpers, seen) || undefined) === true;
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
 * Ids that start a REAL test title: `it("[id] ...")` / `test("[id] ...")` (not it.skip/todo/skipIf), whose body asserts (expect*),
 * not nested in an `if` or in a describe.skip/todo/skipIf. The env-gated `(uri ? describe : describe.skip)` form used by the
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
        let dead = body === undefined || !(ts.isArrowFunction(body) || ts.isFunctionExpression(body)) || !asserts(body, helpers);
        for (let parent: ts.Node | undefined = node.parent; parent && !dead; parent = parent.parent) {
          if (ts.isIfStatement(parent)) dead = true;
          if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && SKIPPING.has(parent.expression.name.text)) dead = true;
        }
        if (match && !dead) ids.add(match[1]!);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return ids;
}
