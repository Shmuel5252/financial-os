import "server-only";

import { createHash } from "node:crypto";

import {
  type Collection,
  type Db,
  type Document,
  MongoServerError,
  ObjectId,
} from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import {
  fromStoredDomainValue,
  stableSerializableDomainValue,
  toStoredDomainValue,
} from "@/lib/db/domain-value-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import {
  ConflictError,
  DependencyUnavailableError,
} from "@/lib/errors/application-error";
import {
  purchaseSimulationEvaluationDomainSchema,
  purchaseSimulationParametersDomainSchema,
  type PurchaseSimulationEvaluation,
  type PurchaseSimulationParameters,
  type SavedPurchaseSimulation,
} from "@/lib/purchase-simulations/purchase-simulation";

type PurchaseSimulationDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "saved";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "purchase_simulation";
  }>[];
  createdAt: Date;
  evaluation: Document;
  idempotencyKeyHash: string;
  input: Document;
  inputHash: string;
  name: string | null;
  note: string | null;
  schemaVersion: 1;
  sourceSnapshotId: ObjectId;
  userId: ObjectId;
};

const storedMetadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().max(80).nullable(),
  note: z.string().max(500).nullable(),
  schemaVersion: z.literal(1),
  sourceSnapshotId: z.instanceof(ObjectId),
});

function asDocument(value: unknown, field: string): Document {
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

function mapDocument(
  document: PurchaseSimulationDocument,
): SavedPurchaseSimulation {
  const metadata = storedMetadataSchema.safeParse(document);
  const input = purchaseSimulationParametersDomainSchema.safeParse(
    fromStoredDomainValue(document.input),
  );
  const evaluation = purchaseSimulationEvaluationDomainSchema.safeParse(
    fromStoredDomainValue(document.evaluation),
  );
  if (!metadata.success || !input.success || !evaluation.success) {
    throw new DependencyUnavailableError(
      "Stored purchase simulation evidence is invalid.",
    );
  }
  if (
    input.data.sourceSnapshotId !==
      metadata.data.sourceSnapshotId.toHexString() ||
    evaluation.data.sourceSnapshot.id !== input.data.sourceSnapshotId
  ) {
    throw new DependencyUnavailableError(
      "Stored purchase simulation provenance is inconsistent.",
    );
  }
  return {
    createdAt: metadata.data.createdAt,
    evaluation: evaluation.data,
    id: metadata.data._id.toHexString(),
    input: input.data,
    name: metadata.data.name,
    note: metadata.data.note,
    schemaVersion: metadata.data.schemaVersion,
  };
}

export type PurchaseSimulationPage = Readonly<{
  nextCursor: string | null;
  simulations: readonly SavedPurchaseSimulation[];
}>;

export class PurchaseSimulationRepository {
  constructor(
    private readonly collection: Collection<PurchaseSimulationDocument>,
    private readonly financialSnapshots: Collection<Document>,
    private readonly budgetPeriods: Collection<Document>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, idempotencyKeyHash: 1 },
      { name: "purchase_simulations_owner_idempotency", unique: true },
    );
    await this.collection.createIndex(
      { userId: 1, _id: -1 },
      { name: "purchase_simulations_owner_page" },
    );
    await this.collection.createIndex(
      { userId: 1, sourceSnapshotId: 1, _id: -1 },
      { name: "purchase_simulations_owner_snapshot" },
    );
  }

  async saveForActor(
    actor: Actor,
    input: PurchaseSimulationParameters,
    evaluation: PurchaseSimulationEvaluation,
    metadata: Readonly<{
      idempotencyKey: string;
      name: string | null;
      note: string | null;
    }>,
  ): Promise<SavedPurchaseSimulation> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const parsedInput = purchaseSimulationParametersDomainSchema.parse(input);
    const parsedEvaluation =
      purchaseSimulationEvaluationDomainSchema.parse(evaluation);
    if (parsedInput.sourceSnapshotId !== parsedEvaluation.sourceSnapshot.id) {
      throw new ConflictError("The simulation source snapshot is inconsistent.");
    }
    const sourceSnapshotId = parseObjectId(
      parsedInput.sourceSnapshotId,
      "sourceSnapshotId",
    );
    const sourceExists =
      (await this.financialSnapshots.countDocuments(
        {
          _id: sourceSnapshotId,
          kind: "engine_result",
          userId: actorUserId,
        },
        { limit: 1 },
      )) === 1;
    if (!sourceExists) {
      throw new ConflictError("The owned Financial Engine snapshot is unavailable.");
    }
    if (parsedEvaluation.budgetPeriodReference !== null) {
      const budget = parsedEvaluation.budgetPeriodReference;
      const budgetExists =
        (await this.budgetPeriods.countDocuments(
          {
            _id: parseObjectId(budget.id, "budgetPeriodId"),
            calendarMonth: budget.calendarMonth,
            userId: actorUserId,
            version: budget.version,
          },
          { limit: 1 },
        )) === 1;
      if (!budgetExists) {
        throw new ConflictError("The owned budget-period reference is unavailable.");
      }
    }

    const inputHash = hashValue({
      evaluation: parsedEvaluation,
      input: parsedInput,
      name: metadata.name,
      note: metadata.note,
    });
    const idempotencyKeyHash = createHash("sha256")
      .update(metadata.idempotencyKey, "utf8")
      .digest("hex");
    const previous = await this.collection.findOne({
      idempotencyKeyHash,
      userId: actorUserId,
    });
    if (previous !== null) {
      if (previous.inputHash !== inputHash) {
        throw new ConflictError(
          "The idempotency key was already used for different simulation evidence.",
        );
      }
      return mapDocument(previous);
    }

    const createdAt = this.now();
    const document: PurchaseSimulationDocument = {
      _id: new ObjectId(),
      auditTrail: [
        {
          action: "saved",
          actorUserId,
          at: createdAt,
          changedFields: ["input", "evaluation", "name", "note"],
          revision: 1,
          source: "purchase_simulation",
        },
      ],
      createdAt,
      evaluation: asDocument(
        toStoredDomainValue(parsedEvaluation),
        "evaluation",
      ),
      idempotencyKeyHash,
      input: asDocument(toStoredDomainValue(parsedInput), "input"),
      inputHash,
      name: metadata.name,
      note: metadata.note,
      schemaVersion: 1,
      sourceSnapshotId,
      userId: actorUserId,
    };

    try {
      await this.collection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.collection.findOne({
          idempotencyKeyHash,
          userId: actorUserId,
        });
        if (concurrent !== null && concurrent.inputHash === inputHash) {
          return mapDocument(concurrent);
        }
      }
      throw error;
    }
    return mapDocument(document);
  }

  async findForActor(
    actor: Actor,
    id: string,
  ): Promise<SavedPurchaseSimulation | null> {
    const document = await this.collection.findOne({
      _id: parseObjectId(id, "simulationId"),
      userId: parseObjectId(actor.userId, "actor.userId"),
    });
    return document === null ? null : mapDocument(document);
  }

  async listForActor(
    actor: Actor,
    request: Readonly<{ cursor?: string | undefined; limit: number }>,
  ): Promise<PurchaseSimulationPage> {
    const cursor =
      request.cursor === undefined
        ? undefined
        : parseObjectId(request.cursor, "cursor");
    const documents = await this.collection
      .find({
        ...(cursor === undefined ? {} : { _id: { $lt: cursor } }),
        userId: parseObjectId(actor.userId, "actor.userId"),
      })
      .sort({ _id: -1 })
      .limit(request.limit + 1)
      .toArray();
    const hasNextPage = documents.length > request.limit;
    const page = hasNextPage ? documents.slice(0, request.limit) : documents;
    return {
      nextCursor: hasNextPage ? (page.at(-1)?._id.toHexString() ?? null) : null,
      simulations: page.map(mapDocument),
    };
  }

  async listAllForActor(
    actor: Actor,
    maximumRecords = 100,
  ): Promise<readonly SavedPurchaseSimulation[]> {
    const documents = await this.collection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ _id: 1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError(
        "The purchase simulation export exceeds its bounded result set.",
      );
    }
    return documents.map(mapDocument);
  }
}

export function purchaseSimulationRepositoryForDatabase(
  database: Db,
  now?: () => Date,
): PurchaseSimulationRepository {
  return new PurchaseSimulationRepository(
    database.collection<PurchaseSimulationDocument>("purchaseSimulations"),
    database.collection<Document>("financialSnapshots"),
    database.collection<Document>("budgetPeriods"),
    now,
  );
}

export async function getPurchaseSimulationRepository(): Promise<PurchaseSimulationRepository> {
  const repository = purchaseSimulationRepositoryForDatabase(
    await getDatabase(),
  );
  await repository.ensureIndexes();
  return repository;
}
