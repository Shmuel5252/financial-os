/** Direct evidence links in quarantine; no achievement, preference or notification replay. */
import "server-only";
import type { Document } from "mongodb";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const fail = (): never => { throw new Error("Progress recovery links require review"); };
export function inspectProgressRecoveryLinks(input: Readonly<{ events: readonly Document[]; budgets: readonly Document[];
  snapshots: readonly Document[]; reports: readonly Document[]; goals: readonly Document[] }>) {
  try {
    const index = (collection: string, values: readonly Document[]) => {
      const rows = new Map<string, Document>(); const unique = new Set<string>();
      for (const value of values) {
        const row = initialRecoverySchemas[collection]!.project(value); const id = row._id.toHexString();
        if (rows.has(id)) return fail(); rows.set(id, row);
        const key = collection === "progressJourneyEvents" ? row.evidenceFingerprint
          : collection === "budgetPeriods" ? row.calendarMonth : row.idempotencyKeyHash;
        if (key !== undefined) {
          const scoped = `${row.userId.toHexString()}:${key}`;
          if (unique.has(scoped)) return fail(); unique.add(scoped);
        }
      }
      return rows;
    };
    const events = index("progressJourneyEvents", input.events); const budgets = index("budgetPeriods", input.budgets);
    const snapshots = index("financialSnapshots", input.snapshots); const reports = index("financialReports", input.reports);
    const goals = index("goalProgress", input.goals);
    let matchedSources = 0; let matchedParents = 0;
    const unresolved = { missingSources: 0, changedSources: 0, ineligibleSources: 0, missingParents: 0,
      forkedParents: 0, multipleRoots: 0, freshness: 0, historicalEvents: events.size };
    const children = new Map<string, number>(); const roots = new Map<string, number>();
    for (const event of events.values()) {
      for (const reference of event.sourceReferences) {
        const sources = reference.kind === "budget_period" ? budgets : reference.kind === "engine_snapshot" ? snapshots
          : reference.kind === "financial_report" ? reports : goals;
        const source = sources.get(reference.sourceId.toLowerCase());
        if (!source) { unresolved.missingSources++; continue; }
        if (!source.userId.equals(event.userId)) return fail();
        let versions: string[];
        if (reference.kind === "budget_period") {
          versions = [String(source.version)];
          if (source.status !== "closed" || source.closingSnapshot === null) unresolved.ineligibleSources++;
        } else if (reference.kind === "engine_snapshot") {
          if (source.kind !== "engine_result") return fail();
          const prefix = `${source.engineVersion}/${source.policyVersion}/${source.inputHash}`;
          versions = [`${prefix}/fresh`, `${prefix}/stale`];
          // Historical assessment context is absent; neither flag proves current or historical freshness here.
          unresolved.freshness++;
        } else if (reference.kind === "financial_report") {
          versions = [`${source.reportVersion}/${source.report.engineVersion}/${source.report.policyVersion}/${source.report.sourceFingerprint}`];
          if (source.hiddenAt !== null || source.report.scope.kind !== "personal" || source.report.period.kind !== "month") unresolved.ineligibleSources++;
        } else {
          versions = [`${source.goalVersion}/${source.engineVersion}/${source.policyVersion}`];
          if (source.result.verification !== "verified") unresolved.ineligibleSources++;
        }
        if (versions.includes(reference.version)) matchedSources++; else unresolved.changedSources++;
      }
      if (event.supersedesId === null) {
        const key = `${event.userId.toHexString()}:${event.stableKey}`; roots.set(key, (roots.get(key) ?? 0) + 1);
      } else {
        const parentId = event.supersedesId.toHexString(); children.set(parentId, (children.get(parentId) ?? 0) + 1);
        const parent = events.get(parentId);
        if (!parent) unresolved.missingParents++;
        else {
          if (!parent.userId.equals(event.userId) || parent.stableKey !== event.stableKey) return fail();
          matchedParents++;
        }
      }
    }
    // Iterative cycle detection avoids recursion depth and does not impose chronological ordering on concurrent writes.
    const checked = new Set<string>();
    for (const id of events.keys()) {
      const path = new Set<string>(); let cursor: string | undefined = id;
      while (cursor !== undefined && events.has(cursor) && !checked.has(cursor)) {
        if (path.has(cursor)) return fail(); path.add(cursor);
        cursor = events.get(cursor)!.supersedesId?.toHexString();
      }
      for (const visited of path) checked.add(visited);
    }
    unresolved.forkedParents = [...children.values()].filter(count => count > 1).length;
    unresolved.multipleRoots = [...roots.values()].filter(count => count > 1).length;
    return { policy: "progress-recovery-links-v1" as const, releaseAllowed: false as const, matchedSources, matchedParents, unresolved };
  } catch { return fail(); }
}
