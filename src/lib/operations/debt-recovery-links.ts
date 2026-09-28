/** Direct source metadata only; never reconstructs historical loan terms or releases data. */
import "server-only";
import type { Document } from "mongodb";
import { projectRecoveryDebtStrategy } from "@/lib/operations/debt-recovery";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const fail = (): never => { throw new Error("Debt recovery links require review"); };
export function inspectDebtRecoveryLinks(scenarios: readonly Document[], loans: readonly Document[]) {
  try {
    const index = (inputs: readonly Document[], project: (row: Document) => Document) => {
      const rows = new Map<string, Document>(); const retries = new Set<string>();
      for (const input of inputs) {
        const row = project(input); const id = row._id.toHexString();
        if (rows.has(id)) return fail(); rows.set(id, row);
        if (typeof row.idempotencyKeyHash === "string") {
          const key = `${row.userId.toHexString()}:${row.idempotencyKeyHash}`;
          if (retries.has(key)) return fail(); retries.add(key);
        }
      }
      return rows;
    };
    const saved = index(scenarios, projectRecoveryDebtStrategy);
    const sources = index(loans, initialRecoverySchemas.loans!.project);
    let matched = 0;
    const unresolved = { missing: 0, changed: 0, inactive: 0, historicalScenarios: saved.size };
    for (const row of saved.values()) {
      for (const reference of row.debtReferences) {
        const target = sources.get(reference.id.toHexString());
        if (!target) { unresolved.missing++; continue; }
        if (!target.userId.equals(row.userId)) return fail();
        if (target.deletedAt !== null) unresolved.inactive++;
        else if (target.version !== reference.version) unresolved.changed++;
        else matched++;
      }
    }
    return { policy: "debt-recovery-links-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
