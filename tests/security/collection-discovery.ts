import { readFileSync } from "node:fs";
import { sep } from "node:path";
import ts from "typescript";
import { files } from "./live-test-ids";

// Shared by the Phase 18 collection inventory (18-07/18-20) tests: what the source says about collections, without a database.
const posix = (path: string) => path.split(sep).join("/");
const sourceFiles = (root: string) => files(root, (p) => /\.(ts|tsx)$/.test(p));
const LISTS = ["sectionCollections", "financialOsAuthCollections", "LEDGER_COLLECTIONS"];
const BANK_DEVELOPMENT = ["archives", "manifests", "locks"];

/** Literal factory, manual-section, auth, ledger and offline migration collection names under src/ and workers/. */
export function discoverCollections(): Set<string> {
  const names = new Set<string>();
  for (const path of [...sourceFiles("src"), ...sourceFiles("workers")]) {
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

/** A document shape: every node path (`a`, `a[]`, `a[].b`, `a.*`) mapped to its child tokens (empty for leaves). */
export type DocumentTree = Map<string, Set<string>>;
const LEAF_TYPES = new Set(["Date", "ObjectId", "Binary", "Long", "Decimal128", "Timestamp", "Uint8Array", "Buffer", "RegExp", "BSONRegExp", "Double", "Int32"]);
const join = (path: string, token: string) => (path === "" ? token : token === "[]" ? `${path}[]` : `${path}.${token}`);

function addTree(checker: ts.TypeChecker, type: ts.Type, path: string, tree: DocumentTree, depth: number): void {
  const children = tree.get(path) ?? new Set<string>(); tree.set(path, children);
  if (depth > 10) return;
  const parts = type.isUnion() ? type.types : [type];
  for (const part of parts) {
    if (part.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.EnumLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void)) continue;
    if (LEAF_TYPES.has(part.getSymbol()?.getName() ?? "") || LEAF_TYPES.has(part.aliasSymbol?.getName() ?? "")) continue;
    if (checker.isArrayType(part) || checker.isTupleType(part)) {
      children.add("[]");
      for (const element of checker.getTypeArguments(part as ts.TypeReference)) addTree(checker, element, join(path, "[]"), tree, depth + 1);
      continue;
    }
    const index = checker.getIndexTypeOfType(part, ts.IndexKind.String);
    // `Document` (`[key: string]: any`) is an untyped view of a collection, not a shape: ignore it.
    if (index !== undefined && !(index.flags & ts.TypeFlags.Any)) { children.add("*"); addTree(checker, index, join(path, "*"), tree, depth + 1); }
    for (const property of checker.getPropertiesOfType(part)) {
      if (property.flags & ts.SymbolFlags.Method) continue;
      children.add(property.getName());
      addTree(checker, checker.getTypeOfSymbol(property), join(path, property.getName()), tree, depth + 1);
    }
  }
}

let cachedProgram: ts.Program | undefined;
/** One TypeScript program over src/ and workers/ (shared by the inventory tests; building it takes seconds). */
export function typeProgram(): ts.Program {
  if (cachedProgram) return cachedProgram;
  const config = ts.getParsedCommandLineOfConfigFile("tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)); } });
  if (config === undefined) throw new Error("tsconfig.json could not be read");
  const roots = config.fileNames.filter((name) => /(^|\/)(src|workers)\//.test(posix(name)));
  cachedProgram = ts.createProgram(roots, { ...config.options, noEmit: true, incremental: false });
  return cachedProgram;
}

/**
 * Every collection name the type checker resolves to one string literal in `.collection(name)` / `.createCollection(name)` calls in
 * src/ and workers/ (`names`, typed or not), and document shapes per collection from every `.collection<T>(name)` call
 * whose name resolves to one string literal (union over all declarations of a collection, recursing through nested objects, arrays
 * and records), plus ManualRecordDocument for the manual sections. Calls whose name does NOT resolve to a literal are returned in
 * `unresolved` (`file:line text`) so the caller can require each to be explained.
 */
export function typedCollectionFields(): { fields: Map<string, Set<string>>; trees: Map<string, DocumentTree>; manualTree: DocumentTree; unresolved: string[]; names: Set<string> } {
  const program = typeProgram();
  const checker = program.getTypeChecker();
  const trees = new Map<string, DocumentTree>(); const unresolved: string[] = []; const names = new Set<string>();
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !/\/(src|workers)\//.test(posix(source.fileName))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["collection", "createCollection"].includes(node.expression.name.text)
        && node.arguments[0] !== undefined) {
        const argument = checker.getTypeAtLocation(node.arguments[0]);
        if (argument.isStringLiteral()) names.add(argument.value);
        if (!argument.isStringLiteral()) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          unresolved.push(`${posix(source.fileName).replace(/^.*?\/(src|workers)\//, "$1/")}:${line} ${node.arguments[0].getText()}`);
        } else if (node.typeArguments?.length === 1) {
          const tree = trees.get(argument.value) ?? new Map<string, Set<string>>();
          addTree(checker, checker.getTypeFromTypeNode(node.typeArguments[0]!), "", tree, 0);
          trees.set(argument.value, tree);
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
  const manualTree: DocumentTree = new Map();
  addTree(checker, checker.getTypeAtLocation(alias.name), "", manualTree, 0);
  const fields = new Map([...trees].map(([name, tree]) => [name, new Set(tree.get("") ?? [])]));
  return { fields, trees, manualTree, unresolved: unresolved.sort(), names };
}

const DELETE_METHODS = new Set(["deleteOne", "deleteMany", "findOneAndDelete", "drop", "dropDatabase", "dropCollection", "dropIndex", "dropIndexes",
  "bulkWrite", "remove", "replaceOne", "findOneAndReplace"]);
const COMMAND_KEYS = new Set(["drop", "dropDatabase", "collMod", "delete", "dropIndexes", "compact"]);
const REMOVAL_KEYS = new Set(["expireAfterSeconds", "$unset", "$pull", "$pop", "$rename", "$replaceWith", "$replaceRoot"]);
const UPDATE_METHODS = new Set(["updateOne", "updateMany", "findOneAndUpdate"]);
const DATABASE_METHODS = new Set([...UPDATE_METHODS, "createIndex", "createIndexes", "command", "insertOne", "insertMany", "replaceOne", "findOneAndReplace", "bulkWrite", "aggregate"]);
/** An object literal that is (part of) an argument to a MongoDB call; computed keys elsewhere (e.g. UI state) are not storage. */
function insideDatabaseCall(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent)) return ts.isPropertyAccessExpression(parent.expression) && DATABASE_METHODS.has(parent.expression.name.text);
    if (ts.isFunctionLike(parent)) return false;
  }
  return false;
}

/**
 * Data-removal and expiry mechanisms in repository code, as `<file> <kind>` -> count: hard-delete/replace calls (`deleteOne`, ...,
 * `replaceOne`), field removal/rewrite keys (`$unset`, `$pull`, `$pop`, `$rename`, `$replaceWith`, `$replaceRoot`), aggregation-pipeline
 * updates (`pipeline-update`), database commands that drop or change collections (`command:<key>`, `command:dynamic` when the
 * command is not an object literal) and TTL index options (`expireAfterSeconds`). Computed keys are resolved through same-file
 * string constants; anything unresolvable is `computed-key`.
 */
export function retentionSites(): Map<string, number> {
  const sites = new Map<string, number>();
  for (const root of ["src", "workers", "scripts"]) {
    for (const path of files(root, (p) => /\.(ts|tsx|js|mjs|cjs|mts)$/.test(p))) {
      const file = posix(path);
      const add = (kind: string) => sites.set(`${file} ${kind}`, (sites.get(`${file} ${kind}`) ?? 0) + 1);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const constants = new Map<string, string>();
      const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteralLike(node.initializer)) constants.set(node.name.text, node.initializer.text);
        ts.forEachChild(node, collect);
      };
      collect(source);
      const keyOf = (name: ts.PropertyName): string | undefined => {
        if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
        if (!ts.isComputedPropertyName(name)) return undefined;
        if (ts.isStringLiteralLike(name.expression)) return name.expression.text;
        return ts.isIdentifier(name.expression) && constants.has(name.expression.text) ? constants.get(name.expression.text) : "computed-key";
      };
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (DELETE_METHODS.has(method)) add(method);
          if (UPDATE_METHODS.has(method) && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1])) add("pipeline-update");
          if (method === "command" && node.arguments[0]) {
            if (!ts.isObjectLiteralExpression(node.arguments[0])) add("command:dynamic");
            else for (const property of node.arguments[0].properties) {
              const key = property.name ? keyOf(property.name) : undefined;
              if (key && COMMAND_KEYS.has(key)) add(`command:${key}`);
            }
          }
        }
        if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent)) {
          const key = keyOf(node.name);
          if (key !== undefined && REMOVAL_KEYS.has(key)) add(key);
          if (key === "computed-key" && insideDatabaseCall(node)) add(key);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return sites;
}

const WRITE_METHODS = new Set(["insertOne", "insertMany", "updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"]);
const FIELD_OPERATORS = new Set(["$set", "$setOnInsert", "$inc", "$push", "$addToSet", "$max", "$min", "$mul", "$currentDate", "$unset", "$pull", "$pop"]);

/** Does a MongoDB dotted path (`email.acceptedAt`, `messages.$.text`, `items.0.x`) exist in the document tree? Arrays are implicit. */
function pathExists(tree: DocumentTree, dotted: string): boolean {
  let node = "";
  for (const raw of dotted.split(".")) {
    const segment = /^(\$(\[\w*\])?|\d+)$/.test(raw) ? "[]" : raw;
    let children = tree.get(node) ?? new Set<string>();
    if (segment !== "[]" && children.has("[]") && !children.has(segment)) { node = join(node, "[]"); children = tree.get(node) ?? new Set(); }
    if (children.has(segment)) node = join(node, segment);
    else if (segment !== "[]" && children.has("*")) node = join(node, "*");
    else return false;
  }
  return true;
}

/**
 * Literal field paths written through insert/update/replace calls on a typed `Collection<T>` in src/ and workers/ that do NOT exist
 * in T (`file:line path`). MongoDB's typings accept extra `$set` keys (`Partial<T> & Record<string, any>`), so a field written but
 * never declared would otherwise escape the type-derived classification. Untyped (`Document`) collections are not checkable here.
 */
export function undeclaredWrites(): string[] {
  const program = typeProgram(); const checker = program.getTypeChecker(); const found: string[] = [];
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !/\/(src|workers)\//.test(posix(source.fileName))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_METHODS.has(node.expression.name.text)) {
        const receiver = checker.getTypeAtLocation(node.expression.expression);
        const document = receiver.getSymbol()?.getName() === "Collection" ? checker.getTypeArguments(receiver as ts.TypeReference)[0] : undefined;
        if (document && !checker.getIndexTypeOfType(document, ts.IndexKind.String)) {
          const tree: DocumentTree = new Map(); addTree(checker, document, "", tree, 0);
          const method = node.expression.name.text;
          const where = `${posix(source.fileName).replace(/^.*?\/(src|workers)\//, "$1/")}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
          const keys = (literal: ts.Expression | undefined, prefix = ""): string[] => (literal && ts.isObjectLiteralExpression(literal)
            ? literal.properties.flatMap((property) => {
              const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : undefined;
              return name === undefined ? [] : [prefix + name];
            }) : []);
          const paths: string[] = [];
          if (method === "insertOne") paths.push(...keys(node.arguments[0]));
          if (method === "insertMany" && node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) for (const element of node.arguments[0].elements) paths.push(...keys(element));
          if (method === "replaceOne" || method === "findOneAndReplace") paths.push(...keys(node.arguments[1]));
          if (["updateOne", "updateMany", "findOneAndUpdate"].includes(method) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
            for (const property of node.arguments[1].properties) {
              const operator = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : "";
              if (FIELD_OPERATORS.has(operator) && ts.isPropertyAssignment(property)) paths.push(...keys(property.initializer));
            }
          }
          for (const path of paths) if (!path.startsWith("$") && !pathExists(tree, path)) found.push(`${where} ${path}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found.sort();
}
