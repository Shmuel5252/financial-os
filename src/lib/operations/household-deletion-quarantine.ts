/** Pure, partial quarantine transform. No live erasure, invitation/report release, or database writes. */
import "server-only";
import { BSON, type Document } from "mongodb";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";
import { inspectHouseholdRecoveryReferences } from "@/lib/operations/household-recovery-references";

type Graph = Parameters<typeof inspectHouseholdRecoveryReferences>[0];
const names = ["households", "householdMemberships", "householdResourceShares"] as const;
type Name = typeof names[number];
const fail = (): never => { throw new Error("Household deletion quarantine failed"); };

export function filterHouseholdDeletionQuarantine(graph: Graph, ledger: RestorationLedgerContext): Readonly<{
  releaseAllowed: false; collections: Record<Name, Document[]>;
  evidence: { policy: "household-deletion-quarantine-v1"; ledgerRevision: number; evaluatedAt: number;
    excluded: Record<Name, number>; redactedAuditEvents: number };
}> {
  const { isSuppressed } = restorationSuppression(ledger);
  inspectHouseholdRecoveryReferences(graph);
  const removedHouseholds = new Set(graph.households.filter(row => isSuppressed(row.ownerUserId.toHexString())).map(row => row._id.toHexString()));
  const resourceOwners = new Map<string, string>();
  for (const [kind, rows] of [["account", graph.accounts], ["goal", graph.goals]] as const)
    for (const row of rows) resourceOwners.set(`${kind}:${row._id.toHexString()}`, row.userId.toHexString());
  const collections: Record<Name, Document[]> = { households: [], householdMemberships: [], householdResourceShares: [] };
  const excluded: Record<Name, number> = { households: 0, householdMemberships: 0, householdResourceShares: 0 };
  let redactedAuditEvents = 0;
  for (const name of names) for (const row of graph[name]) {
    const owner = (name === "householdMemberships" ? row.userId : row.ownerUserId).toHexString();
    if (isSuppressed(owner) || (name !== "households" && removedHouseholds.has(row.householdId.toHexString()))) {
      excluded[name]++; continue;
    }
    const audit = (row.auditTrail as Document[]).filter(event => {
      const subjects = [event.actorUserId, event.targetUserId].filter(value => value !== null).map(value => value.toHexString());
      if (event.resourceId !== null) {
        const subject = resourceOwners.get(`${event.resourceKind}:${event.resourceId.toHexString()}`); if (!subject) return fail(); subjects.push(subject);
      }
      const keep = !subjects.some(isSuppressed); if (!keep) redactedAuditEvents++; return keep;
    });
    const copy = BSON.deserialize(BSON.serialize(row), { promoteLongs: false });
    if (audit.length !== row.auditTrail.length) {
      if (!Number.isSafeInteger(row.version) || row.version >= Number.MAX_SAFE_INTEGER || ledger.now < row.updatedAt.getTime()) return fail();
      copy.auditTrail = BSON.deserialize(BSON.serialize({ audit }), { promoteLongs: false }).audit;
      copy.version = row.version + 1; copy.updatedAt = new Date(ledger.now);
    }
    collections[name].push(copy);
  }
  return { releaseAllowed: false, collections, evidence: { policy: "household-deletion-quarantine-v1",
    ledgerRevision: ledger.authoritativeRevision, evaluatedAt: ledger.now, excluded, redactedAuditEvents } };
}
