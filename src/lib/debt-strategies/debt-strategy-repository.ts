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
  assertDebtStrategyVersions,
  debtStrategyComparisonDomainSchema,
  debtStrategyInputDomainSchema,
  type SavedDebtStrategy,
} from "@/lib/debt-strategies/debt-strategy";
import type { DebtStrategyComparison, DebtStrategyInput } from "@/lib/domain/debt-strategies/debt-strategy-engine";

type DebtStrategyDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "saved";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "debt_strategy";
  }>[];
  comparison: Document;
  createdAt: Date;
  debtReferences: readonly Readonly<{ id: ObjectId; version: number }>[];
  idempotencyKeyHash: string;
  input: Document;
  inputHash: string;
  name: string | null;
  note: string | null;
  schemaVersion: 1;
  userId: ObjectId;
};

const metadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().max(80).nullable(),
  note: z.string().max(500).nullable(),
  schemaVersion: z.literal(1),
});

function objectValue(value: unknown, field: string): Document {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError(`${field} must be stored as an object.`);
  }
  return value;
}

function hashValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableSerializableDomainValue(value)), "utf8")
    .digest("hex");
}

function mapDocument(document: DebtStrategyDocument): SavedDebtStrategy {
  const metadata = metadataSchema.safeParse(document);
  const input = debtStrategyInputDomainSchema.safeParse(fromStoredDomainValue(document.input));
  const comparison = debtStrategyComparisonDomainSchema.safeParse(fromStoredDomainValue(document.comparison));
  if (!metadata.success || !input.success || !comparison.success) {
    throw new DependencyUnavailableError("Stored debt-strategy evidence is invalid.");
  }
  assertDebtStrategyVersions(comparison.data);
  const inputDebtRefs = input.data.debts.map((debt) => `${debt.id}:${debt.sourceVersion}`).sort();
  const storedDebtRefs = document.debtReferences.map((debt) => `${debt.id.toHexString()}:${debt.version}`).sort();
  if (JSON.stringify(inputDebtRefs) !== JSON.stringify(storedDebtRefs)) {
    throw new DependencyUnavailableError("Stored debt-strategy provenance is inconsistent.");
  }
  if (metadata.data.inputHash !== hashValue({
    comparison: comparison.data,
    input: input.data,
    name: metadata.data.name,
    note: metadata.data.note,
  })) {
    throw new DependencyUnavailableError("Stored debt-strategy evidence failed its integrity check.");
  }
  return {
    comparison: comparison.data,
    createdAt: metadata.data.createdAt,
    id: metadata.data._id.toHexString(),
    input: input.data,
    name: metadata.data.name,
    note: metadata.data.note,
    schemaVersion: metadata.data.schemaVersion,
  };
}

export type DebtStrategyPage = Readonly<{
  nextCursor: string | null;
  scenarios: readonly SavedDebtStrategy[];
}>;

export class DebtStrategyRepository {
  constructor(
    private readonly collection: Collection<DebtStrategyDocument>,
    private readonly loans: Collection<Document>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, idempotencyKeyHash: 1 },
      { name: "debt_strategies_owner_idempotency", unique: true },
    );
    await this.collection.createIndex(
      { userId: 1, _id: -1 },
      { name: "debt_strategies_owner_page" },
    );
  }

  async saveForActor(
    actor: Actor,
    input: DebtStrategyInput,
    comparison: DebtStrategyComparison,
    metadata: Readonly<{ idempotencyKey: string; name: string | null; note: string | null }>,
  ): Promise<SavedDebtStrategy> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const parsedInput = debtStrategyInputDomainSchema.parse(input);
    const parsedComparison = debtStrategyComparisonDomainSchema.parse(comparison);
    assertDebtStrategyVersions(parsedComparison);
    if (parsedInput.evaluationDate !== parsedComparison.evaluationDate ||
      parsedInput.extraPayment.amountMinor !== parsedComparison.extraPayment.amountMinor ||
      parsedInput.extraPayment.currency !== parsedComparison.extraPayment.currency) {
      throw new ConflictError("The saved debt-strategy evidence is inconsistent.");
    }
    const debtReferences = parsedInput.debts.map((debt) => ({
      id: parseObjectId(debt.id, "debtId"),
      version: debt.sourceVersion,
    }));
    const ownedCount = await this.loans.countDocuments({
      $or: debtReferences.map((reference) => ({ _id: reference.id, version: reference.version })),
      deletedAt: null,
      userId: actorUserId,
    });
    if (ownedCount !== debtReferences.length) {
      throw new ConflictError("An owned debt revision is no longer available.");
    }

    const inputHash = hashValue({ comparison: parsedComparison, input: parsedInput, name: metadata.name, note: metadata.note });
    const idempotencyKeyHash = createHash("sha256").update(metadata.idempotencyKey, "utf8").digest("hex");
    const previous = await this.collection.findOne({ idempotencyKeyHash, userId: actorUserId });
    if (previous !== null) {
      if (previous.inputHash !== inputHash) throw new ConflictError("The idempotency key was already used for different debt-strategy evidence.");
      return mapDocument(previous);
    }
    const createdAt = this.now();
    const document: DebtStrategyDocument = {
      _id: new ObjectId(),
      auditTrail: [{ action: "saved", actorUserId, at: createdAt, changedFields: ["input", "comparison", "name", "note"], revision: 1, source: "debt_strategy" }],
      comparison: objectValue(toStoredDomainValue(parsedComparison), "comparison"),
      createdAt,
      debtReferences,
      idempotencyKeyHash,
      input: objectValue(toStoredDomainValue(parsedInput), "input"),
      inputHash,
      name: metadata.name,
      note: metadata.note,
      schemaVersion: 1,
      userId: actorUserId,
    };
    try {
      await this.collection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.collection.findOne({ idempotencyKeyHash, userId: actorUserId });
        if (concurrent !== null && concurrent.inputHash === inputHash) return mapDocument(concurrent);
      }
      throw error;
    }
    return mapDocument(document);
  }

  async listForActor(actor: Actor, request: Readonly<{ cursor?: string | undefined; limit: number }>): Promise<DebtStrategyPage> {
    const cursor = request.cursor === undefined ? undefined : parseObjectId(request.cursor, "cursor");
    const documents = await this.collection.find({
      ...(cursor === undefined ? {} : { _id: { $lt: cursor } }),
      userId: parseObjectId(actor.userId, "actor.userId"),
    }).sort({ _id: -1 }).limit(request.limit + 1).toArray();
    const hasNextPage = documents.length > request.limit;
    const page = hasNextPage ? documents.slice(0, request.limit) : documents;
    return {
      nextCursor: hasNextPage ? page.at(-1)?._id.toHexString() ?? null : null,
      scenarios: page.map(mapDocument),
    };
  }

  async listAllForActor(actor: Actor, maximumRecords = 100): Promise<readonly SavedDebtStrategy[]> {
    const documents = await this.collection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ _id: 1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError("The debt-strategy export exceeds its bounded result set.");
    }
    return documents.map(mapDocument);
  }
}

export function debtStrategyRepositoryForDatabase(database: Db, now?: () => Date): DebtStrategyRepository {
  return new DebtStrategyRepository(
    database.collection<DebtStrategyDocument>("debtStrategyScenarios"),
    database.collection<Document>("loans"),
    now,
  );
}

export async function getDebtStrategyRepository(): Promise<DebtStrategyRepository> {
  const repository = debtStrategyRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
