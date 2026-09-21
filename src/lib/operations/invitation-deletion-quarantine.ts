/** Partial invitation privacy filtering, before inert materialization; never enables application release. */
import "server-only";
import { BSON, type Document } from "mongodb";
import { projectRecoveryInvitation } from "@/lib/operations/invitation-recovery";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";
import { inspectHouseholdRecoveryReferences } from "@/lib/operations/household-recovery-references";
type Graph = Parameters<typeof inspectHouseholdRecoveryReferences>[0];
const fail = (): never => { throw new Error("Invitation deletion quarantine failed"); };

/** Requires original schema-reviewed graph before household suppression, not already-pruned references. */
export function filterInvitationDeletionQuarantine(rows: readonly Document[], graph: Graph, ledger: RestorationLedgerContext) {
  const { isSuppressed } = restorationSuppression(ledger); inspectHouseholdRecoveryReferences(graph);
  const users = new Set(graph.authUsers.map(row => row._id.toHexString()));
  const households = new Map(graph.households.map(row => [row._id.toHexString(), row.ownerUserId.toHexString()]));
  const resources = new Map<string, string>();
  for (const [kind, records] of [["account", graph.accounts], ["goal", graph.goals]] as const)
    for (const row of records) resources.set(`${kind}:${row._id.toHexString()}`, row.userId.toHexString());
  const seen = new Set<string>(); const preserved: Document[] = []; let excluded = 0; let redactedAuditEvents = 0;
  for (const input of rows) {
    const row = projectRecoveryInvitation(input); const id = row._id.toHexString();
    if (seen.has(id)) return fail(); seen.add(id);
    const owner = households.get(row.householdId.toHexString()); const inviter = row.invitedByUserId.toHexString();
    const accepted = row.acceptedByUserId?.toHexString() ?? null;
    if (!owner || inviter !== owner || !users.has(inviter) || (accepted !== null && !users.has(accepted))
      || ((row.status === "accepted") !== (accepted !== null))) return fail();
    const audit = (row.auditTrail as Document[]).filter(event => {
      const subjects = [event.actorUserId, event.targetUserId].filter(value => value !== null).map(value => value.toHexString());
      if (subjects.some(subject => !users.has(subject))) return fail();
      if (event.resourceId !== null) {
        const subject = resources.get(`${event.resourceKind}:${event.resourceId.toHexString()}`); if (!subject) return fail(); subjects.push(subject);
      } else if (event.resourceKind !== null) return fail();
      return !subjects.some(isSuppressed);
    });
    if (isSuppressed(owner) || (accepted !== null && isSuppressed(accepted))) { excluded++; continue; }
    const copy = BSON.deserialize(BSON.serialize(row), { promoteLongs: false });
    if (audit.length !== row.auditTrail.length) {
      if (!Number.isSafeInteger(row.version) || row.version >= Number.MAX_SAFE_INTEGER || ledger.now < row.updatedAt.getTime()) return fail();
      redactedAuditEvents += row.auditTrail.length - audit.length;
      copy.auditTrail = BSON.deserialize(BSON.serialize({ audit }), { promoteLongs: false }).audit;
      copy.version = row.version + 1; copy.updatedAt = new Date(ledger.now);
    }
    preserved.push(copy);
  }
  return { releaseAllowed: false as const, preserved, evidence: { policy: "invitation-deletion-quarantine-v1" as const,
    ledgerRevision: ledger.authoritativeRevision, evaluatedAt: ledger.now, excluded, redactedAuditEvents } };
}
