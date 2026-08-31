import "server-only";

import { createHash } from "node:crypto";

import { type Collection, type Db, type Document, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import { ConflictError, DependencyUnavailableError } from "@/lib/errors/application-error";
import {
  GOAL_ENGINE_VERSION,
  GOAL_POLICY_VERSION,
  goalDefinitionConfigurationDomainSchema,
  goalDomainMoneySchema,
  type GoalDefinition,
  type GoalDefinitionConfiguration,
  type GoalEvidenceSource,
  type GoalMetricFact,
  type GoalProgressEvidence,
  type GoalProgressResult,
  type GoalReportedEvidence,
} from "@/lib/goals/goal";

type GoalDefinitionDocument = {
  _id: ObjectId;
  configuration: Document;
  createdAt: Date;
  definitionHash: string;
  goalId: ObjectId;
  idempotencyKeyHash: string;
  reportedEvidence: Document;
  schemaVersion: 1;
  targetDate: string | null;
  userId: ObjectId;
  version: number;
};

type GoalProgressDocument = {
  _id: ObjectId;
  createdAt: Date;
  engineVersion: typeof GOAL_ENGINE_VERSION;
  evaluatedAt: Date;
  evaluationDate: string;
  evidenceHash: string;
  goalDefinitionId: ObjectId;
  goalId: ObjectId;
  goalVersion: number;
  idempotencyKeyHash: string;
  metricFacts: Document[];
  milestonesCrossed: number[];
  policyVersion: typeof GOAL_POLICY_VERSION;
  reason: GoalProgressEvidence["reason"];
  result: Document;
  schemaVersion: 1;
  sourceReferences: GoalEvidenceSource[];
  timeZone: string;
  userId: ObjectId;
};

type GoalCommandReceiptDocument = {
  _id: ObjectId;
  commandKind: "definition" | "progress";
  createdAt: Date;
  idempotencyKeyHash: string;
  payloadHash: string;
  recordId: ObjectId;
  schemaVersion: 1;
  userId: ObjectId;
};

const resultSchema = z.object({
  baselineValue: goalDomainMoneySchema,
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  currentValue: goalDomainMoneySchema,
  direction: z.enum(["decrease", "increase"]),
  maintainedNow: z.boolean(),
  normalizedProgressBasisPoints: z.number().int().min(0).max(10_000),
  qualifiedSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rawProgressBasisPoints: z.string().regex(/^-?\d+$/),
  remainingGap: goalDomainMoneySchema,
  status: z.enum([
    "active",
    "completed",
    "insufficient_data",
    "manual_unverified",
    "regressed",
    "target_reached_pending_confirmation",
  ]),
  targetValue: goalDomainMoneySchema,
  trend: z.enum(["improving", "initial", "regressing", "unchanged"]),
  verification: z.enum(["insufficient_data", "manual_unverified", "verified"]),
});

const reportedEvidenceSchema = z.object({
  capturedAt: z.date(),
  currentValue: goalDomainMoneySchema,
  goalRecordVersion: z.number().int().min(1),
  startingValue: goalDomainMoneySchema,
  targetAmount: goalDomainMoneySchema,
});

const metricFactSchema = z.object({ key: z.string().min(1).max(100), value: goalDomainMoneySchema });
const sourceReferenceSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/i),
  kind: z.enum(["budget_period", "engine_snapshot", "goal_record", "manual_record"]),
  version: z.number().int().min(1).nullable(),
});

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function payloadHash(value: unknown): string {
  return sha256(JSON.stringify(stableSerializableDomainValue(value)));
}

function storedDocument(value: unknown, message: string): Document {
  const stored = toStoredDomainValue(value);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new RangeError(message);
  }
  return stored;
}

function mapDefinition(document: GoalDefinitionDocument): GoalDefinition {
  const configuration = goalDefinitionConfigurationDomainSchema.safeParse(fromStoredDomainValue(document.configuration));
  const reportedEvidence = reportedEvidenceSchema.safeParse(fromStoredDomainValue(document.reportedEvidence));
  if (
    !(document._id instanceof ObjectId) ||
    !(document.goalId instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !Number.isInteger(document.version) ||
    document.version < 1 ||
    !configuration.success ||
    !reportedEvidence.success
  ) {
    throw new DependencyUnavailableError("Stored goal definition is invalid.");
  }
  return {
    configuration: configuration.data,
    createdAt: document.createdAt,
    goalId: document.goalId.toHexString(),
    id: document._id.toHexString(),
    reportedEvidence: reportedEvidence.data,
    targetDate: document.targetDate,
    version: document.version,
  };
}

function mapProgress(document: GoalProgressDocument): GoalProgressEvidence {
  const result = resultSchema.safeParse(fromStoredDomainValue(document.result));
  const metricFacts = z.array(metricFactSchema).safeParse(fromStoredDomainValue(document.metricFacts));
  const sources = z.array(sourceReferenceSchema).safeParse(document.sourceReferences);
  if (
    !(document._id instanceof ObjectId) ||
    !(document.goalId instanceof ObjectId) ||
    !(document.goalDefinitionId instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !(document.evaluatedAt instanceof Date) ||
    !result.success ||
    !metricFacts.success ||
    !sources.success ||
    document.engineVersion !== GOAL_ENGINE_VERSION ||
    document.policyVersion !== GOAL_POLICY_VERSION
  ) {
    throw new DependencyUnavailableError("Stored goal progress evidence is invalid.");
  }
  return {
    createdAt: document.createdAt,
    engineVersion: document.engineVersion,
    evaluatedAt: document.evaluatedAt,
    evaluationDate: document.evaluationDate,
    evidenceHash: document.evidenceHash,
    goalDefinitionId: document.goalDefinitionId.toHexString(),
    goalId: document.goalId.toHexString(),
    goalVersion: document.goalVersion,
    id: document._id.toHexString(),
    metricFacts: metricFacts.data,
    milestonesCrossed: document.milestonesCrossed,
    policyVersion: document.policyVersion,
    reason: document.reason,
    result: result.data,
    sourceReferences: sources.data,
    timeZone: document.timeZone,
  };
}

export class GoalRepository {
  constructor(
    private readonly definitionCollection: Collection<GoalDefinitionDocument>,
    private readonly progressCollection: Collection<GoalProgressDocument>,
    private readonly receiptCollection: Collection<GoalCommandReceiptDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.definitionCollection.createIndex(
        { userId: 1, goalId: 1, version: -1 },
        { name: "goal_definitions_owner_goal_version", unique: true },
      ),
      this.definitionCollection.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        { name: "goal_definitions_owner_idempotency", unique: true },
      ),
      this.progressCollection.createIndex(
        { userId: 1, goalId: 1, goalVersion: 1, evaluatedAt: -1, _id: -1 },
        { name: "goal_progress_owner_goal_version_time" },
      ),
      this.progressCollection.createIndex(
        { userId: 1, goalId: 1, goalVersion: 1, evidenceHash: 1 },
        { name: "goal_progress_owner_evidence", unique: true },
      ),
      this.progressCollection.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        { name: "goal_progress_owner_idempotency", unique: true },
      ),
      this.receiptCollection.createIndex(
        { userId: 1, commandKind: 1, idempotencyKeyHash: 1 },
        { name: "goal_command_receipts_owner_idempotency", unique: true },
      ),
      this.receiptCollection.createIndex(
        { userId: 1, commandKind: 1, recordId: 1 },
        { name: "goal_command_receipts_owner_record" },
      ),
    ]);
  }

  private async findReceipt(
    actorUserId: ObjectId,
    commandKind: GoalCommandReceiptDocument["commandKind"],
    idempotencyKeyHash: string,
  ): Promise<GoalCommandReceiptDocument | null> {
    return this.receiptCollection.findOne({ commandKind, idempotencyKeyHash, userId: actorUserId });
  }

  private async recordReceipt(input: Omit<GoalCommandReceiptDocument, "_id" | "createdAt" | "schemaVersion">): Promise<GoalCommandReceiptDocument> {
    const receipt: GoalCommandReceiptDocument = {
      ...input,
      _id: new ObjectId(),
      createdAt: this.now(),
      schemaVersion: 1,
    };
    try {
      await this.receiptCollection.insertOne(receipt);
      return receipt;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const existing = await this.findReceipt(input.userId, input.commandKind, input.idempotencyKeyHash);
        if (
          existing !== null &&
          existing.commandKind === input.commandKind &&
          existing.payloadHash === input.payloadHash &&
          existing.recordId.equals(input.recordId)
        ) {
          return existing;
        }
        throw new ConflictError("The idempotency key was already used for another goal command.");
      }
      throw error;
    }
  }

  async hasDefinitionForActor(actor: Actor, goalId: string): Promise<boolean> {
    return (await this.definitionCollection.countDocuments({
      goalId: parseObjectId(goalId, "goalId"),
      userId: parseObjectId(actor.userId, "actor.userId"),
    }, { limit: 1 })) === 1;
  }

  async findLatestDefinitionForActor(actor: Actor, goalId: string): Promise<GoalDefinition | null> {
    const document = await this.definitionCollection.findOne(
      { goalId: parseObjectId(goalId, "goalId"), userId: parseObjectId(actor.userId, "actor.userId") },
      { sort: { version: -1 } },
    );
    return document === null ? null : mapDefinition(document);
  }

  async listLatestDefinitionsForActor(actor: Actor, maximumGoals = 100): Promise<readonly GoalDefinition[]> {
    const documents = await this.definitionCollection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ goalId: 1, version: -1 })
      .limit(maximumGoals * 50 + 1)
      .toArray();
    if (documents.length > maximumGoals * 50) {
      throw new DependencyUnavailableError("The goal definition history exceeds its bounded result set.");
    }
    const latest = new Map<string, GoalDefinition>();
    for (const document of documents) {
      const definition = mapDefinition(document);
      if (!latest.has(definition.goalId)) latest.set(definition.goalId, definition);
    }
    if (latest.size > maximumGoals) {
      throw new DependencyUnavailableError("The active goal set exceeds its bounded result set.");
    }
    return [...latest.values()];
  }

  async listAllDefinitionsForActor(
    actor: Actor,
    maximumRecords = 5_000,
  ): Promise<readonly GoalDefinition[]> {
    const documents = await this.definitionCollection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ goalId: 1, version: 1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError("The goal definition export exceeds its bounded result set.");
    }
    return documents.map(mapDefinition);
  }

  async createDefinitionVersionForActor(
    actor: Actor,
    input: Readonly<{
      configuration: GoalDefinitionConfiguration;
      expectedDefinitionVersion: number | null;
      goalId: string;
      reportedEvidence: GoalReportedEvidence;
      targetDate: string | null;
    }>,
    idempotencyKey: string,
  ): Promise<GoalDefinition> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const goalId = parseObjectId(input.goalId, "goalId");
    const idempotencyKeyHash = sha256(idempotencyKey);
    const definitionHash = payloadHash({ configuration: input.configuration, targetDate: input.targetDate });
    const requestHash = payloadHash({
      definitionHash,
      expectedDefinitionVersion: input.expectedDefinitionVersion,
      goalId: input.goalId,
      reportedEvidence: input.reportedEvidence,
    });
    const receipt = await this.findReceipt(actorUserId, "definition", idempotencyKeyHash);
    if (receipt !== null) {
      if (receipt.commandKind !== "definition" || receipt.payloadHash !== requestHash) {
        throw new ConflictError("The idempotency key was already used for another goal definition.");
      }
      const receivedDefinition = await this.definitionCollection.findOne({
        _id: receipt.recordId,
        userId: actorUserId,
      });
      if (receivedDefinition === null) throw new DependencyUnavailableError("The idempotent goal definition is unavailable.");
      return mapDefinition(receivedDefinition);
    }
    const previousRetry = await this.definitionCollection.findOne({ idempotencyKeyHash, userId: actorUserId });
    if (previousRetry !== null) {
      if (previousRetry.definitionHash !== definitionHash || !previousRetry.goalId.equals(goalId)) {
        throw new ConflictError("The idempotency key was already used for another goal definition.");
      }
      return mapDefinition(previousRetry);
    }
    const latest = await this.definitionCollection.findOne(
      { goalId, userId: actorUserId },
      { sort: { version: -1 } },
    );
    const latestVersion = latest?.version ?? null;
    if (latestVersion !== input.expectedDefinitionVersion) throw new ConflictError();
    if (latest !== null && latest.definitionHash === definitionHash) {
      await this.recordReceipt({
        commandKind: "definition",
        idempotencyKeyHash,
        payloadHash: requestHash,
        recordId: latest._id,
        userId: actorUserId,
      });
      return mapDefinition(latest);
    }
    const createdAt = this.now();
    const document: GoalDefinitionDocument = {
      _id: new ObjectId(),
      configuration: storedDocument(input.configuration, "Goal configuration must be an object."),
      createdAt,
      definitionHash,
      goalId,
      idempotencyKeyHash,
      reportedEvidence: storedDocument(input.reportedEvidence, "Reported goal evidence must be an object."),
      schemaVersion: 1,
      targetDate: input.targetDate,
      userId: actorUserId,
      version: (latestVersion ?? 0) + 1,
    };
    try {
      await this.definitionCollection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const retry = await this.definitionCollection.findOne({ idempotencyKeyHash, userId: actorUserId });
        if (retry !== null && retry.definitionHash === definitionHash && retry.goalId.equals(goalId)) {
          return mapDefinition(retry);
        }
        throw new ConflictError();
      }
      throw error;
    }
    return mapDefinition(document);
  }

  async findLatestProgressForActor(
    actor: Actor,
    goalId: string,
    goalVersion: number,
  ): Promise<GoalProgressEvidence | null> {
    const document = await this.progressCollection.findOne(
      {
        goalId: parseObjectId(goalId, "goalId"),
        goalVersion,
        userId: parseObjectId(actor.userId, "actor.userId"),
      },
      { sort: { evaluatedAt: -1, _id: -1 } },
    );
    return document === null ? null : mapProgress(document);
  }

  async findProgressByIdempotencyKeyForActor(
    actor: Actor,
    idempotencyKey: string,
  ): Promise<GoalProgressEvidence | null> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const idempotencyKeyHash = sha256(idempotencyKey);
    const document = await this.progressCollection.findOne({
      idempotencyKeyHash,
      userId: actorUserId,
    });
    if (document !== null) return mapProgress(document);
    const receipt = await this.findReceipt(actorUserId, "progress", idempotencyKeyHash);
    if (receipt === null) return null;
    const receivedProgress = await this.progressCollection.findOne({
      _id: receipt.recordId,
      userId: actorUserId,
    });
    if (receivedProgress === null) throw new DependencyUnavailableError("The idempotent goal evidence is unavailable.");
    return mapProgress(receivedProgress);
  }

  async listProgressForActor(
    actor: Actor,
    goalId: string,
    goalVersion: number,
    maximumRecords = 200,
  ): Promise<readonly GoalProgressEvidence[]> {
    const documents = await this.progressCollection
      .find({
        goalId: parseObjectId(goalId, "goalId"),
        goalVersion,
        userId: parseObjectId(actor.userId, "actor.userId"),
      })
      .sort({ evaluatedAt: -1, _id: -1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError("The goal progress history exceeds its bounded result set.");
    }
    return documents.map(mapProgress);
  }

  async listAllProgressForActor(
    actor: Actor,
    maximumRecords = 10_000,
  ): Promise<readonly GoalProgressEvidence[]> {
    const documents = await this.progressCollection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ evaluatedAt: 1, _id: 1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError("The goal progress export exceeds its bounded result set.");
    }
    return documents.map(mapProgress);
  }

  async createProgressForActor(
    actor: Actor,
    input: Readonly<{
      evaluatedAt: Date;
      evaluationDate: string;
      evidenceHash: string;
      goalDefinitionId: string;
      goalId: string;
      goalVersion: number;
      metricFacts: readonly GoalMetricFact[];
      milestonesCrossed: readonly number[];
      reason: GoalProgressEvidence["reason"];
      result: GoalProgressResult;
      sourceReferences: readonly GoalEvidenceSource[];
      timeZone: string;
    }>,
    idempotencyKey: string,
  ): Promise<GoalProgressEvidence> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const idempotencyKeyHash = sha256(idempotencyKey);
    const goalId = parseObjectId(input.goalId, "goalId");
    const existingRetry = await this.progressCollection.findOne({ idempotencyKeyHash, userId: actorUserId });
    if (existingRetry !== null) {
      if (existingRetry.evidenceHash !== input.evidenceHash || !existingRetry.goalId.equals(goalId)) {
        throw new ConflictError("The idempotency key was already used for another goal evaluation.");
      }
      return mapProgress(existingRetry);
    }
    const receipt = await this.findReceipt(actorUserId, "progress", idempotencyKeyHash);
    if (receipt !== null) {
      if (receipt.commandKind !== "progress" || receipt.payloadHash !== input.evidenceHash) {
        throw new ConflictError("The idempotency key was already used for another goal evaluation.");
      }
      const receivedProgress = await this.progressCollection.findOne({
        _id: receipt.recordId,
        userId: actorUserId,
      });
      if (receivedProgress === null) throw new DependencyUnavailableError("The idempotent goal evidence is unavailable.");
      return mapProgress(receivedProgress);
    }
    const existingEvidence = await this.progressCollection.findOne({
      evidenceHash: input.evidenceHash,
      goalId,
      goalVersion: input.goalVersion,
      userId: actorUserId,
    });
    if (existingEvidence !== null) {
      await this.recordReceipt({
        commandKind: "progress",
        idempotencyKeyHash,
        payloadHash: input.evidenceHash,
        recordId: existingEvidence._id,
        userId: actorUserId,
      });
      return mapProgress(existingEvidence);
    }
    const createdAt = this.now();
    const document: GoalProgressDocument = {
      _id: new ObjectId(),
      createdAt,
      engineVersion: GOAL_ENGINE_VERSION,
      evaluatedAt: input.evaluatedAt,
      evaluationDate: input.evaluationDate,
      evidenceHash: input.evidenceHash,
      goalDefinitionId: parseObjectId(input.goalDefinitionId, "goalDefinitionId"),
      goalId,
      goalVersion: input.goalVersion,
      idempotencyKeyHash,
      metricFacts: input.metricFacts.map((fact) => storedDocument(fact, "Goal metric fact must be an object.")),
      milestonesCrossed: [...input.milestonesCrossed],
      policyVersion: GOAL_POLICY_VERSION,
      reason: input.reason,
      result: storedDocument(input.result, "Goal progress result must be an object."),
      schemaVersion: 1,
      sourceReferences: [...input.sourceReferences],
      timeZone: input.timeZone,
      userId: actorUserId,
    };
    try {
      await this.progressCollection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const retry = await this.progressCollection.findOne({
          userId: actorUserId,
          $or: [{ idempotencyKeyHash }, { evidenceHash: input.evidenceHash, goalId, goalVersion: input.goalVersion }],
        });
        if (retry !== null && retry.evidenceHash === input.evidenceHash && retry.goalId.equals(goalId)) {
          return mapProgress(retry);
        }
        throw new ConflictError();
      }
      throw error;
    }
    return mapProgress(document);
  }
}

export function goalRepositoryForDatabase(database: Db): GoalRepository {
  return new GoalRepository(
    database.collection<GoalDefinitionDocument>("goalDefinitions"),
    database.collection<GoalProgressDocument>("goalProgress"),
    database.collection<GoalCommandReceiptDocument>("goalCommandReceipts"),
  );
}

export async function getGoalRepository(): Promise<GoalRepository> {
  const repository = goalRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
