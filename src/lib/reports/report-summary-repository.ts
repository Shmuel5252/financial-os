import "server-only";

import { createHash } from "node:crypto";

import { type Collection, type Db, type Document, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { aiStructuredResponseSchema } from "@/lib/domain/ai/ai-safety";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import { DependencyUnavailableError, NotFoundError } from "@/lib/errors/application-error";
import { REPORT_AI_SUMMARY_POLICY_VERSION, type ReportAiSummary } from "@/lib/reports/report-summary";

type SummaryDocument = {
  _id: ObjectId; createdAt: Date; deletedAt: Date | null; evidence: Document[]; idempotencyKeyHash: string; model: string;
  policyVersion: typeof REPORT_AI_SUMMARY_POLICY_VERSION; provider: "anthropic"; reportId: ObjectId; reportSourceFingerprint: string;
  response: Document; usage: { inputTokens: number; outputTokens: number }; userId: ObjectId; version: number;
};
const evidenceSchema = z.array(z.object({ label: z.string(), ref: z.string(), value: z.unknown() })).max(32);

function hash(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function map(document: SummaryDocument): ReportAiSummary {
  const evidence = evidenceSchema.safeParse(document.evidence);
  const response = aiStructuredResponseSchema.safeParse(document.response);
  if (!evidence.success || !response.success || document.policyVersion !== REPORT_AI_SUMMARY_POLICY_VERSION) throw new DependencyUnavailableError("Stored report summary is invalid.");
  return { createdAt: document.createdAt, evidence: evidence.data as ReportAiSummary["evidence"], id: document._id.toHexString(), model: document.model, policyVersion: document.policyVersion, provider: document.provider, reportId: document.reportId.toHexString(), reportSourceFingerprint: document.reportSourceFingerprint, response: response.data, usage: document.usage, version: document.version };
}

export class ReportSummaryRepository {
  constructor(private readonly collection: Collection<SummaryDocument>, private readonly now: () => Date = () => new Date()) {}
  async ensureIndexes() { await Promise.all([
    this.collection.createIndex({ userId: 1, idempotencyKeyHash: 1 }, { name: "report_summaries_owner_idempotency", unique: true }),
    this.collection.createIndex({ userId: 1, reportId: 1, version: 1 }, { name: "report_summaries_owner_report_version", unique: true }),
    this.collection.createIndex({ userId: 1, reportId: 1, deletedAt: 1, version: -1 }, { name: "report_summaries_owner_report_versions" }),
  ]); }
  async createForActor(actor: Actor, input: Omit<ReportAiSummary, "createdAt" | "id">, idempotencyKey: string): Promise<ReportAiSummary> {
    const userId = parseObjectId(actor.userId, "actor.userId"); const idempotencyKeyHash = hash(idempotencyKey);
    const previous = await this.collection.findOne({ idempotencyKeyHash, userId }); if (previous !== null) return map(previous);
    const document: SummaryDocument = { _id: new ObjectId(), createdAt: this.now(), deletedAt: null, evidence: input.evidence as unknown as Document[], idempotencyKeyHash, model: input.model, policyVersion: input.policyVersion, provider: input.provider, reportId: parseObjectId(input.reportId, "reportId"), reportSourceFingerprint: input.reportSourceFingerprint, response: input.response as Document, usage: input.usage, userId, version: input.version };
    try { await this.collection.insertOne(document); } catch (error) { if (error instanceof MongoServerError && error.code === 11000) { const concurrent = await this.collection.findOne({ idempotencyKeyHash, userId }); if (concurrent !== null) return map(concurrent); } throw error; }
    return map(document);
  }
  async listForReportActor(actor: Actor, reportId: string): Promise<readonly ReportAiSummary[]> {
    return (await this.collection.find({ deletedAt: null, reportId: parseObjectId(reportId, "reportId"), userId: parseObjectId(actor.userId, "actor.userId") }).sort({ version: -1 }).limit(50).toArray()).map(map);
  }
  async findForActor(actor: Actor, id: string): Promise<ReportAiSummary | null> {
    const document = await this.collection.findOne({ _id: parseObjectId(id, "summaryId"), deletedAt: null, userId: parseObjectId(actor.userId, "actor.userId") });
    return document === null ? null : map(document);
  }
  async deleteForActor(actor: Actor, id: string, expectedVersion: number): Promise<void> {
    const result = await this.collection.updateOne({ _id: parseObjectId(id, "summaryId"), deletedAt: null, userId: parseObjectId(actor.userId, "actor.userId"), version: expectedVersion }, { $set: { deletedAt: this.now() } });
    if (result.modifiedCount !== 1) throw new NotFoundError();
  }
}
export function reportSummaryRepositoryForDatabase(database: Db, now?: () => Date) { return new ReportSummaryRepository(database.collection<SummaryDocument>("reportAiSummaries"), now); }
export async function getReportSummaryRepository() { const repository = reportSummaryRepositoryForDatabase(await getDatabase()); await repository.ensureIndexes(); return repository; }
