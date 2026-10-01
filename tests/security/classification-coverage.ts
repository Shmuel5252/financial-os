import type { DocumentTree } from "./collection-discovery";

// Nested coverage rule (18-07/18-20): a classified row covers its whole subtree, UNLESS the classification goes deeper under that
// node - then every child of that node in the document type must be classified (recursively). So `email` alone covers all of
// `email.*`, but once `email.acceptedAt` is listed, a new `email.recipientEmail` in the type fails until it is classified.

/** `a[].b.{c,d}` -> token lists, braces expanded: [["a","[]","b","c"], ["a","[]","b","d"]]. */
export function patternTokens(path: string): string[][] {
  const brace = /\{([^}]*)\}/.exec(path);
  if (brace) return brace[1]!.split(",").flatMap((option) => patternTokens(path.replace(brace[0], option.trim())));
  return [path.replace(/\[\]/g, ".[]").split(".").filter((token) => token !== "")];
}
const pathTokens = (path: string) => (path === "" ? [] : patternTokens(path)[0]!);
const matches = (pattern: readonly string[], path: readonly string[]) =>
  pattern.length >= path.length && path.every((token, index) => pattern[index] === token || (pattern[index] === "*" && token !== "[]") || (token === "*" && pattern[index] !== "[]"));

/** Type paths whose parent is classified more deeply but which themselves are not classified. */
export function uncoveredPaths(tree: DocumentTree, classifiedPaths: readonly string[]): string[] {
  const patterns = classifiedPaths.flatMap(patternTokens);
  const missing: string[] = [];
  for (const [node, children] of tree) {
    const tokens = pathTokens(node);
    const expanded = node === "" || patterns.some((pattern) => pattern.length > tokens.length && matches(pattern, tokens));
    if (!expanded) continue;
    for (const child of children) {
      const childTokens = [...tokens, child];
      if (!patterns.some((pattern) => matches(pattern, childTokens))) missing.push(node === "" ? child : child === "[]" ? `${node}[]` : `${node}.${child}`);
    }
  }
  return missing.sort();
}
