import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverCollections } from "../security/collection-discovery";

describe("Phase 18 source collection inventory (no database access)", () => {
  it("documents every literal factory, manual-section, auth and offline migration collection exactly once", () => {
    const names = discoverCollections();
    const inventory = readFileSync("PHASE_18_DATA_INVENTORY.md", "utf8");
    const rows = [...inventory.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((match) => match[1]);
    expect(names.size).toBeGreaterThan(50);
    expect(rows).toHaveLength(new Set(rows).size);
    expect(rows.sort()).toEqual([...names].sort());
  });

  it("keeps both authoritative master-plan copies identical", () => {
    expect(readFileSync("MASTER_PLAN.md", "utf8")).toBe(readFileSync("FINANCIAL_OS_MASTER_PROMPT.md", "utf8"));
  });
});
