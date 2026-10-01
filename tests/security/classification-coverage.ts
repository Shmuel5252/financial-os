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

/**
 * Subtrees classified by ONE row (the row's node has children in the type, but no row goes deeper): node -> every descendant path.
 * Their shapes are pinned, so a new nested field under such a row (e.g. an account number inside an evidence object) still fails.
 */
export function opaqueSubtrees(tree: DocumentTree, classifiedPaths: readonly string[]): Map<string, string[]> {
  const patterns = classifiedPaths.flatMap(patternTokens);
  const result = new Map<string, string[]>();
  for (const [node, children] of tree) {
    if (node === "" || children.size === 0) continue;
    const tokens = pathTokens(node);
    const exact = patterns.some((pattern) => pattern.length === tokens.length && matches(pattern, tokens));
    const deeper = patterns.some((pattern) => pattern.length > tokens.length && matches(pattern, tokens));
    if (!exact || deeper) continue;
    result.set(node, [...tree.keys()].filter((path) => path.startsWith(node) && path !== node && /^[.[]/.test(path.slice(node.length))).sort());
  }
  return result;
}
