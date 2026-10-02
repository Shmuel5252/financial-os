import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Phase 18 row 18-05: which limiter each route handler actually consumes, read from the source with the TypeScript AST.
// `<METHOD> <route>` -> the ordered list of `<kind>:<scope>` the handler calls (kind = mutation | ai), following calls into same-file
// helper functions. Scopes are the literal/template text (e.g. `onboarding-${section}`). Also reports every limiter call outside a
// route handler (`unrouted`), so a limiter wired somewhere else cannot be missed.
const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const LIMITERS: Readonly<Record<string, "mutation" | "ai">> = { consumeMutationRateLimit: "mutation", consumeAiRequestRateLimit: "ai" };
const posix = (path: string) => path.split(sep).join("/");

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

export function routeLimiterUses(): { routes: Map<string, RouteLimiterUse>; unrouted: string[] } {
  const routes = new Map<string, RouteLimiterUse>(); const unrouted: string[] = [];
  for (const path of files("src", (p) => /\.(ts|tsx)$/.test(p))) {
    const file = posix(path);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const helpers = new Map<string, ts.Node>();
    const handlers = new Map<string, ts.Node>();
    for (const statement of source.statements) {
      const exported = (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
        (exported && HTTP.has(statement.name.text) && file.endsWith("/route.ts") ? handlers : helpers).set(statement.name.text, statement.body);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            (exported && HTTP.has(declaration.name.text) && file.endsWith("/route.ts") ? handlers : helpers).set(declaration.name.text, declaration.initializer.body);
          }
        }
      }
    }
    const walk = (node: ts.Node, out: { limiters: string[]; order: string[] }, seen: Set<string>): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const kind = LIMITERS[name];
        if (kind) { const entry = `${kind}:${scopeText(node, kind)}`; out.limiters.push(entry); out.order.push("limiter"); }
        else if (STEP_CALLS[name]) out.order.push(STEP_CALLS[name]!);
        else if (helpers.has(name) && !seen.has(name)) { seen.add(name); walk(helpers.get(name)!, out, seen); }
      }
      ts.forEachChild(node, (child) => walk(child, out, seen));
    };
    const inHandlers = new Set<ts.Node>();
    for (const [method, body] of handlers) {
      const out = { limiters: [] as string[], order: [] as string[] };
      walk(body, out, new Set());
      const route = posix(relative("src/app", path)).replace(/\/route\.ts$/, "");
      routes.set(`${method} ${route}`, out);
      inHandlers.add(body);
    }
    // Limiter calls anywhere else in src/ (services, pages, server actions, the limiter module's own wrappers excluded).
    if (file !== "src/lib/security/rate-limiter.ts") {
      const scan = (node: ts.Node, insideHandler: boolean): void => {
        const inside = insideHandler || inHandlers.has(node) || [...helpers.values()].includes(node) && file.endsWith("/route.ts");
        if (!inside && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && LIMITERS[node.expression.text]) unrouted.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        ts.forEachChild(node, (child) => scan(child, inside));
      };
      scan(source, false);
    }
  }
  return { routes, unrouted };
}
