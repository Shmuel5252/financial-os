/** Stored net-worth evidence only; no historical recomputation or release authority. */
import "server-only";
import { createHash } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { netWorthItemFieldsDomainSchema, netWorthStatementDomainSchema, assertNetWorthStatementVersions } from "@/lib/net-worth/net-worth";
import { netWorthStateFingerprint } from "@/lib/net-worth/net-worth-repository";
import { fromStoredDomainValue, toStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const item = z.object({ _id: id, userId: id, createdAt: z.date(), updatedAt: z.date(), deletedAt: z.date().nullable(),
  schemaVersion: z.literal(1), version: revision, fields: z.record(z.string(), z.unknown()),
  idempotencyKeyHash: hash, payloadHash: hash,
  auditTrail: z.array(z.object({ action: z.enum(["created", "updated", "deleted"]), actorUserId: id, at: z.date(),
    changedFields: z.array(z.string()), revision, source: z.literal("net_worth_item") }).strict()).min(1),
}).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
const snapshot = z.object({ _id: id, userId: id, createdAt: z.date(), schemaVersion: z.literal(1), stateFingerprint: hash,
  trigger: z.enum(["explicit", "material_change"]), automaticDate: z.string().optional(), statement: z.record(z.string(), z.unknown()),
  auditTrail: z.array(z.object({ action: z.literal("captured"), actorUserId: id, at: z.date(), changedFields: z.array(z.string()),
    revision: z.literal(1), source: z.literal("net_worth_snapshot") }).strict()).length(1),
}).strict();
const fail = (): never => { throw new Error("Net worth recovery requires review"); };
export function projectRecoveryNetWorthItem(document: Document): Document {
  try {
    assertRecoveryContent(document); const row = item.parse(document);
    const fields = netWorthItemFieldsDomainSchema.parse(fromStoredDomainValue(row.fields));
    if (stable(toStoredDomainValue(fields)) !== stable(row.fields)
      || createHash("sha256").update(stable(fields), "utf8").digest("hex") !== row.payloadHash
      || row.auditTrail.length !== row.version) return fail();
    for (const [index, event] of row.auditTrail.entries()) {
      if (!event.actorUserId.equals(row.userId) || event.revision !== index + 1
        || (index === 0 ? event.action !== "created" : event.action === "created")
        || stable(event.changedFields) !== stable([event.action === "deleted" ? "deletedAt" : "fields"])) return fail();
      if (event.action === "deleted" && index !== row.auditTrail.length - 1) return fail();
    }
    const first = row.auditTrail[0]!; const last = row.auditTrail[row.auditTrail.length - 1]!;
    if (first.at.getTime() !== row.createdAt.getTime() || last.at.getTime() !== row.updatedAt.getTime()
      || (last.action === "deleted" ? row.deletedAt?.getTime() !== last.at.getTime() : row.deletedAt !== null)) return fail();
    // Current payload integrity is not the lost historical fields or relationship ownership proof.
    return document;
  } catch { return fail(); }
}

export function projectRecoveryNetWorthSnapshot(document: Document): Document {
  try {
    assertRecoveryContent(document); const row = snapshot.parse(document);
    const statement = netWorthStatementDomainSchema.parse(fromStoredDomainValue(row.statement));
    assertNetWorthStatementVersions(statement);
    if (stable(toStoredDomainValue(statement)) !== stable(row.statement)
      || netWorthStateFingerprint(statement) !== row.stateFingerprint) return fail();
    const event = row.auditTrail[0]!;
    if (!event.actorUserId.equals(row.userId) || event.at.getTime() !== row.createdAt.getTime()
      || stable(event.changedFields) !== stable(["statement", "trigger"])
      || (row.trigger === "material_change" ? row.automaticDate !== statement.evaluationDate : row.automaticDate !== undefined)) return fail();
    return document;
  } catch { return fail(); }
}
