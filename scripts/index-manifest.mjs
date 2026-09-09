import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : entry.name.endsWith(".ts") ? [join(root, entry.name)] : []);
}
const definitions = [];
for (const file of files("src")) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createIndex") {
      const normalized = file.replaceAll("\\", "/");
      definitions.push({ source: normalized, classification: normalized.endsWith("development-baseline.ts") ? "offline-migration" : "runtime-to-migration",
        keys: node.arguments[0]?.getText(source), options: node.arguments[1]?.getText(source),
        definitionDigest: createHash("sha256").update(node.getText(source)).digest("hex") });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (process.argv.includes("--check")) {
  if (definitions.length !== 90 || definitions.filter(item => item.classification === "offline-migration").length !== 2) throw new Error("Index inventory requires review");
  console.info("Index manifest: 90 source definitions; 88 runtime, 2 offline; no DB operation");
} else console.info(JSON.stringify({ version: "index-source-manifest-v1", executable: false, requiresCollectionResolution: true, definitions }, null, 2));
