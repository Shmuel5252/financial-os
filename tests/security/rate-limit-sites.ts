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
const MODULE_NAMES: ReadonlySet<string> = new Set([...Object.keys({ consumeMutationRateLimit: 1, consumeAiRequestRateLimit: 1 }), "rateLimiterForDatabase", "MongoRateLimiter"]);
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

/** Statements that may run before the limiter: nothing else (no work, no early exit, no re-keying) may precede it. */
export const PRE_LIMITER_STATEMENTS: ReadonlySet<string> = new Set([
  "assertTrustedMutationOrigin(request);",
  "const actor = await requireActor();",
  "const section = await resolveSection(context);", // zod-validates [section] before a templated scope is built
]);
const normalized = (node: ts.Node) => node.getText().replace(/\s+/g, " ").trim();
/** The allowlisted names must be the real guards: named, non-aliased imports from their modules (never redefined in the route file),
 * and the local `resolveSection` helpers keep their exact validating bodies. */
const GUARD_IMPORTS: Readonly<Record<string, string>> = { requireActor: "@/lib/auth/actor", assertTrustedMutationOrigin: "@/lib/http/request-guards" };
export const RESOLVE_SECTION_BODIES: Readonly<Record<string, string>> = {
  "src/app/api/financial-data/[section]/route.ts": "{ return parseManualSection((await context.params).section); }",
  "src/app/api/onboarding/[section]/route.ts": "{ const { section } = await context.params; return parseOnboardingSection(section); }",
};

function checkGuards(file: string, source: ts.SourceFile, handlers: Map<string, ts.Node>, out: string[]): void {
  const imported = new Map<string, string>();
  let resolveDeclarations = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && (GUARD_IMPORTS[node.name.text] || (node.propertyName && GUARD_IMPORTS[node.propertyName.text]))) {
      const from = ((node.parent.parent.parent as ts.ImportDeclaration).moduleSpecifier as ts.StringLiteral).text;
      if (node.propertyName || GUARD_IMPORTS[node.name.text] !== from) out.push(`${file}: ${node.getText()} must be a non-aliased import from its guard module (line ${line(source, node)})`);
      else imported.set(node.name.text, from);
    }
    const name = (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
    if (name && GUARD_IMPORTS[name]) out.push(`${file}: declares ${name} locally (line ${line(source, node)})`);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "resolveSection") {
      resolveDeclarations += 1;
      if (normalized(node.body!) !== RESOLVE_SECTION_BODIES[file]) out.push(`${file}: resolveSection body changed - it must validate [section] exactly as reviewed (line ${line(source, node)})`);
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isClassDeclaration(node) || ts.isBindingElement(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === "resolveSection") {
      out.push(`${file}: resolveSection must be the pinned local function declaration (line ${line(source, node)})`);
    }
    if (ts.isImportSpecifier(node) && [node.name.text, node.propertyName?.text].includes("resolveSection")) out.push(`${file}: resolveSection must not be imported (line ${line(source, node)})`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const name of Object.keys(GUARD_IMPORTS)) if (source.text.includes(`${name}(`) && !imported.has(name)) out.push(`${file}: ${name} is not imported from ${GUARD_IMPORTS[name]}`);
  if (source.text.includes("resolveSection(") && resolveDeclarations !== 1) out.push(`${file}: resolveSection must be exactly one pinned local function declaration (found ${resolveDeclarations})`);
  for (const [method, body] of handlers) {
    const fn = body.parent as ts.FunctionLikeDeclaration;
    for (const parameter of fn.parameters ?? []) if (parameter.initializer) out.push(`${file}: ${method} parameter ${parameter.name.getText()} has a default value (it runs before the body)`);
  }
}

/** The limiter call must be an awaited expression statement directly in the handler body (or its top-level try block), keyed on the
 * `const actor = await requireActor()` binding, preceded only by PRE_LIMITER_STATEMENTS, and a top-level try must hand every error to
 * errorResponse (a catch cannot turn a 429 into success). Anything else (conditional, not awaited, swallowed, deferred, re-keyed,
 * after other work or an early exit) is reported. */
function checkStructure(source: ts.SourceFile, route: string, body: ts.Node, out: string[]): void {
  const statements = ts.isBlock(body) ? [...body.statements] : [];
  const onlyTry = statements.length === 1 && ts.isTryStatement(statements[0]!) ? statements[0] : undefined;
  const level = onlyTry ? [...onlyTry.tryBlock.statements] : statements;
  if (onlyTry && (onlyTry.finallyBlock || !onlyTry.catchClause || normalized(onlyTry.catchClause.block) !== "{ return errorResponse(error); }")) {
    out.push(`${route}: the handler's try must end in exactly \`catch (error) { return errorResponse(error); }\` (line ${line(source, onlyTry)})`);
  }
  let actorName: string | undefined;
  let limited = false;
  const allowed = new Set<ts.Node>();
  for (const statement of level) {
    if (!limited && !(ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) && ts.isCallExpression(statement.expression.expression)
      && ts.isIdentifier(statement.expression.expression.expression) && LIMITERS[statement.expression.expression.expression.text])
      && !PRE_LIMITER_STATEMENTS.has(normalized(statement))) {
      out.push(`${route}: \`${normalized(statement).slice(0, 80)}\` runs before the limiter (only ${[...PRE_LIMITER_STATEMENTS].join(" / ")} may; line ${line(source, statement)})`);
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 && init && ts.isAwaitExpression(init) && ts.isCallExpression(init.expression)
        && ts.isIdentifier(init.expression.expression) && init.expression.expression.text === "requireActor") actorName = declaration.name.text;
    }
    if (ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) && ts.isCallExpression(statement.expression.expression)) {
      const call = statement.expression.expression;
      if (ts.isIdentifier(call.expression) && LIMITERS[call.expression.text]) {
        allowed.add(call);
        const actorArgument = call.arguments[0];
        limited = true;
        if (actorName === undefined || !actorArgument || !ts.isIdentifier(actorArgument) || actorArgument.text !== actorName) {
          out.push(`${route}: the limiter is not keyed on the actor from \`await requireActor()\` (line ${line(source, call)})`);
        }
        continue;
      }
    }
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
    if ([...handlers.keys()].some((method) => (result.routes.get(`${method} ${posix(relative("src/app", path)).replace(/\/route\.[a-z]+$/, "")}`)?.limiters.length ?? 0) > 0)) {
      checkGuards(file, source, handlers, result.structure);
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
 * Also: any local declaration that shadows a limiter wrapper name; any reference to an imported limiter-module name that is not the
 * direct callee of a call (parenthesised, aliased, re-exported or passed as a value); any import()/require() of a non-literal path. */
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
      if (ts.isIdentifier(node) && MODULE_NAMES.has(node.text) && !ts.isImportSpecifier(node.parent)
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node) && !((ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent)) && node.parent.name === node)) {
        out.push(`${file} non-call reference to ${node.text} (line ${line(source, node)})`);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        && !(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))) out.push(`${file} non-literal module path (line ${line(source, node)})`);
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
