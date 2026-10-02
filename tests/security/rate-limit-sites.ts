import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Phase 18 row 18-05: which limiter each route handler actually consumes, read from the source with the TypeScript AST.
// `<METHOD> <route>` -> the ordered list of `<kind>:<scope>` the handler calls (kind = mutation | ai), following calls into same-file
// helper functions. Scopes are the literal/template text (e.g. `onboarding-${section}`). Also reports every limiter call outside a
// route handler (`unrouted`), every structural weakness that could make a present limiter call ineffective (`structure`), every
// import of the limiter module (`imports`) and every "use server" directive (`serverActions`). Presence is not proof of effect:
// tests/integration/rate-limit-routes.integration.test.ts [rlx-route-sweep] proves each limited route is refused by its limiter.
const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const LIMITERS: Readonly<Record<string, "mutation" | "ai">> = { consumeMutationRateLimit: "mutation", consumeAiRequestRateLimit: "ai" };
const LIMITER_MODULE = "src/lib/security/rate-limiter.ts";
const posix = (path: string) => path.split(sep).join("/");
const sources = () => files("src", (p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)).map((path) => ({ path, file: posix(path),
  source: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true) }));
const line = (source: ts.SourceFile, node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

function scopeText(call: ts.CallExpression, kind: "mutation" | "ai"): string {
  if (kind === "ai") return "ai-copilot";
  const scope = call.arguments[1];
  return scope === undefined ? "?" : ts.isStringLiteralLike(scope) ? scope.text : scope.getText();
}

export type RouteLimiterUse = Readonly<{ limiters: string[]; order: string[] }>;

/** Ordered significant steps in a handler: origin, actor, limiter, body, so ordering can be pinned as well. */
const STEP_CALLS: Readonly<Record<string, string>> = {
  assertTrustedMutationOrigin: "origin", requireActor: "actor", readJsonBody: "body", requireOperatorActor: "actor",
};

type Scanned = { routes: Map<string, RouteLimiterUse>; unrouted: string[]; structure: string[] };

/** A function body does not run when its enclosing code runs: never count calls inside nested functions as the handler's own. */
const isFunction = (node: ts.Node) => ts.isFunctionLike(node) && node.kind !== ts.SyntaxKind.CallSignature;

/** The limiter call must be an awaited expression statement directly in the handler body (or its top-level try block), keyed on the
 * identifier bound by `const <x> = await requireActor()`, with no return/throw path before it. Anything else (conditional, not awaited,
 * swallowed, deferred, re-keyed, after an early return) is reported. */
function checkStructure(source: ts.SourceFile, route: string, body: ts.Node, out: string[]): void {
  const statements = ts.isBlock(body) ? [...body.statements] : [];
  const level = statements.length === 1 && ts.isTryStatement(statements[0]!) ? [...statements[0].tryBlock.statements] : statements;
  let actorName: string | undefined;
  let exitBefore = false;
  const exits = (node: ts.Node): boolean => !isFunction(node) && (ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.forEachChild(node, exits) === true);
  const allowed = new Set<ts.Node>();
  for (const statement of level) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init && ts.isAwaitExpression(init) && ts.isCallExpression(init.expression)
        && ts.isIdentifier(init.expression.expression) && init.expression.expression.text === "requireActor") actorName = declaration.name.text;
    }
    if (ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) && ts.isCallExpression(statement.expression.expression)) {
      const call = statement.expression.expression;
      if (ts.isIdentifier(call.expression) && LIMITERS[call.expression.text]) {
        allowed.add(call);
        const actorArgument = call.arguments[0];
        if (exitBefore) out.push(`${route}: a return/throw path precedes the limiter (line ${line(source, call)})`);
        if (actorName === undefined || !actorArgument || !ts.isIdentifier(actorArgument) || actorArgument.text !== actorName) {
          out.push(`${route}: the limiter is not keyed on the actor from \`await requireActor()\` (line ${line(source, call)})`);
        }
        continue;
      }
    }
    if (exits(statement)) exitBefore = true;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && LIMITERS[node.expression.text] && !allowed.has(node)) {
      out.push(`${route}: limiter call not awaited directly in the handler (conditional, deferred, wrapped or swallowed; line ${line(source, node)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

export function routeLimiterUses(): Scanned {
  const result: Scanned = { routes: new Map(), unrouted: [], structure: [] };
  for (const { path, file, source } of sources()) {
    const helpers = new Map<string, ts.Node>();
    const handlers = new Map<string, ts.Node>();
    const isRoute = /\/route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file);
    for (const statement of source.statements) {
      const exported = (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
        (exported && HTTP.has(statement.name.text) && isRoute ? handlers : helpers).set(statement.name.text, statement.body);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            (exported && HTTP.has(declaration.name.text) && isRoute ? handlers : helpers).set(declaration.name.text, declaration.initializer.body);
          }
        }
      }
    }
    // Post-order: a call's arguments run before the call itself; every call of a helper counts (recursion guarded by the stack).
    const walk = (node: ts.Node, out: { limiters: string[]; order: string[] }, stack: Set<string>): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        for (const argument of node.arguments) walk(argument, out, stack);
        const name = node.expression.text;
        const kind = LIMITERS[name];
        if (kind) { out.limiters.push(`${kind}:${scopeText(node, kind)}`); out.order.push("limiter"); }
        else if (STEP_CALLS[name]) out.order.push(STEP_CALLS[name]!);
        else if (helpers.has(name) && !stack.has(name)) { stack.add(name); walk(helpers.get(name)!, out, stack); stack.delete(name); }
        return;
      }
      ts.forEachChild(node, (child) => walk(child, out, stack));
    };
    const covered = new Set<ts.Node>();
    for (const [method, body] of handlers) {
      const out = { limiters: [] as string[], order: [] as string[] };
      walk(body, out, new Set());
      const route = posix(relative("src/app", path)).replace(/\/route\.[a-z]+$/, "");
      result.routes.set(`${method} ${route}`, out);
      covered.add(body);
      if (out.limiters.length > 0) checkStructure(source, `${method} ${route}`, body, result.structure);
    }
    if (file === LIMITER_MODULE) continue;
    // Limiter calls anywhere else in src/: in a non-handler, a helper of a route file, a page, a server action or a library module.
    const scan = (node: ts.Node, insideHandler: boolean): void => {
      const inside = insideHandler || covered.has(node);
      if (!inside && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && LIMITERS[node.expression.text]) result.unrouted.push(`${file}:${line(source, node)}`);
      ts.forEachChild(node, (child) => scan(child, inside));
    };
    scan(source, false);
  }
  return result;
}

/** Every reference to the limiter module in src/ (static/dynamic import, re-export, require): `<file> <named imports or kind>`.
 * Also any local declaration that shadows a limiter wrapper name. */
export function limiterModuleReferences(): string[] {
  const out: string[] = [];
  for (const { file, source } of sources()) {
    if (file === LIMITER_MODULE) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && /rate-limiter/.test(node.text)) {
        const parent = node.parent;
        if (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) {
          const clause = parent.importClause;
          const bindings = clause?.namedBindings;
          const named = bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map((element) => element.propertyName ? `${element.propertyName.text} as ${element.name.text}` : element.name.text) : [];
          const kind = [clause?.isTypeOnly ? "type-only" : "", clause?.name ? `default ${clause.name.text}` : "", bindings && ts.isNamespaceImport(bindings) ? `* as ${bindings.name.text}` : ""];
          out.push(`${file} ${[...named, ...kind.filter(Boolean)].sort().join(",")}`);
        } else out.push(`${file} non-import reference "${node.text}" (line ${line(source, node)})`);
      }
      const declared = (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isClassDeclaration(node)) && node.name
        && ts.isIdentifier(node.name) && LIMITERS[node.name.text];
      if (declared) out.push(`${file} declares ${node.name!.getText()} (line ${line(source, node)})`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out.sort();
}

/** Exported names of the limiter module (a new export, e.g. another limiter or policy, must be reviewed). */
export function limiterModuleExports(): string[] {
  const source = ts.createSourceFile(LIMITER_MODULE, readFileSync(LIMITER_MODULE, "utf8"), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const statement of source.statements) {
    const exported = (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(statement)) names.push(`export-declaration:${statement.getText()}`);
    if (!exported) continue;
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) names.push(statement.name.text);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) names.push(declaration.name.getText());
  }
  return names.sort();
}

/** Files containing a "use server" directive anywhere (file prologue or any function body prologue), found with the AST. */
export function serverActionFiles(): string[] {
  const out = new Set<string>();
  for (const { file, source } of sources()) {
    const prologue = (statements: readonly ts.Statement[]) => {
      for (const statement of statements) {
        if (!(ts.isExpressionStatement(statement) && ts.isStringLiteralLike(statement.expression))) return;
        if (statement.expression.text === "use server") out.add(file);
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isSourceFile(node)) prologue(node.statements);
      else if (isFunction(node)) { const body = (node as ts.FunctionLikeDeclaration).body; if (body && ts.isBlock(body)) prologue(body.statements); }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...out].sort();
}
