import "server-only";

import { createHash } from "node:crypto";

import { type Collection, type Db, type Document, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import { ConflictError, DependencyUnavailableError, NotFoundError } from "@/lib/errors/application-error";
import { type FinancialReport, type ReportScope, type SavedFinancialReport, validateFinancialReport } from "@/lib/reports/report";

type ReportAuditDocument = Readonly<{
  action: "closed" | "hidden" | "restated";
  actorUserId: ObjectId;
  at: Date;
  revision: number;
}>;

type FinancialReportDocument = {
  _id: ObjectId;
  auditTrail: ReportAuditDocument[];
  authorizationFingerprint: string | null;
  createdAt: Date;
  hiddenAt: Date | null;
  idempotencyKeyHash: string;
  idempotencyPayloadHash: string;
  payloadHash: string;
  report: Document;
  reportVersion: number;
  restatementReason: string | null;
  rootReportId: ObjectId;
  schemaVersion: 1;
  scope: ReportScope;
  status: "closed" | "restated";
  supersedesId: ObjectId | null;
  userId: ObjectId;
  version: number;
};

const metadataSchema = z.object({
  _id: z.instanceof(ObjectId), authorizationFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(), createdAt: z.date(), hiddenAt: z.date().nullable(),
  reportVersion: z.number().int().positive(), restatementReason: z.string().nullable(), rootReportId: z.instanceof(ObjectId), schemaVersion: z.literal(1),
  status: z.enum(["closed", "restated"]), supersedesId: z.instanceof(ObjectId).nullable(), version: z.number().int().positive(),
});

function objectValue(value: unknown): Document {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RangeError("A report must be stored as an object.");
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableSerializableDomainValue(value)), "utf8").digest("hex");
}

function reportPayloadHash(report: FinancialReport, reportVersion: number, restatementReason: string | null, supersedesId: string | null): string {
  return hash({ report: { ...report, generatedAt: "request-time" }, reportVersion, restatementReason, supersedesId });
}

function mapDocument(document: FinancialReportDocument): SavedFinancialReport {
  const metadata = metadataSchema.safeParse(document);
  let report: FinancialReport;
  try { report = validateFinancialReport(fromStoredDomainValue(document.report)); } catch { throw new DependencyUnavailableError("Stored financial report is invalid."); }
  if (!metadata.success || document.payloadHash !== reportPayloadHash(report, document.reportVersion, document.restatementReason, document.supersedesId?.toHexString() ?? null)) {
    throw new DependencyUnavailableError("Stored financial report failed its integrity check.");
  }
  return {
    authorizationFingerprint: metadata.data.authorizationFingerprint,
    createdAt: metadata.data.createdAt,
    hiddenAt: metadata.data.hiddenAt,
    id: metadata.data._id.toHexString(),
    report,
    reportVersion: metadata.data.reportVersion,
    restatementReason: metadata.data.restatementReason,
    rootReportId: metadata.data.rootReportId.toHexString(),
    schemaVersion: metadata.data.schemaVersion,
    status: metadata.data.status,
    supersedesId: metadata.data.supersedesId?.toHexString() ?? null,
    version: metadata.data.version,
  };
}

export class FinancialReportRepository {
  constructor(private readonly collection: Collection<FinancialReportDocument>, private readonly now: () => Date = () => new Date()) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ userId: 1, idempotencyKeyHash: 1 }, { name: "reports_owner_idempotency", unique: true }),
      this.collection.createIndex({ userId: 1, hiddenAt: 1, _id: -1 }, { name: "reports_owner_visible_page" }),
      this.collection.createIndex({ userId: 1, rootReportId: 1, reportVersion: 1 }, { name: "reports_owner_root_version", unique: true }),
      this.collection.createIndex({ userId: 1, "scope.kind": 1, "report.period.kind": 1, "report.period.value": 1, _id: -1 }, { name: "reports_owner_period" }),
    ]);
  }

  async createForActor(actor: Actor, input: Readonly<{
    authorizationFingerprint: string | null; idempotencyKey: string; idempotencyPayload: unknown; report: FinancialReport; restatementReason: string | null; supersedes: SavedFinancialReport | null;
  }>): Promise<SavedFinancialReport> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const idempotencyKeyHash = hash(input.idempotencyKey);
    const idempotencyPayloadHash = hash(input.idempotencyPayload);
    const supersedesId = input.supersedes === null ? null : parseObjectId(input.supersedes.id, "supersedesId");
    const reportVersion = input.supersedes === null ? 1 : input.supersedes.reportVersion + 1;
    const payloadHash = reportPayloadHash(input.report, reportVersion, input.restatementReason, supersedesId?.toHexString() ?? null);
    const previous = await this.collection.findOne({ idempotencyKeyHash, userId });
    if (previous !== null) {
      if (previous.idempotencyPayloadHash !== idempotencyPayloadHash) throw new ConflictError("The idempotency key was already used for another report command.");
      if (previous.payloadHash !== payloadHash) throw new ConflictError("The idempotency key was already used for another report.");
      return mapDocument(previous);
    }
    const at = this.now();
    const id = new ObjectId();
    const rootReportId = input.supersedes === null ? id : parseObjectId(input.supersedes.rootReportId, "rootReportId");
    const document: FinancialReportDocument = {
      _id: id, auditTrail: [{ action: input.supersedes === null ? "closed" : "restated", actorUserId: userId, at, revision: 1 }],
      authorizationFingerprint: input.authorizationFingerprint, createdAt: at, hiddenAt: null, idempotencyKeyHash, idempotencyPayloadHash, payloadHash,
      report: objectValue(toStoredDomainValue(input.report)), reportVersion, restatementReason: input.restatementReason, rootReportId, schemaVersion: 1,
      scope: input.report.scope, status: input.supersedes === null ? "closed" : "restated", supersedesId, userId, version: 1,
    };
    try { await this.collection.insertOne(document); } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.collection.findOne({ idempotencyKeyHash, userId });
        if (concurrent !== null && concurrent.payloadHash === payloadHash) return mapDocument(concurrent);
        throw new ConflictError("The report version already exists.");
      }
      throw error;
    }
    return mapDocument(document);
  }

  async findIdempotentForActor(actor: Actor, idempotencyKey: string, idempotencyPayload: unknown): Promise<SavedFinancialReport | null> {
    const document = await this.collection.findOne({ idempotencyKeyHash: hash(idempotencyKey), userId: parseObjectId(actor.userId, "actor.userId") });
    if (document === null) return null;
    if (document.idempotencyPayloadHash !== hash(idempotencyPayload)) throw new ConflictError("The idempotency key was already used for another report command.");
    return mapDocument(document);
  }

  async findForActor(actor: Actor, id: string, includeHidden = false): Promise<SavedFinancialReport | null> {
    const document = await this.collection.findOne({ _id: parseObjectId(id, "reportId"), ...(includeHidden ? {} : { hiddenAt: null }), userId: parseObjectId(actor.userId, "actor.userId") });
    return document === null ? null : mapDocument(document);
  }

  async listForActor(actor: Actor, limit = 50): Promise<readonly SavedFinancialReport[]> {
    const documents = await this.collection.find({ hiddenAt: null, userId: parseObjectId(actor.userId, "actor.userId") }).sort({ _id: -1 }).limit(Math.min(limit, 100)).toArray();
    return documents.map(mapDocument);
  }

  async hideForActor(actor: Actor, id: string, expectedVersion: number): Promise<void> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    const result = await this.collection.updateOne({ _id: parseObjectId(id, "reportId"), hiddenAt: null, userId, version: expectedVersion }, {
      $inc: { version: 1 }, $push: { auditTrail: { action: "hidden", actorUserId: userId, at, revision: expectedVersion + 1 } }, $set: { hiddenAt: at },
    });
    if (result.modifiedCount !== 1) throw new NotFoundError();
  }
}

export function financialReportRepositoryForDatabase(database: Db, now?: () => Date): FinancialReportRepository {
  return new FinancialReportRepository(database.collection<FinancialReportDocument>("financialReports"), now);
}

export async function getFinancialReportRepository(): Promise<FinancialReportRepository> {
  const repository = financialReportRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
