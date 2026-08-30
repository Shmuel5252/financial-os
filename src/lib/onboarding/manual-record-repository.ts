import "server-only";

import {
  type Collection,
  type Db,
  type Document,
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
  source: "manual";
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
  safety_margin: "safetyMargins",
};

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
      { userId: 1, deletedAt: 1, updatedAt: -1 },
      { name: `${this.section}_owner_active_updated` },
    );

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
    const documents = await this.collection
      .find({
        deletedAt: null,
        userId: parseObjectId(actor.userId, "actor.userId"),
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(100)
      .toArray();

    return documents.map((document) => mapDocument(this.section, document));
  }

  async createForActor(
    actor: Actor,
    fields: ManualFields,
  ): Promise<ManualRecord> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
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
      source: "manual",
      updatedAt: now,
      userId: actorUserId,
      version: 1,
    };

    try {
      await this.collection.insertOne(document);
    } catch (error) {
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
): ManualRecordRepository {
  return new ManualRecordRepository(
    section,
    database.collection<ManualRecordDocument>(sectionCollections[section]),
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
