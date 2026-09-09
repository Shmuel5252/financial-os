import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
}

it("classifies every existing inventory collection in the backup secret boundary", () => {
  const base = readFileSync("PHASE_18_DATA_INVENTORY.md", "utf8");
  const boundary = readFileSync("PHASE_18_BACKUP_BOUNDARY.md", "utf8");
  const names = (text: string) => [...text.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(match => match[1]).sort();
  expect(names(boundary)).toEqual(names(base));
  expect(names(boundary)).toHaveLength(52);
});

it("lists every source createIndex definition, including manual templates and offline indexes", () => {
  const inventory = readFileSync("PHASE_18_INDEX_INVENTORY.md", "utf8");
  let count = 0;
  for (const file of files("src")) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createIndex") {
        count++;
        const options = node.arguments[1];
        expect(options !== undefined && ts.isObjectLiteralExpression(options)).toBe(true);
        if (options && ts.isObjectLiteralExpression(options)) {
          const name = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "name");
          expect(name && ts.isPropertyAssignment(name)).toBeTruthy();
          if (name && ts.isPropertyAssignment(name)) {
            const text = name.initializer.getText(source).slice(1, -1);
            expect(inventory.includes(text)).toBe(true);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(count).toBeGreaterThan(75);
});
