import { createHash } from "node:crypto";
import { opaqueSubtrees } from "./classification-coverage";
import type { DocumentTree } from "./collection-discovery";
import { dataClassification } from "./data-classification";

/** `<collection> <node>` -> first 16 hex of sha256 over the node's descendant paths, for every subtree covered by one row. */
export function subtreeShapeDigests(trees: ReadonlyMap<string, DocumentTree>, manualTree: DocumentTree): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(dataClassification)) {
    if (entry.fieldSource === "auth-adapter") continue;
    const tree = entry.fieldSource === "manual-section" ? new Map([...manualTree, ...(trees.get(name) ?? [])]) : trees.get(name)!;
    for (const [node, descendants] of opaqueSubtrees(tree, Object.keys(entry.fields))) {
      result[`${name} ${node}`] = createHash("sha256").update(descendants.join("\n")).digest("hex").slice(0, 16);
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => (a < b ? -1 : 1)));
}
