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
import {
  budgetCalculationSchema,
  budgetCategoryIdSchema,
  calendarMonthSchema,
  systemBudgetCategoryKeys,
  systemCategoryId,
  type BudgetAllocation,
  type BudgetCalculation,
  type BudgetCategory,
  type BudgetCorrection,
  type BudgetPeriod,
  type RolloverPolicy,
  type SystemBudgetCategoryKey,
} from "@/lib/budgets/budget";
import {
  fromStoredDomainValue,
  stableSerializableDomainValue,
  toStoredDomainValue,
} from "@/lib/db/domain-value-mapper";
import { fromStoredMoney, toStoredMoney, type StoredMoney } from "@/lib/db/money-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import {
  ConflictError,
  DependencyUnavailableError,
} from "@/lib/errors/application-error";

type CategoryAuditEventDocument = {
  action: "created" | "updated";
  actorUserId: ObjectId;
  after: Document;
  at: Date;
  before: Document | null;
  revision: number;
};

type BudgetCategoryDocument = {
  _id: ObjectId;
  auditTrail: CategoryAuditEventDocument[];
  categoryId: string;
  createdAt: Date;
  hidden: boolean;
  idempotencyKeyHash?: string;
  idempotencyPayloadHash?: string;
  kind: "custom" | "system";
  label: string | null;
  rolloverPolicy: RolloverPolicy;
  sortOrder: number;
  systemKey: SystemBudgetCategoryKey | null;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type StoredAllocation = {
  amount: StoredMoney;
  categoryId: string;
};

type PeriodAuditEventDocument = {
  action: "closed" | "created" | "updated";
  actorUserId: ObjectId;
  allocationsAfter: StoredAllocation[];
  allocationsBefore: StoredAllocation[] | null;
  at: Date;
  revision: number;
};

type BudgetPeriodDocument = {
  _id: ObjectId;
  allocations: StoredAllocation[];
  auditTrail: PeriodAuditEventDocument[];
  calendarMonth: string;
  carryIn: StoredAllocation[];
  closedAt: Date | null;
  closingSnapshot: Document | null;
  createdAt: Date;
  currency: string;
  status: "closed" | "open";
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type BudgetCorrectionDocument = {
  _id: ObjectId;
  actorUserId: ObjectId;
  at: Date;
  fromCategoryId: string | null;
  idempotencyKeyHash: string;
  idempotencyPayloadHash: string;
  reason: string;
  toCategoryId: string;
  transactionId: ObjectId;
  userId: ObjectId;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function payloadHash(value: unknown): string {
  return sha256(JSON.stringify(stableSerializableDomainValue(value)));
}

function categorySettings(category: Readonly<{
  hidden: boolean;
  label: string | null;
  rolloverPolicy: RolloverPolicy;
  sortOrder: number;
}>): Document {
  return {
    hidden: category.hidden,
    label: category.label,
    rolloverPolicy: category.rolloverPolicy,
    sortOrder: category.sortOrder,
  };
}

function defaultSystemCategory(
  key: SystemBudgetCategoryKey,
  index: number,
): BudgetCategory {
  return {
    categoryId: systemCategoryId(key),
    hidden: false,
    kind: "system",
    label: null,
    rolloverPolicy: "reset",
    sortOrder: (index + 1) * 10,
    systemKey: key,
    version: 0,
  };
}

function mapCategory(document: BudgetCategoryDocument): BudgetCategory {
  if (
    !(document._id instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !(document.updatedAt instanceof Date) ||
    !budgetCategoryIdSchema.safeParse(document.categoryId).success ||
    !Number.isInteger(document.version) ||
    document.version < 1 ||
    !Number.isInteger(document.sortOrder) ||
    document.sortOrder < 0 ||
    (document.rolloverPolicy !== "reset" &&
      document.rolloverPolicy !== "carry") ||
    (document.kind === "system" && document.systemKey === null) ||
    (document.kind === "custom" && document.systemKey !== null) ||
    (document.kind === "system" &&
      document.systemKey !== null &&
      document.categoryId !== systemCategoryId(document.systemKey))
  ) {
    throw new DependencyUnavailableError("Stored budget category is invalid.");
  }

  return {
    categoryId: document.categoryId,
    hidden: document.hidden,
    kind: document.kind,
    label: document.label,
    rolloverPolicy: document.rolloverPolicy,
    sortOrder: document.sortOrder,
    systemKey: document.systemKey,
    version: document.version,
  };
}

function storeAllocations(
  allocations: readonly BudgetAllocation[],
): StoredAllocation[] {
  return allocations.map((allocation) => ({
    amount: toStoredMoney(allocation.amount),
    categoryId: budgetCategoryIdSchema.parse(allocation.categoryId),
  }));
}

function mapAllocations(
  allocations: readonly StoredAllocation[],
  currency: string,
): readonly BudgetAllocation[] {
  return allocations.map((allocation) => {
    const amount = fromStoredMoney(allocation.amount);
    if (amount.currency !== currency) {
      throw new DependencyUnavailableError(
        "Stored budget allocation currency is invalid.",
      );
    }
    return {
      amount,
      categoryId: budgetCategoryIdSchema.parse(allocation.categoryId),
    };
  });
}

function mapPeriod(document: BudgetPeriodDocument): BudgetPeriod {
  if (
    !(document._id instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !(document.updatedAt instanceof Date) ||
    !calendarMonthSchema.safeParse(document.calendarMonth).success ||
    !/^[A-Z]{3}$/.test(document.currency) ||
    !Number.isInteger(document.version) ||
    document.version < 1 ||
    (document.status === "closed") !== (document.closedAt instanceof Date) ||
    (document.status === "closed") !== (document.closingSnapshot !== null)
  ) {
    throw new DependencyUnavailableError("Stored budget period is invalid.");
  }
  const closingSnapshot =
    document.closingSnapshot === null
      ? null
      : budgetCalculationSchema.safeParse(
          fromStoredDomainValue(document.closingSnapshot),
        );
  if (closingSnapshot !== null && !closingSnapshot.success) {
    throw new DependencyUnavailableError(
      "Stored budget closing evidence is invalid.",
    );
  }

  return {
    allocations: mapAllocations(document.allocations, document.currency),
    calendarMonth: document.calendarMonth,
    carryIn: mapAllocations(document.carryIn, document.currency),
    closedAt: document.closedAt,
    closingSnapshot: closingSnapshot === null ? null : closingSnapshot.data,
    createdAt: document.createdAt,
    currency: document.currency,
    id: document._id.toHexString(),
    status: document.status,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

function mapCorrection(
  document: BudgetCorrectionDocument,
): BudgetCorrection {
  if (
    !(document._id instanceof ObjectId) ||
    !(document.transactionId instanceof ObjectId) ||
    !(document.at instanceof Date) ||
    !budgetCategoryIdSchema.safeParse(document.toCategoryId).success ||
    (document.fromCategoryId !== null &&
      !budgetCategoryIdSchema.safeParse(document.fromCategoryId).success)
  ) {
    throw new DependencyUnavailableError("Stored budget correction is invalid.");
  }
  return {
    at: document.at,
    fromCategoryId: document.fromCategoryId,
    id: document._id.toHexString(),
    reason: document.reason,
    toCategoryId: document.toCategoryId,
    transactionId: document.transactionId.toHexString(),
  };
}

export class BudgetRepository {
  constructor(
    private readonly categoryCollection: Collection<BudgetCategoryDocument>,
    private readonly periodCollection: Collection<BudgetPeriodDocument>,
    private readonly correctionCollection: Collection<BudgetCorrectionDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.categoryCollection.createIndex(
        { userId: 1, categoryId: 1 },
        { name: "budget_categories_owner_category", unique: true },
      ),
      this.categoryCollection.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        {
          name: "budget_categories_owner_idempotency",
          partialFilterExpression: { idempotencyKeyHash: { $type: "string" } },
          unique: true,
        },
      ),
      this.periodCollection.createIndex(
        { userId: 1, calendarMonth: 1 },
        { name: "budget_periods_owner_month", unique: true },
      ),
      this.periodCollection.createIndex(
        { userId: 1, status: 1, calendarMonth: -1 },
        { name: "budget_periods_owner_status_month" },
      ),
      this.correctionCollection.createIndex(
        { userId: 1, transactionId: 1, at: 1, _id: 1 },
        { name: "budget_corrections_owner_transaction_history" },
      ),
      this.correctionCollection.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        { name: "budget_corrections_owner_idempotency", unique: true },
      ),
    ]);
  }

  async listCategoriesForActor(actor: Actor): Promise<readonly BudgetCategory[]> {
    const documents = await this.categoryCollection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ sortOrder: 1, categoryId: 1 })
      .limit(200)
      .toArray();
    const overrides = new Map(
      documents.map((document) => [document.categoryId, mapCategory(document)]),
    );
    const system = systemBudgetCategoryKeys.map((key, index) =>
      overrides.get(systemCategoryId(key)) ?? defaultSystemCategory(key, index),
    );
    const custom = documents
      .map(mapCategory)
      .filter((category) => category.kind === "custom");

    return [...system, ...custom].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.categoryId.localeCompare(right.categoryId),
    );
  }

  async findCategoryForActor(
    actor: Actor,
    categoryId: string,
  ): Promise<BudgetCategory | null> {
    budgetCategoryIdSchema.parse(categoryId);
    const systemIndex = systemBudgetCategoryKeys.findIndex(
      (key) => systemCategoryId(key) === categoryId,
    );
    const document = await this.categoryCollection.findOne({
      categoryId,
      userId: parseObjectId(actor.userId, "actor.userId"),
    });
    if (document !== null) {
      return mapCategory(document);
    }
    return systemIndex < 0
      ? null
      : defaultSystemCategory(systemBudgetCategoryKeys[systemIndex]!, systemIndex);
  }

  async createCustomCategoryForActor(
    actor: Actor,
    input: Readonly<{ label: string; rolloverPolicy: RolloverPolicy }>,
    idempotencyKey: string,
  ): Promise<BudgetCategory> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    if (
      (await this.categoryCollection.countDocuments(
        { kind: "custom", userId: actorUserId },
        { limit: 86 },
      )) >= 85
    ) {
      throw new ConflictError("The custom budget category limit was reached.");
    }
    const keyHash = sha256(idempotencyKey);
    const inputHash = payloadHash(input);
    const previous = await this.categoryCollection.findOne({
      idempotencyKeyHash: keyHash,
      userId: actorUserId,
    });
    if (previous !== null) {
      if (previous.idempotencyPayloadHash !== inputHash) {
        throw new ConflictError(
          "The idempotency key was already used for another category.",
        );
      }
      return mapCategory(previous);
    }
    const categoryObjectId = new ObjectId();
    const now = this.now();
    const categoryId = `custom:${categoryObjectId.toHexString()}`;
    const settings = {
      hidden: false,
      label: input.label,
      rolloverPolicy: input.rolloverPolicy,
      sortOrder:
        1_000 +
        (Number.parseInt(categoryObjectId.toHexString().slice(-4), 16) % 9_000),
    };
    const document: BudgetCategoryDocument = {
      _id: categoryObjectId,
      auditTrail: [
        {
          action: "created",
          actorUserId,
          after: categorySettings(settings),
          at: now,
          before: null,
          revision: 1,
        },
      ],
      categoryId,
      createdAt: now,
      ...settings,
      idempotencyKeyHash: keyHash,
      idempotencyPayloadHash: inputHash,
      kind: "custom",
      systemKey: null,
      updatedAt: now,
      userId: actorUserId,
      version: 1,
    };
    try {
      await this.categoryCollection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.categoryCollection.findOne({
          idempotencyKeyHash: keyHash,
          userId: actorUserId,
        });
        if (concurrent !== null && concurrent.idempotencyPayloadHash === inputHash) {
          return mapCategory(concurrent);
        }
      }
      throw error;
    }
    return mapCategory(document);
  }

  async updateCategoryForActor(
    actor: Actor,
    categoryId: string,
    expectedVersion: number,
    settings: Readonly<{
      hidden: boolean;
      label: string;
      rolloverPolicy: RolloverPolicy;
      sortOrder: number;
    }>,
  ): Promise<BudgetCategory> {
    budgetCategoryIdSchema.parse(categoryId);
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const existing = await this.categoryCollection.findOne({
      categoryId,
      userId: actorUserId,
    });
    const now = this.now();
    if (existing === null) {
      const key = systemBudgetCategoryKeys.find(
        (candidate) => systemCategoryId(candidate) === categoryId,
      );
      if (key === undefined || expectedVersion !== 0) {
        throw new ConflictError();
      }
      const document: BudgetCategoryDocument = {
        _id: new ObjectId(),
        auditTrail: [
          {
            action: "updated",
            actorUserId,
            after: categorySettings(settings),
            at: now,
            before: categorySettings(defaultSystemCategory(key, systemBudgetCategoryKeys.indexOf(key))),
            revision: 1,
          },
        ],
        categoryId,
        createdAt: now,
        ...settings,
        kind: "system",
        systemKey: key,
        updatedAt: now,
        userId: actorUserId,
        version: 1,
      };
      try {
        await this.categoryCollection.insertOne(document);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new ConflictError();
        }
        throw error;
      }
      return mapCategory(document);
    }
    if (existing.version !== expectedVersion) {
      throw new ConflictError();
    }
    const updated = await this.categoryCollection.findOneAndUpdate(
      {
        categoryId,
        userId: actorUserId,
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "updated",
            actorUserId,
            after: categorySettings(settings),
            at: now,
            before: categorySettings(existing),
            revision: expectedVersion + 1,
          },
        },
        $set: { ...settings, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (updated === null) {
      throw new ConflictError();
    }
    return mapCategory(updated);
  }

  async findPeriodForActor(
    actor: Actor,
    calendarMonth: string,
  ): Promise<BudgetPeriod | null> {
    calendarMonthSchema.parse(calendarMonth);
    const document = await this.periodCollection.findOne({
      calendarMonth,
      userId: parseObjectId(actor.userId, "actor.userId"),
    });
    return document === null ? null : mapPeriod(document);
  }

  async listPeriodsForActor(
    actor: Actor,
    maximumRecords = 240,
  ): Promise<readonly BudgetPeriod[]> {
    const documents = await this.periodCollection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ calendarMonth: 1, _id: 1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError(
        "The budget period export exceeds its bounded result set.",
      );
    }
    return documents.map(mapPeriod);
  }

  async savePeriodForActor(
    actor: Actor,
    input: Readonly<{
      allocations: readonly BudgetAllocation[];
      calendarMonth: string;
      carryIn: readonly BudgetAllocation[];
      currency: string;
      expectedVersion: number | null;
    }>,
  ): Promise<BudgetPeriod> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const now = this.now();
    const allocations = storeAllocations(input.allocations);
    const carryIn = storeAllocations(input.carryIn);
    if (input.expectedVersion === null) {
      const document: BudgetPeriodDocument = {
        _id: new ObjectId(),
        allocations,
        auditTrail: [
          {
            action: "created",
            actorUserId,
            allocationsAfter: allocations,
            allocationsBefore: null,
            at: now,
            revision: 1,
          },
        ],
        calendarMonth: calendarMonthSchema.parse(input.calendarMonth),
        carryIn,
        closedAt: null,
        closingSnapshot: null,
        createdAt: now,
        currency: input.currency,
        status: "open",
        updatedAt: now,
        userId: actorUserId,
        version: 1,
      };
      try {
        await this.periodCollection.insertOne(document);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new ConflictError();
        }
        throw error;
      }
      return mapPeriod(document);
    }
    const existing = await this.periodCollection.findOne({
      calendarMonth: input.calendarMonth,
      status: "open",
      userId: actorUserId,
      version: input.expectedVersion,
    });
    if (existing === null) {
      throw new ConflictError();
    }
    const updated = await this.periodCollection.findOneAndUpdate(
      {
        _id: existing._id,
        status: "open",
        userId: actorUserId,
        version: input.expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "updated",
            actorUserId,
            allocationsAfter: allocations,
            allocationsBefore: existing.allocations,
            at: now,
            revision: input.expectedVersion + 1,
          },
        },
        $set: { allocations, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (updated === null) {
      throw new ConflictError();
    }
    return mapPeriod(updated);
  }

  async closePeriodForActor(
    actor: Actor,
    calendarMonth: string,
    expectedVersion: number,
    calculation: BudgetCalculation,
  ): Promise<BudgetPeriod> {
    const storedCalculation = toStoredDomainValue(calculation);
    if (
      typeof storedCalculation !== "object" ||
      storedCalculation === null ||
      Array.isArray(storedCalculation)
    ) {
      throw new RangeError("Budget calculation must be an object.");
    }
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const now = this.now();
    const existing = await this.periodCollection.findOne({
      calendarMonth,
      status: "open",
      userId: actorUserId,
      version: expectedVersion,
    });
    if (existing === null) {
      throw new ConflictError();
    }
    const updated = await this.periodCollection.findOneAndUpdate(
      {
        _id: existing._id,
        status: "open",
        userId: actorUserId,
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: {
          auditTrail: {
            action: "closed",
            actorUserId,
            allocationsAfter: existing.allocations,
            allocationsBefore: existing.allocations,
            at: now,
            revision: expectedVersion + 1,
          },
        },
        $set: {
          closedAt: now,
          closingSnapshot: storedCalculation,
          status: "closed",
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (updated === null) {
      throw new ConflictError();
    }
    return mapPeriod(updated);
  }

  async createCorrectionForActor(
    actor: Actor,
    input: Readonly<{
      fromCategoryId: string | null;
      reason: string;
      toCategoryId: string;
      transactionId: string;
    }>,
    idempotencyKey: string,
  ): Promise<BudgetCorrection> {
    const actorUserId = parseObjectId(actor.userId, "actor.userId");
    const keyHash = sha256(idempotencyKey);
    const inputHash = payloadHash(input);
    const previous = await this.correctionCollection.findOne({
      idempotencyKeyHash: keyHash,
      userId: actorUserId,
    });
    if (previous !== null) {
      if (previous.idempotencyPayloadHash !== inputHash) {
        throw new ConflictError(
          "The idempotency key was already used for another correction.",
        );
      }
      return mapCorrection(previous);
    }
    const now = this.now();
    const document: BudgetCorrectionDocument = {
      _id: new ObjectId(),
      actorUserId,
      at: now,
      fromCategoryId: input.fromCategoryId,
      idempotencyKeyHash: keyHash,
      idempotencyPayloadHash: inputHash,
      reason: input.reason,
      toCategoryId: input.toCategoryId,
      transactionId: parseObjectId(input.transactionId, "transactionId"),
      userId: actorUserId,
    };
    try {
      await this.correctionCollection.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.correctionCollection.findOne({
          idempotencyKeyHash: keyHash,
          userId: actorUserId,
        });
        if (concurrent !== null && concurrent.idempotencyPayloadHash === inputHash) {
          return mapCorrection(concurrent);
        }
      }
      throw error;
    }
    return mapCorrection(document);
  }

  async listCorrectionsForActor(
    actor: Actor,
    transactionIds: readonly string[],
  ): Promise<readonly BudgetCorrection[]> {
    if (transactionIds.length === 0) {
      return [];
    }
    if (transactionIds.length > 10_000) {
      throw new DependencyUnavailableError(
        "The correction lookup exceeds its bounded source set.",
      );
    }
    const documents = await this.correctionCollection
      .find({
        transactionId: {
          $in: transactionIds.map((id) => parseObjectId(id, "transactionId")),
        },
        userId: parseObjectId(actor.userId, "actor.userId"),
      })
      .sort({ at: 1, _id: 1 })
      .limit(20_001)
      .toArray();
    if (documents.length > 20_000) {
      throw new DependencyUnavailableError(
        "The correction history exceeds its bounded result set.",
      );
    }
    return documents.map(mapCorrection);
  }

  async listAllCorrectionsForActor(
    actor: Actor,
    maximumRecords = 20_000,
  ): Promise<readonly BudgetCorrection[]> {
    const documents = await this.correctionCollection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ at: 1, _id: 1 })
      .limit(maximumRecords + 1)
      .toArray();
    if (documents.length > maximumRecords) {
      throw new DependencyUnavailableError(
        "The budget correction export exceeds its bounded result set.",
      );
    }
    return documents.map(mapCorrection);
  }
}

export function budgetRepositoryForDatabase(database: Db): BudgetRepository {
  return new BudgetRepository(
    database.collection<BudgetCategoryDocument>("budgetCategories"),
    database.collection<BudgetPeriodDocument>("budgetPeriods"),
    database.collection<BudgetCorrectionDocument>("budgetCategoryCorrections"),
  );
}

export async function getBudgetRepository(): Promise<BudgetRepository> {
  const repository = budgetRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
