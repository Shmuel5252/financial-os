import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { typeProgram } from "./collection-discovery";
import { files } from "./live-test-ids";

// Phase 18 row 18-13: every place the authentication secret (AUTH_SECRET, Auth.js' numbered rotation variants AUTH_SECRET_1..n and
// the legacy NEXTAUTH_SECRET) is read in src/ and workers/, and every value derived from it TRANSITIVELY. A function is a "deriver"
// when it reads the secret, or when one of its return values contains a call to a deriver (resolved through imports and aliases by
// the type checker), so wrappers such as subjectAlias() and minimizeAccountIdentity() are found without being named here. Every call
// of a deriver is reported with its first argument (the alias kind). Every createHmac call is reported with its key expression, so a
// new keyed derivation cannot appear unclassified. scripts/ (plain .mjs, not in the program) is checked textually for the names.
const SECRET = /^(AUTH_SECRET(_\d+)?|NEXTAUTH_SECRET)$/;
const posix = (path: string) => path.split(sep).join("/");
const rel = (file: string) => posix(relative(process.cwd(), file));

export type SecretDerivationSites = Readonly<{
  /** `<file>#<function> <how>` -> count; how = read (property/element access), destructure, literal (string literal elsewhere), key (object key) */
  mentions: Map<string, number>;
  /** functions whose result is derived from the secret: `<file>#<function>` */
  derivers: Set<string>;
  /** `<file>#<caller> -> <file>#<deriver>(<first argument text>)` -> count */
  calls: Map<string, number>;
  /** `<file>#<function> createHmac(<key expression text>)` -> count, for every keyed HMAC in src/ and workers/ */
  hmacKeys: Map<string, number>;
  /** scripts/ files mentioning a secret name -> count */
  scripts: Map<string, number>;
}>;

/** A stable, human-readable name for the function (or module) that encloses a node. */
function owner(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      const cls = current.parent && (ts.isClassDeclaration(current.parent) || ts.isClassExpression(current.parent)) && current.parent.name ? `${current.parent.name.text}.` : "";
      return `${cls}${current.name.text}`;
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && current.parent) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) return `${owner(parent)}.${parent.name.text}`;
    }
  }
  return "<module>";
}
const site = (node: ts.Node) => `${rel(node.getSourceFile().fileName)}#${owner(node)}`;
/** Named functions own their returns; anonymous callbacks passed as arguments belong to the function that encloses them. */
function namedFunction(node: ts.Node): boolean {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return true;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent) {
    return (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) || ts.isPropertyAssignment(node.parent);
  }
  return false;
}

/** The declaration a callee resolves to, as `<file>#<name>` (through import aliases), or undefined when unresolvable. */
function calleeId(checker: ts.TypeChecker, call: ts.CallExpression): string | undefined {
  const target = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
  let symbol = checker.getSymbolAtLocation(target);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  if (!declaration) return undefined;
  const file = rel(declaration.getSourceFile().fileName);
  if (ts.isFunctionDeclaration(declaration) && declaration.name) return `${file}#${declaration.name.text}`;
  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) return `${file}#${declaration.name.text}`;
  if (ts.isMethodDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    const cls = ts.isClassDeclaration(declaration.parent) && declaration.parent.name ? `${declaration.parent.name.text}.` : "";
    return `${file}#${cls}${declaration.name.text}`;
  }
  return undefined;
}

export function secretDerivationSites(): SecretDerivationSites {
  const program = typeProgram();
  const checker = program.getTypeChecker();
  const sources = program.getSourceFiles().filter((source) => /(^|\/)(src|workers)\//.test(rel(source.fileName)) && !source.isDeclarationFile);
  const mentions = new Map<string, number>(); const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const readers = new Set<string>();
  // Named functions by id (anonymous callbacks belong to the function that encloses them).
  const functions = new Map<string, ts.FunctionLikeDeclaration>();

  for (const source of sources) {
    const visit = (node: ts.Node): void => {
      const name = ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
      if (name && SECRET.test(name)) {
        const parent = node.parent;
        const how = ts.isPropertyAccessExpression(parent) && parent.name === node ? "read"
          : ts.isElementAccessExpression(parent) && parent.argumentExpression === node ? "read"
          : ts.isBindingElement(parent) ? "destructure"
          : (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === node ? "key"
          : ts.isStringLiteralLike(node) ? "literal" : "identifier";
        bump(mentions, `${site(node)} ${how}`);
        if (how === "read" || how === "destructure") readers.add(site(node));
      }
      if (ts.isFunctionLike(node) && "body" in node && node.body && namedFunction(node)) functions.set(`${rel(node.getSourceFile().fileName)}#${owner(node.body)}`, node as ts.FunctionLikeDeclaration);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // Transitive closure. A function is a deriver when a deriver call's VALUE can reach what it returns: directly, through object/array/
  // conditional/template/await/spread/property expressions, through local variables (initialisers, assignments, `.push/.unshift/
  // .add/.set` into a local collection, property writes), or through callbacks of array methods (`xs.map(x => derived)`). A derived
  // value used only as an argument of another call (e.g. a lookup key) or compared (=== / !== / < ...) does not make the result
  // derived; such uses are still reported in `calls`. Over-approximation is deliberate: a false deriver is classified, never missed.
  const derivers = new Set(readers);
  const tainted = new Set<ts.Symbol>();
  const COMPARISON = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.InKeyword]);
  const symbolOf = (node: ts.Node) => {
    // `{ key }` shorthand: the value is the local variable, not the property being declared.
    const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  };
  const returnsOf = (fn: ts.FunctionLikeDeclaration): ts.Node[] => {
    if (fn.body && !ts.isBlock(fn.body)) return [fn.body];
    const out: ts.Node[] = [];
    const walk = (node: ts.Node): void => { if (ts.isFunctionLike(node) && node !== fn) return; if (ts.isReturnStatement(node) && node.expression) out.push(node.expression); ts.forEachChild(node, walk); };
    if (fn.body) walk(fn.body);
    return out;
  };
  const derived = (expression: ts.Node): boolean => {
    let found = false;
    const walk = (node: ts.Node): void => {
      if (found) return;
      if (ts.isFunctionLike(node)) { if (returnsOf(node as ts.FunctionLikeDeclaration).some(derived)) found = true; return; }
      if (ts.isBinaryExpression(node) && COMPARISON.has(node.operatorToken.kind)) return;
      if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken || ts.isTypeOfExpression(node)) return;
      if (ts.isIdentifier(node)) { const symbol = symbolOf(node); if (symbol && tainted.has(symbol)) found = true; return; }
      if (ts.isCallExpression(node)) {
        const id = calleeId(checker, node);
        if (id && derivers.has(id)) { found = true; return; }
        walk(node.expression); // a method on a derived value stays derived
        if (ts.isPropertyAccessExpression(node.expression)) for (const argument of node.arguments) if (ts.isFunctionLike(argument)) walk(argument); // xs.map(cb)
        return;
      }
      ts.forEachChild(node, walk);
    };
    walk(expression);
    return found;
  };
  /** Local value flows inside a function body (including nested anonymous callbacks): [target symbol, value]. */
  const flowsOf = (fn: ts.FunctionLikeDeclaration): [ts.Symbol, ts.Node][] => {
    const out: [ts.Symbol, ts.Node][] = [];
    const add = (target: ts.Node, value: ts.Node) => { const symbol = symbolOf(target); if (symbol) out.push([symbol, value]); };
    const walk = (node: ts.Node): void => {
      if (node !== fn && ts.isFunctionLike(node) && namedFunction(node)) return;
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) add(node.name, node.initializer);
        else for (const element of node.name.elements) if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) add(element.name, node.initializer);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        let target: ts.Node = node.left; while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = target.expression;
        if (ts.isIdentifier(target)) add(target, node.right);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["push", "unshift", "add", "set", "splice"].includes(node.expression.name.text)
        && ts.isIdentifier(node.expression.expression)) for (const argument of node.arguments) add(node.expression.expression, argument);
      ts.forEachChild(node, walk);
    };
    if (fn.body) walk(fn.body);
    return out;
  };
  const flows = new Map([...functions].map(([id, fn]) => [id, flowsOf(fn)] as const));
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, fn] of functions) {
      for (const [symbol, value] of flows.get(id)!) if (!tainted.has(symbol) && derived(value)) { tainted.add(symbol); changed = true; }
      if (!derivers.has(id) && returnsOf(fn).some(derived)) { derivers.add(id); changed = true; }
    }
  }

  const calls = new Map<string, number>(); const hmacKeys = new Map<string, number>();
  for (const source of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const id = calleeId(checker, node);
        if (id && derivers.has(id)) bump(calls, `${site(node)} -> ${id}(${node.arguments[0]?.getText().replace(/\s+/g, " ") ?? ""})`);
        const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : "";
        if (callee === "createHmac") bump(hmacKeys, `${site(node)} createHmac(${node.arguments[1]?.getText().replace(/\s+/g, " ") ?? ""})`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const scripts = new Map<string, number>();
  for (const path of files("scripts", (p) => /\.(mjs|cjs|js|ts|mts|ps1|sh)$/.test(p))) {
    const count = (readFileSync(path, "utf8").match(/\b(AUTH_SECRET(_\d+)?|NEXTAUTH_SECRET)\b/g) ?? []).length;
    if (count > 0) scripts.set(posix(path), count);
  }
  return { mentions, derivers, calls, hmacKeys, scripts };
}
