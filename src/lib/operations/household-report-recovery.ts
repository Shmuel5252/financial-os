/** Resolve historical report aliases in quarantine. Never infer owners from amounts, dates or labels. */
import "server-only";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { validateFinancialReport } from "@/lib/reports/report";
import { inspectHouseholdRecoveryReferences } from "@/lib/operations/household-recovery-references";

type Graph = Parameters<typeof inspectHouseholdRecoveryReferences>[0];
const fail = (): never => { throw new Error("Household report recovery requires review"); };
const hash = (value: string, length: number) => createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);

export function resolveHouseholdReportSubjects(value: unknown, reportOwnerId: string, graph: Graph): Readonly<{
  releaseAllowed: false; contributingSubjectIds: readonly string[];
}> {
  try {
    inspectHouseholdRecoveryReferences(graph);
    const report = validateFinancialReport(value);
    if (JSON.stringify(stableSerializableDomainValue(value)) !== JSON.stringify(stableSerializableDomainValue(report))) return fail();
    if (report.scope.kind !== "household") return fail();
    const householdId = report.scope.householdId;
    const household = graph.households.find(row => row._id.toHexString() === householdId);
    if (!household || !graph.authUsers.some(row => row._id.toHexString() === reportOwnerId)) return fail();
    const owners = new Set<string>([reportOwnerId, household.ownerUserId.toHexString()]);
    const sourceOwners = new Map<string, string>();
    for (const row of graph.householdResourceShares) {
      if (row.householdId.toHexString() !== householdId) continue;
      const alias = `household.${row.resourceKind}.${hash((row._id as ObjectId).toHexString(), 16)}`;
      if (sourceOwners.has(alias)) return fail(); sourceOwners.set(alias, row.ownerUserId.toHexString());
    }
    const sources = new Map<string, string>();
    let accountSources = 0; let totals = 0;
    for (const ref of report.sourceReferences) {
      if (sources.has(ref.alias) || ref.alias !== `${ref.kind}.${hash(ref.sourceId, 12)}`) return fail();
      if (ref.kind === "account" || ref.kind === "goal") {
        if (!ref.sourceId.startsWith(`household.${ref.kind}.`)) return fail();
        const owner = sourceOwners.get(ref.sourceId); if (!owner) return fail(); owners.add(owner);
        if (ref.kind === "account") accountSources++;
      } else if (ref.kind === "net_worth" && /^household-total:[A-Z]{3}$/.test(ref.sourceId)) totals++;
      else return fail();
      sources.set(ref.alias, ref.kind);
    }
    if (totals && !accountSources) return fail();
    for (const [section, lines] of Object.entries(report.sections)) {
      const kind = section === "accounts" ? "account" : section === "goals" ? "goal" : section === "netWorth" ? "net_worth" : null;
      if (!kind && lines.length) return fail();
      for (const line of lines) {
        if (!line.sourceAliases.length || line.sourceAliases.some(alias => sources.get(alias) !== kind)) return fail();
      }
    }
    return { releaseAllowed: false, contributingSubjectIds: [...owners].sort() };
  } catch { return fail(); }
}
