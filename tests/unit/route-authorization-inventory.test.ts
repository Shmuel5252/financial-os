import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { pageMatrix, routeMatrix, serverActionMatrix } from "../security/route-authorization-matrix";

// Phase 18 row 18-14: every API route method, page/layout and server-action module must be classified in the matrix, and every
// ownership boundary must name a REAL negative test (an id in an it()/test() title - not a comment, not a skipped test) beyond
// authentication alone. Exports are read with the TypeScript compiler; any export form that cannot be accounted for fails.
const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
// Next.js route segment configuration exports (not request handlers).
const ROUTE_CONFIG = new Set(["dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration", "generateStaticParams"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|mts)$/;
const AUTH_ONLY = new Set(["iso-unauthenticated", "iso-mutation-origin"]);

function files(directory: string, match: (path: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path, match) : match(path) ? [path] : [];
  });
}
const posix = (path: string) => path.split(sep).join("/");

/** Names exported by a module; throws for export forms the inventory cannot account for (export *, computed/destructured patterns it cannot name). */
function exportedNames(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const exported = (node: ts.Node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const bind = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) { names.push(name.text); return; }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.dotDotDotToken) throw new Error(`${path}: rest export cannot be inventoried`);
      bind(element.name);
    }
  };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) throw new Error(`${path}: \`export *\` cannot be inventoried`);
      for (const element of statement.exportClause.elements) names.push(element.name.text);
    } else if (ts.isExportAssignment(statement)) names.push("default");
    else if (!exported(statement)) continue;
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bind(declaration.name);
    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      const isDefault = ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      names.push(isDefault ? "default" : statement.name.text);
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) continue;
    else throw new Error(`${path}: unrecognised export form`);
  }
  return names;
}

/** Ids that appear as `[id]` at the start of a real it()/test() title (not it.skip/it.todo, not comments). */
function liveTestIds(): Set<string> {
  const ids = new Set<string>();
  for (const path of files("tests", (p) => /\.test\.(ts|tsx)$/.test(p))) {
    const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const match of text.matchAll(/(?<![.\w])(?:it|test)\(\s*(["'`])\[([a-z0-9-]+)\]/g)) ids.add(match[2]!);
  }
  return ids;
}

describe("authorization inventory (18-14)", () => {
  it("classifies exactly every exported route method; route files export nothing else unexplained", () => {
    const actual: string[] = [];
    for (const path of files("src/app", (p) => /[\\/]route\.[a-z]+$/.test(p))) {
      expect(SOURCE.test(path), `${path}: route file extension`).toBe(true);
      const route = posix(relative("src/app", path)).replace(/\/route\.[a-z]+$/, "");
      const names = exportedNames(path);
      const unexplained = names.filter((name) => !HTTP.has(name) && !ROUTE_CONFIG.has(name));
      expect(unexplained, `${route}: exports that are neither handlers nor route config`).toEqual([]);
      const handlers = names.filter((name) => HTTP.has(name));
      expect(handlers.length, `${route}: exports no handler`).toBeGreaterThan(0);
      actual.push(...handlers.map((m) => `${m} /${route}`));
    }
    const classified = routeMatrix.map((e) => `${e.method} /${e.route}`);
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual([...new Set(actual)].sort());
  });

  it("classifies exactly every page and layout (server components read params/searchParams and sessions too)", () => {
    const actual = files("src/app", (p) => /[\\/](page|layout|template|default)\.[a-z]+$/.test(p)).map((p) => posix(p)).sort();
    expect(pageMatrix.map((e) => e.file).sort()).toEqual(actual);
  });

  it("classifies exactly every server-action module", () => {
    const actual = files("src", (p) => SOURCE.test(p)).filter((p) => /^\s*["']use server["']/m.test(readFileSync(p, "utf8"))).map(posix).sort();
    expect(serverActionMatrix.map((e) => e.file).sort()).toEqual(actual);
  });

  it("separates authentication from authorization and names a real, non-authentication negative test for every ownership boundary", () => {
    const live = liveTestIds();
    const entries = [...routeMatrix.map((e) => ({ key: `${e.method} ${e.route}`, ...e })), ...pageMatrix.map((e) => ({ key: e.file, ...e })),
      ...serverActionMatrix.map((e) => ({ key: e.file, ...e }))];
    for (const entry of entries) {
      expect(entry.authorization.length, `${entry.key}: authorization rule`).toBeGreaterThan(10);
      for (const id of entry.negativeTests) expect(live.has(id), `${entry.key}: [${id}] is a live it()/test() title`).toBe(true);
      if (entry.ownership !== "none") {
        expect(entry.negativeTests.some((id) => !AUTH_ONLY.has(id)), `${entry.key}: needs an ownership/isolation test beyond authentication`).toBe(true);
      }
      for (const identifier of entry.identifiers) expect(identifier.enforcement.length, `${entry.key} ${identifier.name}: enforcement`).toBeGreaterThan(5);
    }
  });
});
