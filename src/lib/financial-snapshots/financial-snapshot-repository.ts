import "server-only";

import { createHash } from "node:crypto";

import {
  type Collection,
  type Db,
  MongoServerError,
  ObjectId,
} from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import {
  ConflictError,
  DependencyUnavailableError,
} from "@/lib/errors/application-error";
import {
  storedFinancialSnapshotSourceSchema,
  type FinancialSnapshot,
  type FinancialSnapshotSource,
} from "@/lib/financial-snapshots/financial-snapshot";

type FinancialSnapshotDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "created";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "manual";
  }>[];
  capturedAt: Date;
  idempotencyKeyHash: string;
  kind: "source_manifest";
  primaryCurrency: string;
  schemaVersion: 1;
  sources: readonly FinancialSnapshotSource[];
  userId: ObjectId;
};

const storedSnapshotSchema = z.object({
  _id: z.instanceof(ObjectId),
  capturedAt: z.date(),
  kind: z.literal("source_manifest"),
  primaryCurrency: z.string().regex(/^[A-Z]{3}$/),
  schemaVersion: z.literal(1),
  sources: z.array(storedFinancialSnapshotSourceSchema),
});

function mapDocument(document: FinancialSnapshotDocument): FinancialSnapshot {
  const parsed = storedSnapshotSchema.safeParse(document);

  if (!parsed.success) {
    throw new DependencyUnavailableError("Stored financial snapshot is invalid.");
  }

  return {
    capturedAt: parsed.data.capturedAt,
    id: parsed.data._id.toHexString(),
    kind: parsed.data.kind,
    primaryCurrency: parsed.data.primaryCurrency,
    schemaVersion: parsed.data.schemaVersion,
    sources: parsed.data.sources,
  };
}

export type FinancialSnapshotPage = Readonly<{
  nextCursor: string | null;
  snapshots: readonly FinancialSnapshot[];
}>;

export class FinancialSnapshotRepository {
  constructor(
    private readonly collection: Collection<FinancialSnapshotDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, _id: -1 },
      { name: "financial_snapshots_owner_page" },
    );
    await this.collection.createIndex(
      { userId: 1, idempotencyKeyHash: 1 },
      { name: "financial_snapshots_owner_idempotency", unique: true },
    );
  }

  async createForActor(
    actor: Actor,
    primaryCurrency: string,
    sources: readonly FinancialSnapshotSource[],
    idempotencyKey: string,
  ): Promise<FinancialSnapshot> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const idempotencyKeyHash = createHash("sha256")
      .update(idempotencyKey, "utf8")
      .digest("hex");
    const previous = await this.collection.findOne({
      idempotencyKeyHash,
      userId: actorUserId,
    });

    if (previous !== null) {
      return mapDocument(previous);
    }

    const capturedAt = this.now();
    const document: FinancialSnapshotDocument = {
      _id: new ObjectId(),
      auditTrail: [
        {
          action: "created",
          actorUserId,
          at: capturedAt,
          changedFields: ["primaryCurrency", "sources"],
          revision: 1,
          source: "manual",
        },
      ],
      capturedAt,
      idempotencyKeyHash,
      kind: "source_manifest",
      primaryCurrency,
      schemaVersion: 1,
      sources,
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

        if (concurrent !== null) {
          return mapDocument(concurrent);
        }

        throw new ConflictError();
      }

      throw error;
    }

    return mapDocument(document);
  }

  async listForActor(
    actor: Actor,
    request: Readonly<{ cursor?: string | undefined; limit: number }>,
  ): Promise<FinancialSnapshotPage> {
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

export function financialSnapshotRepositoryForDatabase(
  database: Db,
): FinancialSnapshotRepository {
  return new FinancialSnapshotRepository(
    database.collection<FinancialSnapshotDocument>("financialSnapshots"),
  );
}

export async function getFinancialSnapshotRepository(): Promise<FinancialSnapshotRepository> {
  const repository = financialSnapshotRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
