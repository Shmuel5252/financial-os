import "server-only";

import { createHash } from "node:crypto";

import { type Collection, type Db, type Document, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import { ConflictError, DependencyUnavailableError, NotFoundError } from "@/lib/errors/application-error";
import {
  assertNetWorthStatementVersions,
  netWorthItemFieldsDomainSchema,
  netWorthStatementDomainSchema,
  type NetWorthItem,
  type NetWorthItemFields,
  type NetWorthSnapshot,
} from "@/lib/net-worth/net-worth";
import type { NetWorthStatement } from "@/lib/domain/net-worth/net-worth-engine";

type ItemAudit = Readonly<{
  action: "created" | "deleted" | "updated";
  actorUserId: ObjectId;
  at: Date;
  changedFields: readonly string[];
  revision: number;
  source: "net_worth_item";
}>;
type NetWorthItemDocument = {
  _id: ObjectId;
  auditTrail: ItemAudit[];
  createdAt: Date;
  deletedAt: Date | null;
  fields: Document;
  idempotencyKeyHash: string;
  payloadHash: string;
  schemaVersion: 1;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};
type NetWorthSnapshotDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "captured";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "net_worth_snapshot";
  }>[];
  automaticDate?: string;
  createdAt: Date;
  schemaVersion: 1;
  stateFingerprint: string;
  statement: Document;
  trigger: "explicit" | "material_change";
  userId: ObjectId;
};

const itemMetadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
  schemaVersion: z.literal(1),
  updatedAt: z.date(),
  version: z.number().int().positive(),
});
const snapshotMetadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  schemaVersion: z.literal(1),
  stateFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  trigger: z.enum(["explicit", "material_change"]),
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

function mapItem(document: NetWorthItemDocument): NetWorthItem {
  const metadata = itemMetadataSchema.safeParse(document);
  const fields = netWorthItemFieldsDomainSchema.safeParse(fromStoredDomainValue(document.fields));
  if (!metadata.success || !fields.success) {
    throw new DependencyUnavailableError("Stored net-worth item is invalid.");
  }
  return {
    createdAt: metadata.data.createdAt,
    fields: fields.data,
    id: metadata.data._id.toHexString(),
    updatedAt: metadata.data.updatedAt,
    version: metadata.data.version,
  };
}

function mapSnapshot(document: NetWorthSnapshotDocument): NetWorthSnapshot {
  const metadata = snapshotMetadataSchema.safeParse(document);
  const statement = netWorthStatementDomainSchema.safeParse(fromStoredDomainValue(document.statement));
  if (!metadata.success || !statement.success) {
    throw new DependencyUnavailableError("Stored net-worth snapshot is invalid.");
  }
  assertNetWorthStatementVersions(statement.data);
  if (metadata.data.stateFingerprint !== netWorthStateFingerprint(statement.data)) {
    throw new DependencyUnavailableError("Stored net-worth snapshot failed its integrity check.");
  }
  return {
    createdAt: metadata.data.createdAt,
    id: metadata.data._id.toHexString(),
    schemaVersion: metadata.data.schemaVersion,
    stateFingerprint: metadata.data.stateFingerprint,
    statement: statement.data,
    trigger: metadata.data.trigger,
  };
}

export function netWorthStateFingerprint(statement: NetWorthStatement): string {
  return hashValue({
    engineVersion: statement.engineVersion,
    evaluationDate: statement.evaluationDate,
    excluded: statement.excluded,
    freshnessVersion: statement.freshnessVersion,
    included: statement.included,
    inputHash: statement.inputHash,
    policyVersion: statement.policyVersion,
    timeZone: statement.timeZone,
    totals: statement.totals,
  });
}

export type NetWorthSnapshotPage = Readonly<{
  nextCursor: string | null;
  snapshots: readonly NetWorthSnapshot[];
}>;

export class NetWorthRepository {
  constructor(
    private readonly items: Collection<NetWorthItemDocument>,
    private readonly snapshots: Collection<NetWorthSnapshotDocument>,
    private readonly accounts: Collection<Document>,
    private readonly cards: Collection<Document>,
    private readonly loans: Collection<Document>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.items.createIndex({ userId: 1, idempotencyKeyHash: 1 }, { name: "net_worth_items_owner_idempotency", unique: true }),
      this.items.createIndex({ userId: 1, deletedAt: 1, _id: 1 }, { name: "net_worth_items_owner_active" }),
      this.snapshots.createIndex({ userId: 1, stateFingerprint: 1 }, { name: "net_worth_snapshots_owner_state", unique: true }),
      this.snapshots.createIndex({ userId: 1, _id: -1 }, { name: "net_worth_snapshots_owner_page" }),
      this.snapshots.createIndex(
        { userId: 1, automaticDate: 1 },
        { name: "net_worth_snapshots_owner_automatic_day", partialFilterExpression: { automaticDate: { $type: "string" } }, unique: true },
      ),
    ]);
  }

  private async assertRelationship(actorUserId: ObjectId, fields: NetWorthItemFields): Promise<void> {
    if (fields.relationship.kind === "standalone") return;
    if (fields.relationship.kind === "account_detail") {
      const account = await this.accounts.findOne({ _id: parseObjectId(fields.relationship.accountId, "accountId"), deletedAt: null, userId: actorUserId });
      if (account === null) throw new NotFoundError();
      return;
    }
    const collection = fields.relationship.recordKind === "loan" ? this.loans : this.cards;
    const record = await collection.findOne({ _id: parseObjectId(fields.relationship.recordId, "recordId"), deletedAt: null, userId: actorUserId });
    if (record === null) throw new NotFoundError();
  }

  async createItemForActor(actor: Actor, fields: NetWorthItemFields, idempotencyKey: string): Promise<NetWorthItem> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const parsedFields = netWorthItemFieldsDomainSchema.parse(fields);
    await this.assertRelationship(actorUserId, parsedFields);
    const payloadHash = hashValue(parsedFields);
    const idempotencyKeyHash = hashValue(idempotencyKey);
    const previous = await this.items.findOne({ idempotencyKeyHash, userId: actorUserId });
    if (previous !== null) {
      if (previous.payloadHash !== payloadHash) throw new ConflictError("The idempotency key was already used for a different net-worth item.");
      if (previous.deletedAt !== null) throw new ConflictError("The idempotent net-worth item is no longer active.");
      return mapItem(previous);
    }
    const at = this.now();
    const document: NetWorthItemDocument = {
      _id: new ObjectId(),
      auditTrail: [{ action: "created", actorUserId, at, changedFields: ["fields"], revision: 1, source: "net_worth_item" }],
      createdAt: at,
      deletedAt: null,
      fields: objectValue(toStoredDomainValue(parsedFields), "fields"),
      idempotencyKeyHash,
      payloadHash,
      schemaVersion: 1,
      updatedAt: at,
      userId: actorUserId,
      version: 1,
    };
    try {
      await this.items.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.items.findOne({ idempotencyKeyHash, userId: actorUserId });
        if (concurrent !== null && concurrent.payloadHash === payloadHash && concurrent.deletedAt === null) return mapItem(concurrent);
      }
      throw error;
    }
    return mapItem(document);
  }

  async updateItemForActor(actor: Actor, id: string, expectedVersion: number, fields: NetWorthItemFields): Promise<NetWorthItem> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const parsedFields = netWorthItemFieldsDomainSchema.parse(fields);
    await this.assertRelationship(actorUserId, parsedFields);
    const at = this.now();
    const result = await this.items.findOneAndUpdate(
      { _id: parseObjectId(id, "itemId"), deletedAt: null, userId: actorUserId, version: expectedVersion },
      {
        $push: { auditTrail: { action: "updated", actorUserId, at, changedFields: ["fields"], revision: expectedVersion + 1, source: "net_worth_item" } },
        $set: { fields: objectValue(toStoredDomainValue(parsedFields), "fields"), payloadHash: hashValue(parsedFields), updatedAt: at },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (result === null) throw new ConflictError("The net-worth item changed or is unavailable.");
    return mapItem(result);
  }

  async deleteItemForActor(actor: Actor, id: string, expectedVersion: number): Promise<void> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    const result = await this.items.updateOne(
      { _id: parseObjectId(id, "itemId"), deletedAt: null, userId: actorUserId, version: expectedVersion },
      {
        $push: { auditTrail: { action: "deleted", actorUserId, at, changedFields: ["deletedAt"], revision: expectedVersion + 1, source: "net_worth_item" } },
        $set: { deletedAt: at, updatedAt: at },
        $inc: { version: 1 },
      },
    );
    if (result.modifiedCount !== 1) throw new ConflictError("The net-worth item changed or is unavailable.");
  }

  async listItemsForActor(actor: Actor, maximumRecords = 1_000): Promise<readonly NetWorthItem[]> {
    const documents = await this.items.find({ deletedAt: null, userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ _id: 1 }).limit(maximumRecords + 1).toArray();
    if (documents.length > maximumRecords) throw new DependencyUnavailableError("The net-worth item set exceeds its safe bound.");
    return documents.map(mapItem);
  }

  async captureSnapshotForActor(actor: Actor, statement: NetWorthStatement, trigger: "explicit" | "material_change"): Promise<NetWorthSnapshot> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const parsed = netWorthStatementDomainSchema.parse(statement);
    assertNetWorthStatementVersions(parsed);
    const stateFingerprint = netWorthStateFingerprint(parsed);
    const existing = await this.snapshots.findOne({ stateFingerprint, userId: actorUserId });
    if (existing !== null) return mapSnapshot(existing);
    if (trigger === "material_change") {
      const daily = await this.snapshots.findOne({ automaticDate: parsed.evaluationDate, userId: actorUserId });
      if (daily !== null) return mapSnapshot(daily);
    }
    const createdAt = this.now();
    const document: NetWorthSnapshotDocument = {
      _id: new ObjectId(),
      auditTrail: [{ action: "captured", actorUserId, at: createdAt, changedFields: ["statement", "trigger"], revision: 1, source: "net_worth_snapshot" }],
      ...(trigger === "material_change" ? { automaticDate: parsed.evaluationDate } : {}),
      createdAt,
      schemaVersion: 1,
      stateFingerprint,
      statement: objectValue(toStoredDomainValue(parsed), "statement"),
      trigger,
      userId: actorUserId,
    };
    try {
      await this.snapshots.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.snapshots.findOne(trigger === "material_change"
          ? { automaticDate: parsed.evaluationDate, userId: actorUserId }
          : { stateFingerprint, userId: actorUserId });
        if (concurrent !== null) return mapSnapshot(concurrent);
      }
      throw error;
    }
    return mapSnapshot(document);
  }

  async listSnapshotsForActor(actor: Actor, request: Readonly<{ cursor?: string | undefined; limit: number }>): Promise<NetWorthSnapshotPage> {
    const cursor = request.cursor === undefined ? undefined : parseObjectId(request.cursor, "cursor");
    const documents = await this.snapshots.find({
      ...(cursor === undefined ? {} : { _id: { $lt: cursor } }),
      userId: parseObjectId(actor.userId, "actor.userId"),
    }).sort({ _id: -1 }).limit(request.limit + 1).toArray();
    const hasNextPage = documents.length > request.limit;
    const page = hasNextPage ? documents.slice(0, request.limit) : documents;
    return { nextCursor: hasNextPage ? page.at(-1)?._id.toHexString() ?? null : null, snapshots: page.map(mapSnapshot) };
  }

  async listAllSnapshotsForActor(actor: Actor, maximumRecords = 1_000): Promise<readonly NetWorthSnapshot[]> {
    const documents = await this.snapshots.find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ _id: 1 }).limit(maximumRecords + 1).toArray();
    if (documents.length > maximumRecords) throw new DependencyUnavailableError("The net-worth history exceeds its export bound.");
    return documents.map(mapSnapshot);
  }
}

export function netWorthRepositoryForDatabase(database: Db, now?: () => Date): NetWorthRepository {
  return new NetWorthRepository(
    database.collection<NetWorthItemDocument>("netWorthItems"),
    database.collection<NetWorthSnapshotDocument>("netWorthSnapshots"),
    database.collection<Document>("accounts"),
    database.collection<Document>("creditCards"),
    database.collection<Document>("loans"),
    now,
  );
}

export async function getNetWorthRepository(): Promise<NetWorthRepository> {
  const repository = netWorthRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
