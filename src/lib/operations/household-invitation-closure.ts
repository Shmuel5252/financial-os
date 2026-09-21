/** Quarantine-only relationship proof. Never grants sharing or releases restored data. */
import "server-only";
import { type Document } from "mongodb";
import { inspectHouseholdRecoveryReferences } from "@/lib/operations/household-recovery-references";
import { filterHouseholdDeletionQuarantine } from "@/lib/operations/household-deletion-quarantine";
import { filterInvitationDeletionQuarantine } from "@/lib/operations/invitation-deletion-quarantine";
import { projectRecoveryInvitation } from "@/lib/operations/invitation-recovery";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";

type Graph = Parameters<typeof inspectHouseholdRecoveryReferences>[0];
const fail = (): never => { throw new Error("Household invitation closure requires review"); };

/** Accepted invitations may predate the latest membership epoch or an interrupted activation.
 * Every membership, however, must resolve to its own accepted invitation. Never fabricate missing linkage.
 */
export function inspectHouseholdInvitationClosure(graph: Graph, invitations: readonly Document[]) {
  inspectHouseholdRecoveryReferences(graph);
  const owners = new Map(graph.households.map(row => [row._id.toHexString(), row.ownerUserId.toHexString()]));
  const users = new Set(graph.authUsers.map(row => row._id.toHexString()));
  const byId = new Map<string, Document>();
  for (const input of invitations) {
    const row = projectRecoveryInvitation(input); const id = row._id.toHexString();
    const owner = owners.get(row.householdId.toHexString());
    if (byId.has(id) || !owner || row.invitedByUserId.toHexString() !== owner
      || ((row.status === "accepted") !== (row.acceptedByUserId !== null))
      || (row.acceptedByUserId !== null && !users.has(row.acceptedByUserId.toHexString()))) return fail();
    byId.set(id, row);
  }
  const memberKeys = new Set<string>(); const activations = new Set<string>();
  for (const row of graph.householdMemberships) {
    const household = row.householdId.toHexString(); const user = row.userId.toHexString();
    const key = `${household}:${user}`; const activation = row.activatedByInvitationId.toHexString();
    const invitation = byId.get(activation);
    if (memberKeys.has(key) || activations.has(activation) || owners.get(household) === user
      || !invitation || invitation.status !== "accepted" || !invitation.acceptedByUserId.equals(row.userId)
      || !invitation.householdId.equals(row.householdId)) return fail();
    memberKeys.add(key); activations.add(activation);
  }
  return { releaseAllowed: false as const, policy: "household-invitation-closure-v1" as const,
    membershipsChecked: graph.householdMemberships.length, invitationsChecked: invitations.length };
}

/** Original graph is checked before pruning; survivors are checked again afterwards.
 * Free text is not declared private merely because a referenced identifier was removed.
 * Affected shared metadata remains in quarantine for a separate privacy review, never live erasure.
 */
export function prepareHouseholdInvitationQuarantine(graph: Graph, invitations: readonly Document[], ledger: RestorationLedgerContext) {
  const { isSuppressed } = restorationSuppression(ledger);
  inspectHouseholdInvitationClosure(graph, invitations);
  const references = inspectHouseholdRecoveryReferences(graph);
  const household = filterHouseholdDeletionQuarantine(graph, ledger);
  const invitation = filterInvitationDeletionQuarantine(invitations, graph, ledger);
  const closure = inspectHouseholdInvitationClosure({ ...graph, ...household.collections }, invitation.preserved);
  const affectedText = references.records.some(row => row.contributingSubjectIds.some(isSuppressed))
    || invitations.some(row => row.acceptedByUserId !== null && isSuppressed(row.acceptedByUserId.toHexString()));
  return { releaseAllowed: false as const, collections: { ...household.collections, householdInvitations: invitation.preserved },
    evidence: { policy: "household-invitation-quarantine-v1" as const, ledgerRevision: ledger.authoritativeRevision,
      evaluatedAt: ledger.now, closure, freeTextReviewRequired: affectedText,
      household: household.evidence, invitations: invitation.evidence } };
}
