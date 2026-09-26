/** Source metadata inspection only; no reconstructed goal arithmetic or release authority. */
import "server-only";
import type { Document } from "mongodb";
import { sectionCollections } from "@/lib/onboarding/manual-record-repository";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { projectRecoveryGoalProgress } from "@/lib/operations/goal-recovery";

const fail = (): never => { throw new Error("Goal source recovery requires review"); };
export function inspectGoalRecoverySources(progress: readonly Document[], records: Readonly<Record<string, readonly Document[]>>) {
  try {
    const manual = new Set(Object.values(sectionCollections));
    const allowed = new Set([...manual, "budgetPeriods", "financialSnapshots"]);
    const index = new Map<string, Document>();
    for (const [collection, rows] of Object.entries(records)) {
      if (!allowed.has(collection)) return fail();
      const adapter = initialRecoverySchemas[collection]; if (!adapter) return fail();
      for (const input of rows) {
        const row = adapter.project(input); const key = `${collection}:${row._id.toHexString()}`;
        if (index.has(key)) return fail(); index.set(key, row);
      }
    }
    const seen = new Set<string>(); let matched = 0;
    const unresolved = { missing: 0, changed: 0, inactive: 0, unversioned: 0, ambiguous: 0 };
    for (const input of progress) {
      const row = projectRecoveryGoalProgress(input); const id = row._id.toHexString();
      if (seen.has(id)) return fail(); seen.add(id);
      for (const reference of row.sourceReferences) {
        const referenceId = reference.id.toLowerCase();
        if (reference.kind === "engine_snapshot" && reference.version !== null) return fail();
        if (reference.kind === "goal_record" && referenceId !== row.goalId.toHexString()) return fail();
        const collections = reference.kind === "manual_record" ? [...manual] :
          [reference.kind === "goal_record" ? "goals" : reference.kind === "budget_period" ? "budgetPeriods" : "financialSnapshots"];
        const candidates = collections.map(collection => index.get(`${collection}:${referenceId}`)).filter((target): target is Document => target !== undefined);
        if (candidates.length === 0) { unresolved.missing++; continue; }
        if (candidates.some(target => !target.userId.equals(row.userId))) return fail();
        if (candidates.length !== 1) { unresolved.ambiguous++; continue; }
        const target = candidates[0]!;
        if (reference.kind === "engine_snapshot") {
          if (target.kind !== "engine_result") return fail();
        } else {
          if (target.deletedAt !== undefined && target.deletedAt !== null) { unresolved.inactive++; continue; }
          if (reference.version === null) { unresolved.unversioned++; continue; }
          if (!Number.isSafeInteger(target.version) || target.version < 1) return fail();
          if (reference.version !== target.version) { unresolved.changed++; continue; }
        }
        matched++;
      }
    }
    return { policy: "goal-recovery-sources-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
