/** Internal quarantine analysis only: no deletion, persistence, logging or release capability. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { householdRecoverySchemas } from "@/lib/operations/household-recovery-schemas";

const classes = ["households", "householdMemberships", "householdResourceShares"] as const;
type HouseholdClass = typeof classes[number];
export type HouseholdRecoveryReferences = Readonly<{
  releaseAllowed: false;
  records: readonly Readonly<{ collection: HouseholdClass; id: string; ownerId: string; contributingSubjectIds: readonly string[] }>[];
}>;
const fail = (): never => { throw new Error("Recovery references require review"); };
const oid = (value: unknown): string => value instanceof ObjectId ? value.toHexString() : fail();

/** Caller supplies complete, schema-reviewed canonical collections from the verified package.
 * All outputs remain private internal quarantine data. Not proof of invitation/derived-view coverage.
 */
export function inspectHouseholdRecoveryReferences(input: Readonly<{
  households: readonly Document[]; householdMemberships: readonly Document[]; householdResourceShares: readonly Document[];
  authUsers: readonly Document[]; accounts: readonly Document[]; goals: readonly Document[];
}>): HouseholdRecoveryReferences {
  const users = new Set<string>();
  for (const row of input.authUsers) { const id = oid(row._id); if (users.has(id)) return fail(); users.add(id); }
  const subject = (value: unknown) => { const id = oid(value); if (!users.has(id)) return fail(); return id; };
  const resources = new Map<string, string>();
  for (const [kind, rows] of [["account", input.accounts], ["goal", input.goals]] as const) {
    for (const row of rows) {
      const key = `${kind}:${oid(row._id)}`;
      if (resources.has(key)) return fail(); resources.set(key, subject(row.userId));
    }
  }
  const resourceOwner = (kind: unknown, id: unknown): string => {
    if (kind !== "account" && kind !== "goal") return fail();
    return resources.get(`${kind}:${oid(id)}`) ?? fail();
  };
  const households = new Map<string, string>();
  for (const row of input.households) {
    householdRecoverySchemas.households!.project(row);
    const id = oid(row._id); if (households.has(id)) return fail(); households.set(id, subject(row.ownerUserId));
  }
  const records: Array<HouseholdRecoveryReferences["records"][number]> = [];
  for (const collection of classes) {
    const seen = new Set<string>();
    for (const row of input[collection]) {
      householdRecoverySchemas[collection]!.project(row);
      const id = oid(row._id); if (seen.has(id)) return fail(); seen.add(id);
      const ownerId = subject(collection === "householdMemberships" ? row.userId : row.ownerUserId);
      const contributors = new Set<string>([ownerId]);
      if (collection !== "households") {
        const householdOwner = households.get(oid(row.householdId)); if (!householdOwner) return fail();
        contributors.add(householdOwner);
      }
      if (collection === "householdResourceShares" && resourceOwner(row.resourceKind, row.resourceId) !== ownerId) return fail();
      for (const event of row.auditTrail as Document[]) {
        if (event.actorUserId !== null) contributors.add(subject(event.actorUserId));
        if (event.targetUserId !== null) contributors.add(subject(event.targetUserId));
        if (event.resourceId !== null) contributors.add(resourceOwner(event.resourceKind, event.resourceId));
        else if (event.resourceKind !== null) return fail();
      }
      records.push({ collection, id, ownerId, contributingSubjectIds: [...contributors].sort() });
    }
  }
  return { releaseAllowed: false, records };
}
