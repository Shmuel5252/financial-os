import { existsSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Phase 18 rows 18-07/18-20: every place where repository code can write to a log, terminal or telemetry sink.
// Keys are `<file> <kind>`; values count occurrences. Line numbers are deliberately not part of the key.
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
export const EMISSION_ROOTS = ["src", "workers", "scripts"] as const;
const ROOT_CONFIG = ["next.config.ts", "next.config.mjs", "next.config.js"];
const CONFIG_KEYS = new Set(["logger", "debug", "logging"]);
const PROCESS_STREAMS = new Set(["stdout", "stderr", "emitWarning"]);

export function emissionSites(): Map<string, number> {
  const sites = new Map<string, number>();
  const paths = [...EMISSION_ROOTS.flatMap((root) => files(root, (p) => SOURCE.test(p))), ...ROOT_CONFIG.filter((p) => existsSync(p))];
  for (const path of paths) {
    const file = path.split(sep).join("/");
    const add = (kind: string) => sites.set(`${file} ${kind}`, (sites.get(`${file} ${kind}`) ?? 0) + 1);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "console") {
        const parent = node.parent;
        add(ts.isPropertyAccessExpression(parent) && parent.expression === node ? `console.${parent.name.text}` : "console");
      } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process"
        && PROCESS_STREAMS.has(node.name.text)) add(`process.${node.name.text}`);
      else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "emit") add("emit");
      else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node))
        && node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && CONFIG_KEYS.has(node.name.text)
        && ts.isObjectLiteralExpression(node.parent)) add(`config:${node.name.text}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}
