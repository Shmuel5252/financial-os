import "server-only";

import { createHash } from "node:crypto";

import {
  type Collection,
  type Db,
  type Document,
  MongoServerError,
  ObjectId,
} from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { fromStoredMoney, toStoredMoney } from "@/lib/db/money-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import { money } from "@/lib/domain/money/money";
import { ConflictError, DependencyUnavailableError } from "@/lib/errors/application-error";
import {
  type ManualFields,
  type ManualRecord,
  type ManualSection,
  validateManualFields,
} from "@/lib/onboarding/manual-record";

type AuditAction = "created" | "deleted" | "updated";

type ManualAuditEventDocument = {
  action: AuditAction;
  actorUserId: ObjectId;
  at: Date;
  changedFields: string[];
  revision: number;
  source: "manual";
};

export type ManualRecordDocument = {
  _id: ObjectId;
  auditTrail: ManualAuditEventDocument[];
  createdAt: Date;
  deletedAt: Date | null;
  fields: Document;
  idempotencyKeyHash?: string;
  idempotencyPayloadHash?: string;
  schemaVersion?: number;
  source: "manual" | Readonly<{ kind: "manual" }>;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

const sectionCollections: Readonly<Record<ManualSection, string>> = {
  accounts: "accounts",
  cards: "creditCards",
  expenses: "recurringExpenses",
  goals: "goals",
  income: "incomeSources",
  loans: "loans",
  recurring_transactions: "recurringTransactions",
  safety_margin: "safetyMargins",
  savings: "savings",
  transactions: "transactions",
};

export type ManualRecordPage = Readonly<{
  nextCursor: string | null;
  records: readonly ManualRecord[];
}>;

export type ManualRecordPageRequest = Readonly<{
  cursor?: string | undefined;
  limit: number;
}>;

function isDomainMoney(
  value: unknown,
): value is Readonly<{ amountMinor: bigint; currency: string }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "bigint" &&
    typeof value.currency === "string"
  );
}

function isStoredMoney(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value
  );
}

function toStoredValue(value: unknown): unknown {
  if (isDomainMoney(value)) {
    return toStoredMoney(money(value.amountMinor, value.currency));
  }

  if (Array.isArray(value)) {
    return value.map(toStoredValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toStoredValue(item)]),
    );
  }

  return value;
}

function fromStoredValue(value: unknown): unknown {
  if (isStoredMoney(value)) {
    try {
      return fromStoredMoney(value);
    } catch {
      // It may be an ordinary object with similarly named fields. The domain schema
      // below remains the authority and will reject malformed persisted data.
    }
  }

  if (Array.isArray(value)) {
    return value.map(fromStoredValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fromStoredValue(item)]),
    );
  }

  return value;
}

function toStoredFields(fields: ManualFields): Document {
  const stored = toStoredValue(fields);

  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new RangeError("Manual record fields must be an object.");
  }

  return stored;
}

function stableSerializableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(stableSerializableValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, item]) => [key, stableSerializableValue(item)]),
    );
  }

  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function idempotencyHashes(
  key: string,
  fields: ManualFields,
): Readonly<{ keyHash: string; payloadHash: string }> {
  return {
    keyHash: sha256(key),
    payloadHash: sha256(JSON.stringify(stableSerializableValue(fields))),
  };
}

function mapDocument(
  section: ManualSection,
  document: ManualRecordDocument,
): ManualRecord {
  if (
    !(document._id instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !(document.updatedAt instanceof Date) ||
    !Number.isInteger(document.version) ||
    document.version < 1
  ) {
    throw new DependencyUnavailableError("Stored manual record metadata is invalid.");
  }

  return {
    createdAt: document.createdAt,
    fields: validateManualFields(section, fromStoredValue(document.fields)),
    id: document._id.toHexString(),
    section,
    source: { kind: "manual" },
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

export class ManualRecordRepository {
  constructor(
    readonly section: ManualSection,
    private readonly collection: Collection<ManualRecordDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, deletedAt: 1, _id: -1 },
      { name: `${this.section}_owner_active_page` },
    );
    await this.collection.createIndex(
      { userId: 1, idempotencyKeyHash: 1 },
      {
        name: `${this.section}_owner_idempotency`,
        partialFilterExpression: { idempotencyKeyHash: { $type: "string" } },
        unique: true,
      },
    );
    await this.collection.createIndex(
      { userId: 1, _id: 1, deletedAt: 1, version: 1 },
      { name: `${this.section}_owner_record_version` },
    );

    if (this.section === "transactions") {
      await this.collection.createIndex(
        { userId: 1, deletedAt: 1, "fields.date": -1, _id: -1 },
        { name: "transactions_owner_date" },
      );
    }

    if (this.section === "recurring_transactions") {
      await this.collection.createIndex(
        {
          userId: 1,
          deletedAt: 1,
          "fields.nextOccurrenceDate": 1,
          _id: 1,
        },
        { name: "recurring_transactions_owner_next_occurrence" },
      );
    }

    if (this.section === "safety_margin") {
      await this.collection.createIndex(
        { userId: 1 },
        {
          name: "safety_margin_one_active_per_user",
          partialFilterExpression: { deletedAt: null },
          unique: true,
        },
      );
    }
  }

  async listForActor(actor: Actor): Promise<readonly ManualRecord[]> {
    return (await this.listPageForActor(actor, { limit: 100 })).records;
  }

  async listPageForActor(
    actor: Actor,
    request: ManualRecordPageRequest,
  ): Promise<ManualRecordPage> {
    const cursor =
      request.cursor === undefined
        ? undefined
        : parseObjectId(request.cursor, "cursor");
    const documents = await this.collection
      .find({
        ...(cursor === undefined ? {} : { _id: { $lt: cursor } }),
        deletedAt: null,
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
      records: pageDocuments.map((document) =>
        mapDocument(this.section, document),
      ),
    };
  }

  async listAllForActor(
    actor: Actor,
    maximumRecords = 10_000,
  ): Promise<readonly ManualRecord[]> {
    const documents = await this.collection
      .find({
        deletedAt: null,
        userId: parseObjectId(actor.userId, "actor.userId"),
      })
      .sort({ _id: 1 })
      .limit(maximumRecords + 1)
      .toArray();

    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError(
        "The owned data set is too large for the bounded manual export.",
      );
    }

    return documents.map((document) => mapDocument(this.section, document));
  }

  async existsForActor(actor: Actor, recordId: string): Promise<boolean> {
    return (
      (await this.collection.countDocuments(
        {
          _id: parseObjectId(recordId),
          deletedAt: null,
          userId: parseObjectId(actor.userId, "actor.userId"),
        },
        { limit: 1 },
      )) === 1
    );
  }

  async findForActor(
    actor: Actor,
    recordId: string,
  ): Promise<ManualRecord | null> {
    const document = await this.collection.findOne({
      _id: parseObjectId(recordId),
      deletedAt: null,
      userId: parseObjectId(actor.userId, "actor.userId"),
    });

    return document === null ? null : mapDocument(this.section, document);
  }

  async createForActor(
    actor: Actor,
    fields: ManualFields,
    idempotencyKey: string,
  ): Promise<ManualRecord> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const hashes = idempotencyHashes(idempotencyKey, fields);
    const previous = await this.collection.findOne({
      idempotencyKeyHash: hashes.keyHash,
      userId: actorUserId,
    });

    if (previous !== null) {
      if (previous.idempotencyPayloadHash !== hashes.payloadHash) {
        throw new ConflictError(
          "The idempotency key was already used for different data.",
        );
      }

      return mapDocument(this.section, previous);
    }

    const now = this.now();
    const document: ManualRecordDocument = {
      _id: new ObjectId(),
      auditTrail: [
        {
          action: "created",
          actorUserId,
          at: now,
          changedFields: Object.keys(fields),
          revision: 1,
          source: "manual",
        },
      ],
      createdAt: now,
      deletedAt: null,
      fields: toStoredFields(fields),
      idempotencyKeyHash: hashes.keyHash,
      idempotencyPayloadHash: hashes.payloadHash,
      schemaVersion: 2,
      source: { kind: "manual" },
      updatedAt: now,
      userId: actorUserId,
      version: 1,
    };

    try {
      await this.collection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.collection.findOne({
          idempotencyKeyHash: hashes.keyHash,
          userId: actorUserId,
        });

        if (
          concurrent !== null &&
          concurrent.idempotencyPayloadHash === hashes.payloadHash
        ) {
          return mapDocument(this.section, concurrent);
        }
      }

      if (
        this.section === "safety_margin" &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ) {
        throw new ConflictError("Only one active safety margin is allowed.");
      }

      throw error;
    }

    return mapDocument(this.section, document);
  }

  async updateForActor(
    actor: Actor,
    recordId: string,
    fields: ManualFields,
    expectedVersion: number,
  ): Promise<ManualRecord> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const now = this.now();
    const revision = expectedVersion + 1;
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: parseObjectId(recordId),
        deletedAt: null,
        userId: actorUserId,
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "updated",
            actorUserId,
            at: now,
            changedFields: Object.keys(fields),
            revision,
            source: "manual",
          },
        },
        $set: {
          fields: toStoredFields(fields),
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (updated === null) {
      throw new ConflictError();
    }

    return mapDocument(this.section, updated);
  }

  async deleteForActor(
    actor: Actor,
    recordId: string,
    expectedVersion: number,
  ): Promise<void> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const now = this.now();
    const result = await this.collection.updateOne(
      {
        _id: parseObjectId(recordId),
        deletedAt: null,
        userId: actorUserId,
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "deleted",
            actorUserId,
            at: now,
            changedFields: ["deletedAt"],
            revision: expectedVersion + 1,
            source: "manual",
          },
        },
        $set: {
          deletedAt: now,
          updatedAt: now,
        },
      },
    );

    if (result.modifiedCount !== 1) {
      throw new ConflictError();
    }
  }
}

export function manualRecordRepositoryForDatabase(
  database: Db,
  section: ManualSection,
  now?: () => Date,
): ManualRecordRepository {
  return new ManualRecordRepository(
    section,
    database.collection<ManualRecordDocument>(sectionCollections[section]),
    now,
  );
}

export async function getManualRecordRepository(
  section: ManualSection,
): Promise<ManualRecordRepository> {
  const repository = manualRecordRepositoryForDatabase(
    await getDatabase(),
    section,
  );
  await repository.ensureIndexes();
  return repository;
}
