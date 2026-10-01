import { readFileSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Shared by the Phase 18 collection inventory (18-07/18-20) tests: what the source says about collections, without a database.
const posix = (path: string) => path.split(sep).join("/");
const sourceFiles = (root: string) => files(root, (p) => /\.(ts|tsx)$/.test(p));
const LISTS = ["sectionCollections", "financialOsAuthCollections", "LEDGER_COLLECTIONS"];
const BANK_DEVELOPMENT = ["archives", "manifests", "locks"];

/** Literal factory, manual-section, auth, ledger and offline migration collection names under src/lib. */
export function discoverCollections(): Set<string> {
  const names = new Set<string>();
  for (const path of sourceFiles("src/lib")) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "collection" && node.arguments[0] !== undefined
        && ts.isStringLiteral(node.arguments[0])) names.add(node.arguments[0].text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        if (LISTS.includes(node.name.text)) {
          const literals = (child: ts.Node): void => {
            if (ts.isStringLiteral(child)) names.add(child.text);
            ts.forEachChild(child, literals);
          };
          literals(node.initializer);
        }
        if (BANK_DEVELOPMENT.includes(node.name.text)
          && ts.isStringLiteral(node.initializer) && node.initializer.text.startsWith("bankDevelopment")) {
          names.add(node.initializer.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return names;
}

/**
 * Top-level document properties per collection, read by the TypeScript type checker from every `.collection<T>("name")`
 * call in src (union over all declarations of a collection), plus the ManualRecordDocument properties shared by every manual
 * section. Collections only ever opened untyped are absent.
 */
export function typedCollectionFields(): { fields: Map<string, Set<string>>; manualFields: Set<string> } {
  const config = ts.getParsedCommandLineOfConfigFile("tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)); } });
  if (config === undefined) throw new Error("tsconfig.json could not be read");
  const roots = config.fileNames.filter((name) => posix(name).includes("/src/") || posix(name).startsWith("src/"));
  const program = ts.createProgram(roots, { ...config.options, noEmit: true, incremental: false });
  const checker = program.getTypeChecker();
  const fields = new Map<string, Set<string>>();
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !posix(source.fileName).includes("/src/")) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "collection"
        && node.typeArguments?.length === 1 && node.arguments[0] !== undefined) {
        // A literal, or a constant whose type is one string literal (e.g. `as const` maps); `string`-typed names stay unresolved.
        const argument = checker.getTypeAtLocation(node.arguments[0]);
        if (argument.isStringLiteral()) {
          const names = checker.getPropertiesOfType(checker.getTypeFromTypeNode(node.typeArguments[0]!)).map((symbol) => symbol.getName());
          const known = fields.get(argument.value) ?? new Set<string>();
          for (const name of names) known.add(name);
          fields.set(argument.value, known);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  // Manual sections are opened through `sectionCollections[section]` (a `string`): every one of them stores ManualRecordDocument.
  const manual = program.getSourceFile(program.getRootFileNames().find((name) => posix(name).endsWith("src/lib/onboarding/manual-record-repository.ts"))!);
  const alias = manual?.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === "ManualRecordDocument");
  if (alias === undefined) throw new Error("ManualRecordDocument not found");
  const manualFields = checker.getPropertiesOfType(checker.getTypeAtLocation(alias.name)).map((symbol) => symbol.getName());
  return { fields, manualFields: new Set(manualFields) };
}

const DELETE_METHODS = new Set(["deleteOne", "deleteMany", "findOneAndDelete", "drop", "dropDatabase", "dropCollection", "bulkWrite", "remove"]);

/** Hard-delete calls and TTL index options in repository code, as `<file> <method>` / `<file> expireAfterSeconds` -> count. */
export function retentionSites(): Map<string, number> {
  const sites = new Map<string, number>();
  for (const root of ["src", "workers", "scripts"]) {
    for (const path of files(root, (p) => /\.(ts|tsx|js|mjs|cjs|mts)$/.test(p))) {
      const file = posix(path);
      const add = (kind: string) => sites.set(`${file} ${kind}`, (sites.get(`${file} ${kind}`) ?? 0) + 1);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && DELETE_METHODS.has(node.expression.name.text)) add(node.expression.name.text);
        if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
          && node.name.text === "expireAfterSeconds") add("expireAfterSeconds");
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return sites;
}
