/** Strict saved-report projection; preserves original BSON and verifies existing payload integrity. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { fromStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { reportScopeSchema, validateFinancialReport } from "@/lib/reports/report";
import { reportPayloadHash } from "@/lib/reports/report-repository";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/); const positive = z.number().int().positive();
const schema = z.object({ _id: id, userId: id, auditTrail: z.array(z.object({ action: z.enum(["closed", "hidden", "restated"]),
  actorUserId: id, at: z.date(), revision: positive }).strict()), authorizationFingerprint: hash.nullable(), createdAt: z.date(),
  hiddenAt: z.date().nullable(), idempotencyKeyHash: hash, idempotencyPayloadHash: hash, payloadHash: hash,
  report: z.record(z.string(), z.unknown()), reportVersion: positive, restatementReason: z.string().nullable(),
  rootReportId: id, schemaVersion: z.literal(1), scope: reportScopeSchema, status: z.enum(["closed", "restated"]),
  supersedesId: id.nullable(), version: positive }).strict();
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
export function projectRecoveryReport(row: Document): Document {
  try {
    assertRecoveryContent(row); const parsed = schema.parse(row);
    if (stable(row) !== stable(parsed) || parsed.auditTrail.some(event => !event.actorUserId.equals(parsed.userId))) throw new Error();
    const value = fromStoredDomainValue(parsed.report); const report = validateFinancialReport(value);
    if (stable(value) !== stable(report) || stable(report.scope) !== stable(parsed.scope)) throw new Error();
    if ((report.scope.kind === "personal") !== (parsed.authorizationFingerprint === null)) throw new Error();
    if (parsed.payloadHash !== reportPayloadHash(report, parsed.reportVersion, parsed.restatementReason, parsed.supersedesId?.toHexString() ?? null)) throw new Error();
    return row;
  } catch { throw new Error("Report recovery validation failed"); }
}
