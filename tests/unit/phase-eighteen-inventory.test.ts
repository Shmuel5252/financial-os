import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("Phase 18 source collection inventory (no database access)", () => {
  it("documents every literal factory, manual-section, auth and offline migration collection exactly once", () => {
    const names = new Set<string>();
    for (const path of sourceFiles("src/lib")) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "collection" && node.arguments[0] !== undefined
          && ts.isStringLiteral(node.arguments[0])) names.add(node.arguments[0].text);
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
          if (["sectionCollections", "financialOsAuthCollections"].includes(node.name.text)) {
            const literals = (child: ts.Node): void => {
              if (ts.isStringLiteral(child)) names.add(child.text);
              ts.forEachChild(child, literals);
            };
            literals(node.initializer);
          }
          if (["archives", "manifests", "locks"].includes(node.name.text)
            && ts.isStringLiteral(node.initializer) && node.initializer.text.startsWith("bankDevelopment")) {
            names.add(node.initializer.text);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    const inventory = readFileSync("PHASE_18_DATA_INVENTORY.md", "utf8");
    const rows = [...inventory.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((match) => match[1]);
    expect(names.size).toBeGreaterThan(50);
    expect(rows).toHaveLength(new Set(rows).size);
    expect(rows.sort()).toEqual([...names].sort());
  });

  it("keeps both authoritative master-plan copies identical", () => {
    expect(readFileSync("MASTER_PLAN.md", "utf8")).toBe(readFileSync("FINANCIAL_OS_MASTER_PROMPT.md", "utf8"));
  });
});
