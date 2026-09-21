/** Withhold affected derived report chains in quarantine, never rewrite historical financial amounts. */
import "server-only";
import { BSON, type Document } from "mongodb";
import { fromStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";
import { projectRecoveryReport } from "@/lib/operations/report-recovery-schema";
import { resolveHouseholdReportSubjects } from "@/lib/operations/household-report-recovery";
import { inspectHouseholdRecoveryReferences } from "@/lib/operations/household-recovery-references";

type Graph = Parameters<typeof inspectHouseholdRecoveryReferences>[0];
const fail = (): never => { throw new Error("Shared report deletion quarantine failed"); };

/** Complete household report chains (including hidden versions) required. Personal reports use another path.
 * Withheld chains must be privacy-reviewed/rebuilt from surviving truth before eventual application release.
 */
export function filterSharedReportDeletionQuarantine(rows: readonly Document[], graph: Graph, ledger: RestorationLedgerContext): Readonly<{
  releaseAllowed: false; preserved: Document[];
  evidence: { policy: "shared-report-quarantine-v1"; ledgerRevision: number; evaluatedAt: number;
    withheldChains: number; withheldReports: number; preservedReports: number };
}> {
  const { isSuppressed } = restorationSuppression(ledger);
  inspectHouseholdRecoveryReferences(graph);
  const byId = new Map<string, Document>(); const versions = new Set<string>();
  for (const row of rows) {
    projectRecoveryReport(row);
    if (row.scope.kind !== "household") return fail();
    const id = row._id.toHexString(); const version = `${row.rootReportId.toHexString()}:${row.reportVersion}`;
    if (byId.has(id) || versions.has(version)) return fail(); byId.set(id, row); versions.add(version);
  }
  const withheld = new Set<string>();
  for (const row of rows) {
    const rootId = row.rootReportId.toHexString(); const root = byId.get(rootId);
    if (!root || !root.userId.equals(row.userId) || root.scope.householdId !== row.scope.householdId
      || root.reportVersion !== 1 || root.supersedesId !== null || !root.rootReportId.equals(root._id) || root.status !== "closed") return fail();
    if (row.reportVersion === 1) { if (!row._id.equals(root._id)) return fail(); }
    else {
      const parent = row.supersedesId === null ? undefined : byId.get(row.supersedesId.toHexString());
      if (!parent || !parent.rootReportId.equals(row.rootReportId) || parent.reportVersion + 1 !== row.reportVersion
        || !parent.userId.equals(row.userId) || row.status !== "restated") return fail();
    }
    const subjects = resolveHouseholdReportSubjects(fromStoredDomainValue(row.report), row.userId.toHexString(), graph);
    if (subjects.contributingSubjectIds.some(isSuppressed)) withheld.add(rootId);
  }
  const preserved = rows.filter(row => !withheld.has(row.rootReportId.toHexString()))
    .map(row => BSON.deserialize(BSON.serialize(row), { promoteLongs: false }));
  return { releaseAllowed: false, preserved, evidence: { policy: "shared-report-quarantine-v1",
    ledgerRevision: ledger.authoritativeRevision, evaluatedAt: ledger.now, withheldChains: withheld.size,
    withheldReports: rows.length - preserved.length, preservedReports: preserved.length } };
}
