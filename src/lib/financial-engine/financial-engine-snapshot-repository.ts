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
  toStoredDomainValue,
} from "@/lib/db/domain-value-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import type { FinancialEngineResult } from "@/lib/domain/financial-engine/financial-engine";
import {
  ConflictError,
  DependencyUnavailableError,
} from "@/lib/errors/application-error";
import {
  storedFinancialEngineResultSchema,
  type FinancialEngineSnapshot,
} from "@/lib/financial-engine/financial-engine-snapshot";

type FinancialEngineSnapshotDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "calculated";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "financial_engine";
  }>[];
  calculatedAt: Date;
  engineVersion: string;
  idempotencyKeyHash: string;
  inputHash: string;
  kind: "engine_result";
  policyVersion: string;
  result: Document;
  schemaVersion: 1;
  sourceManifestId: ObjectId;
  userId: ObjectId;
};

const storedSnapshotMetadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  calculatedAt: z.date(),
  engineVersion: z.string().min(1),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.literal("engine_result"),
  policyVersion: z.string().min(1),
  schemaVersion: z.literal(1),
  sourceManifestId: z.instanceof(ObjectId),
});

function mapDocument(
  document: FinancialEngineSnapshotDocument,
): FinancialEngineSnapshot {
  const metadata = storedSnapshotMetadataSchema.safeParse(document);
  const result = storedFinancialEngineResultSchema.safeParse(
    fromStoredDomainValue(document.result),
  );

  if (
    !metadata.success ||
    !result.success ||
    metadata.data.engineVersion !== result.data.engineVersion ||
    metadata.data.policyVersion !== result.data.policyVersion
  ) {
    throw new DependencyUnavailableError(
      "Stored financial engine snapshot is invalid.",
    );
  }

  return {
    calculatedAt: metadata.data.calculatedAt,
    engineVersion: metadata.data.engineVersion,
    id: metadata.data._id.toHexString(),
    inputHash: metadata.data.inputHash,
    kind: metadata.data.kind,
    policyVersion: metadata.data.policyVersion,
    result: result.data,
    schemaVersion: metadata.data.schemaVersion,
    sourceManifestId: metadata.data.sourceManifestId.toHexString(),
  };
}

export type FinancialEngineSnapshotPage = Readonly<{
  nextCursor: string | null;
  snapshots: readonly FinancialEngineSnapshot[];
}>;

export class FinancialEngineSnapshotRepository {
  constructor(
    private readonly collection: Collection<FinancialEngineSnapshotDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, idempotencyKeyHash: 1 },
      { name: "financial_snapshots_owner_idempotency", unique: true },
    );
    await this.collection.createIndex(
      { userId: 1, kind: 1, _id: -1 },
      { name: "financial_engine_snapshots_owner_page" },
    );
    await this.collection.createIndex(
      {
        userId: 1,
        kind: 1,
        inputHash: 1,
        engineVersion: 1,
        policyVersion: 1,
      },
      {
        name: "financial_engine_snapshots_reproducible_input",
        partialFilterExpression: { kind: "engine_result" },
      },
    );
  }

  async createForActor(
    actor: Actor,
    inputHash: string,
    result: FinancialEngineResult,
    sourceManifestId: string,
    idempotencyKey: string,
  ): Promise<FinancialEngineSnapshot> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    if (!/^[0-9a-f]{64}$/.test(inputHash)) {
      throw new RangeError("Financial engine input hash is invalid.");
    }
    storedFinancialEngineResultSchema.parse(result);
    const parsedSourceManifestId = parseObjectId(
      sourceManifestId,
      "sourceManifestId",
    );
    const sourceManifestExists =
      (await (
        this.collection as unknown as Collection<Document>
      ).countDocuments(
        {
          _id: parsedSourceManifestId,
          kind: "source_manifest",
          userId: actorUserId,
        },
        { limit: 1 },
      )) === 1;
    if (!sourceManifestExists) {
      throw new ConflictError("The owned source manifest is unavailable.");
    }
    const idempotencyKeyHash = createHash("sha256")
      .update(`${idempotencyKey}:engine`, "utf8")
      .digest("hex");
    const previous = await this.collection.findOne({
      idempotencyKeyHash,
      kind: "engine_result",
      userId: actorUserId,
    });

    if (previous !== null) {
      if (previous.inputHash !== inputHash) {
        throw new ConflictError(
          "The idempotency key was already used for different financial inputs.",
        );
      }
      return mapDocument(previous);
    }

    const calculatedAt = this.now();
    const storedResult = toStoredDomainValue(result);
    if (
      typeof storedResult !== "object" ||
      storedResult === null ||
      Array.isArray(storedResult)
    ) {
      throw new RangeError("Financial engine result must be an object.");
    }

    const document: FinancialEngineSnapshotDocument = {
      _id: new ObjectId(),
      auditTrail: [
        {
          action: "calculated",
          actorUserId,
          at: calculatedAt,
          changedFields: ["inputHash", "result", "sourceManifestId"],
          revision: 1,
          source: "financial_engine",
        },
      ],
      calculatedAt,
      engineVersion: result.engineVersion,
      idempotencyKeyHash,
      inputHash,
      kind: "engine_result",
      policyVersion: result.policyVersion,
      result: storedResult,
      schemaVersion: 1,
      sourceManifestId: parsedSourceManifestId,
      userId: actorUserId,
    };

    try {
      await this.collection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.collection.findOne({
          idempotencyKeyHash,
          kind: "engine_result",
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

  async listForActor(
    actor: Actor,
    request: Readonly<{ cursor?: string | undefined; limit: number }>,
  ): Promise<FinancialEngineSnapshotPage> {
    const cursor =
      request.cursor === undefined
        ? undefined
        : parseObjectId(request.cursor, "cursor");
    const documents = await this.collection
      .find({
        ...(cursor === undefined ? {} : { _id: { $lt: cursor } }),
        kind: "engine_result",
        userId: parseObjectId(actor.userId, "actor.userId"),
      })
      .sort({ _id: -1 })
      .limit(request.limit + 1)
      .toArray();
    const hasNextPage = documents.length > request.limit;
    const pageDocuments = hasNextPage
      ? documents.slice(0, request.limit)
      : documents;

    return {
      nextCursor: hasNextPage
        ? (pageDocuments.at(-1)?._id.toHexString() ?? null)
        : null,
      snapshots: pageDocuments.map(mapDocument),
    };
  }
}

export function financialEngineSnapshotRepositoryForDatabase(
  database: Db,
): FinancialEngineSnapshotRepository {
  return new FinancialEngineSnapshotRepository(
    database.collection<FinancialEngineSnapshotDocument>("financialSnapshots"),
  );
}

export async function getFinancialEngineSnapshotRepository(): Promise<FinancialEngineSnapshotRepository> {
  const repository = financialEngineSnapshotRepositoryForDatabase(
    await getDatabase(),
  );
  await repository.ensureIndexes();
  return repository;
}
