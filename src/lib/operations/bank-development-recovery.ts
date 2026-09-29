/** Offline development-baseline manifests: anti-reimport evidence, never a migration to rerun.
 * ADR-076: the development archive is excluded from backups, and retired manifests are minimized to what the
 * runtime reader needs; only interrupted (prepared/archived) manifests keep the protected-record digests they resume from.
 */
import "server-only";
import { createHash } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { DEVELOPMENT_BASELINE_POLICY } from "@/lib/open-banking/development-baseline";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId); const alias = z.string().regex(/^[a-f0-9]{64}$/);
const targets = ["accounts", "transactions", "bankConnections", "bankRecordRevisions"] as const;
const internal = ["bankDevelopmentMigrations", "bankDevelopmentArchive", "bankDevelopmentMigrationLocks"];
const digest = <T extends z.ZodTypeAny>(collection: T) => z.object({ collection, id, digest: alias }).strict();
const manifest = z.object({ _id: alias, userId: id, subjectAlias: alias, activeConnectionAlias: alias, oldConnectionAliases: z.array(alias).min(1),
  policyVersion: z.literal(DEVELOPMENT_BASELINE_POLICY), targets: z.array(digest(z.enum(targets))).min(1),
  protectedRecords: z.array(digest(z.string().min(1).max(255))).optional(), collectionNames: z.array(z.string().min(1).max(255)),
  state: z.enum(["prepared", "archived", "retired"]), createdAt: z.date(), retiredAt: z.date().optional() }).strict();
const fail = (): never => { throw new Error("Bank development recovery requires review"); };
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Stored or minimized form in; minimized form out for retired manifests, so re-projection is idempotent. */
export function projectRecoveryBankDevelopmentMigration(document: Document): Document {
  try {
    assertRecoveryContent(document); const parsed = manifest.safeParse(document); if (!parsed.success) return fail(); const row = parsed.data;
    const retired = row.state === "retired"; const protectedRecords = row.protectedRecords ?? [];
    const keys = (items: readonly { collection: string; id: ObjectId }[]) => items.map(item => `${item.collection}:${item.id.toHexString()}`);
    const targetKeys = new Set(keys(row.targets)); const sorted = [...row.collectionNames].sort();
    if (row._id !== sha256(`${DEVELOPMENT_BASELINE_POLICY}:${row.userId.toHexString()}:${row.activeConnectionAlias}`)
      || retired !== (row.retiredAt !== undefined) || (!retired && row.protectedRecords === undefined)
      || !unique(row.oldConnectionAliases) || row.oldConnectionAliases.includes(row.activeConnectionAlias)
      || !unique(keys(row.targets)) || !unique(keys(protectedRecords)) || keys(protectedRecords).some(key => targetKeys.has(key))
      || !row.targets.some(item => item.collection === "accounts") || !unique(row.collectionNames) || JSON.stringify(sorted) !== JSON.stringify(row.collectionNames)
      || row.collectionNames.some(name => internal.includes(name))
      || [...row.targets, ...protectedRecords].some(item => !row.collectionNames.includes(item.collection))) return fail();
    if (!retired) return document;
    // protectedRecords hold IDs/digests of every other document at planning time, including other owners'; the runtime
    // reader (retiredDevelopmentConnectionAliases) needs none of them once retirement is complete.
    const minimized: Document = { ...document }; delete minimized.protectedRecords;
    return minimized;
  } catch { return fail(); }
}

/** Quarantine-only inspection. Restored retired manifests are what keep retired development data from being reimported;
 * this reports retired records that reappear and remaining mixed-subject digests instead of resolving them.
 */
export function inspectBankDevelopmentRecovery(input: Readonly<{ migrations: readonly Document[]; connections: readonly Document[];
  revisions: readonly Document[]; accounts: readonly Document[]; transactions: readonly Document[] }>) {
  try {
    const manifests = new Map<string, Document>();
    for (const value of input.migrations) {
      // _id is derived from owner + active alias + policy, so it also enforces the (owner, active alias, policy) unique index.
      const row = projectRecoveryBankDevelopmentMigration(value); if (manifests.has(row._id)) return fail(); manifests.set(row._id, row);
    }
    const unresolved = { retiredReappeared: 0, mixedSubjectDigests: 0, interruptedRetirements: 0 };
    for (const row of manifests.values()) {
      unresolved.mixedSubjectDigests += row.protectedRecords?.length ?? 0;
      // The archive is excluded from backups, so an interrupted retirement can never be resumed from a restore.
      if (row.state !== "retired") unresolved.interruptedRetirements++;
    }
    // Matches the runtime reader: only retired manifests suppress reimport; interrupted (archived) retirements do not.
    const retired = [...manifests.values()].filter(row => row.state === "retired");
    // Presence checks only: rows are schema-reviewed by their own adapters elsewhere in the package.
    const rows: Record<typeof targets[number], readonly Document[]> = { accounts: input.accounts, transactions: input.transactions,
      bankConnections: input.connections, bankRecordRevisions: input.revisions };
    for (const collection of targets) for (const row of rows[collection]) {
      if (!(row._id instanceof ObjectId) || !(row.userId instanceof ObjectId)) return fail();
      const connection = collection === "accounts" || collection === "transactions" ? row.source?.connectionAlias : row.connectionAlias;
      if (retired.some(item => item.userId.equals(row.userId) && (item.oldConnectionAliases.includes(connection)
        || item.targets.some((target: Document) => target.collection === collection && target.id.equals(row._id))))) unresolved.retiredReappeared++;
    }
    return { policy: "bank-development-recovery-v2" as const, releaseAllowed: false as const, unresolved };
  } catch { return fail(); }
}
