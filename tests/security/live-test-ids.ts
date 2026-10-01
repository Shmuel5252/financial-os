import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function files(directory: string, match: (path: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path, match) : match(path) ? [path] : [];
  });
}

/** Ids that appear as `[id]` at the start of a real it()/test() title (not it.skip/it.todo, not comments). */
export function liveTestIds(): Set<string> {
  const ids = new Set<string>();
  for (const path of files("tests", (p) => /\.test\.(ts|tsx)$/.test(p))) {
    const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const match of text.matchAll(/(?<![.\w])(?:it|test)\(\s*(["'`])\[([a-z0-9-]+)\]/g)) ids.add(match[2]!);
  }
  return ids;
}
