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
import { getDatabase } from "@/lib/db/mongodb";
import {
  fromStoredMoney,
  toStoredMoney,
  type StoredMoney,
} from "@/lib/db/money-mapper";
import {
  ConflictError,
  DependencyUnavailableError,
} from "@/lib/errors/application-error";
import {
  transactionIntelligenceExplanationCodeSchema,
  transactionIntelligenceReviewDecisionSchema,
  transactionIntelligenceSignalKindSchema,
  type TransactionIntelligenceCalculation,
  type TransactionIntelligenceMerchantGroup,
  type TransactionIntelligenceReview,
  type TransactionIntelligenceReviewDecision,
  type TransactionIntelligenceRun,
  type TransactionIntelligenceSignal,
} from "@/lib/transaction-intelligence/transaction-intelligence";

type StoredEvidence = {
  amount: StoredMoney;
  confirmedCategoryId: string | null;
  date: string;
  normalizedMerchant: string | null;
  rawMerchant: string | null;
  transactionId: ObjectId;
};

type StoredSignal = {
  amount: StoredMoney;
  baselineAmount: StoredMoney | null;
  confidenceBps: number;
  evidence: StoredEvidence[];
  explanationCode: string;
  id: string;
  kind: string;
  normalizedMerchant: string | null;
  periodDays: number | null;
  suggestedCategoryId: string | null;
  transactionId: ObjectId;
};

type StoredMerchantGroup = {
  latestRawMerchant: string;
  normalizedMerchant: string;
  occurrenceCount: number;
  transactionIds: ObjectId[];
};

type TransactionIntelligenceRunDocument = {
  _id: ObjectId;
  analyzedThroughDate: string | null;
  audit: Document;
  createdAt: Date;
  engineVersion: string;
  idempotencyKeyHash: string;
  idempotencyPayloadHash: string;
  inputCount: number;
  inputHash: string;
  merchantGroups: StoredMerchantGroup[];
  omittedLowConfidenceCount: number;
  policyVersion: string;
  reviewThresholdBps: number;
  rulesetVersion: string;
  schemaVersion: 1;
  signals: StoredSignal[];
  truncatedSignalCount: number;
  userId: ObjectId;
};

type TransactionIntelligenceReviewDocument = {
  _id: ObjectId;
  at: Date;
  audit: Document;
  categoryCorrectionId: ObjectId | null;
  decision: string;
  idempotencyKeyHash: string;
  idempotencyPayloadHash: string;
  runId: ObjectId;
  schemaVersion: 1;
  sequence: number;
  signalId: string;
  userId: ObjectId;
};

function objectId(value: string, field: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new RangeError(`${field} is invalid.`);
  }
  return new ObjectId(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runHashes(idempotencyKey: string, inputHash: string) {
  return {
    keyHash: digest(idempotencyKey),
    payloadHash: digest(`phase10-run|${inputHash}`),
  };
}

function reviewHashes(
  idempotencyKey: string,
  input: Readonly<{
    categoryCorrectionId: string | null;
    decision: string;
    runId: string;
    signalId: string;
  }>,
) {
  return {
    keyHash: digest(idempotencyKey),
    payloadHash: digest(
      JSON.stringify({
        categoryCorrectionId: input.categoryCorrectionId,
        decision: input.decision,
        runId: input.runId,
        signalId: input.signalId,
      }),
    ),
  };
}

function toStoredSignal(signal: TransactionIntelligenceSignal): StoredSignal {
  return {
    amount: toStoredMoney(signal.amount),
    baselineAmount:
      signal.baselineAmount === null
        ? null
        : toStoredMoney(signal.baselineAmount),
    confidenceBps: signal.confidenceBps,
    evidence: signal.evidence.map((item) => ({
      amount: toStoredMoney(item.amount),
      confirmedCategoryId: item.confirmedCategoryId,
      date: item.date,
      normalizedMerchant: item.normalizedMerchant,
      rawMerchant: item.rawMerchant,
      transactionId: objectId(item.transactionId, "evidence.transactionId"),
    })),
    explanationCode: signal.explanationCode,
    id: signal.id,
    kind: signal.kind,
    normalizedMerchant: signal.normalizedMerchant,
    periodDays: signal.periodDays,
    suggestedCategoryId: signal.suggestedCategoryId,
    transactionId: objectId(signal.transactionId, "signal.transactionId"),
  };
}

function fromStoredSignal(signal: StoredSignal): TransactionIntelligenceSignal {
  const kind = transactionIntelligenceSignalKindSchema.safeParse(signal.kind);
  const explanation = transactionIntelligenceExplanationCodeSchema.safeParse(
    signal.explanationCode,
  );
  if (
    !kind.success ||
    !explanation.success ||
    !/^[0-9a-f]{32}$/.test(signal.id) ||
    !Number.isInteger(signal.confidenceBps) ||
    signal.confidenceBps < 0 ||
    signal.confidenceBps > 10_000 ||
    !(signal.transactionId instanceof ObjectId) ||
    !Array.isArray(signal.evidence)
  ) {
    throw new DependencyUnavailableError(
      "Stored transaction intelligence signal is invalid.",
    );
  }
  return {
    amount: fromStoredMoney(signal.amount),
    baselineAmount:
      signal.baselineAmount === null
        ? null
        : fromStoredMoney(signal.baselineAmount),
    confidenceBps: signal.confidenceBps,
    evidence: signal.evidence.map((item) => {
      if (!(item.transactionId instanceof ObjectId)) {
        throw new DependencyUnavailableError(
          "Stored transaction intelligence evidence is invalid.",
        );
      }
      return {
        amount: fromStoredMoney(item.amount),
        confirmedCategoryId: item.confirmedCategoryId,
        date: item.date,
        normalizedMerchant: item.normalizedMerchant,
        rawMerchant: item.rawMerchant,
        transactionId: item.transactionId.toHexString(),
      };
    }),
    explanationCode: explanation.data,
    id: signal.id,
    kind: kind.data,
    normalizedMerchant: signal.normalizedMerchant,
    periodDays: signal.periodDays,
    suggestedCategoryId: signal.suggestedCategoryId,
    transactionId: signal.transactionId.toHexString(),
  };
}

function mapMerchantGroup(group: StoredMerchantGroup): TransactionIntelligenceMerchantGroup {
  if (
    !Array.isArray(group.transactionIds) ||
    group.transactionIds.some((id) => !(id instanceof ObjectId))
  ) {
    throw new DependencyUnavailableError(
      "Stored transaction intelligence merchant evidence is invalid.",
    );
  }
  return {
    latestRawMerchant: group.latestRawMerchant,
    normalizedMerchant: group.normalizedMerchant,
    occurrenceCount: group.occurrenceCount,
    transactionIds: group.transactionIds.map((id) => id.toHexString()),
  };
}

function mapRun(document: TransactionIntelligenceRunDocument): TransactionIntelligenceRun {
  if (
    document.schemaVersion !== 1 ||
    !(document._id instanceof ObjectId) ||
    !(document.createdAt instanceof Date) ||
    !Array.isArray(document.signals) ||
    !Array.isArray(document.merchantGroups)
  ) {
    throw new DependencyUnavailableError(
      "Stored transaction intelligence run is invalid.",
    );
  }
  return {
    analyzedThroughDate: document.analyzedThroughDate,
    createdAt: document.createdAt,
    engineVersion: document.engineVersion,
    id: document._id.toHexString(),
    inputCount: document.inputCount,
    inputHash: document.inputHash,
    merchantGroups: document.merchantGroups.map(mapMerchantGroup),
    omittedLowConfidenceCount: document.omittedLowConfidenceCount,
    policyVersion: document.policyVersion,
    reviewThresholdBps: document.reviewThresholdBps,
    rulesetVersion: document.rulesetVersion,
    signals: document.signals.map(fromStoredSignal),
    truncatedSignalCount: document.truncatedSignalCount,
  };
}

function mapReview(
  document: TransactionIntelligenceReviewDocument,
): TransactionIntelligenceReview {
  const decision = transactionIntelligenceReviewDecisionSchema.safeParse(
    document.decision,
  );
  if (
    !decision.success ||
    !(document._id instanceof ObjectId) ||
    !(document.runId instanceof ObjectId) ||
    !(document.at instanceof Date) ||
    !Number.isInteger(document.sequence) ||
    document.sequence < 1
  ) {
    throw new DependencyUnavailableError(
      "Stored transaction intelligence review is invalid.",
    );
  }
  return {
    at: document.at,
    categoryCorrectionId: document.categoryCorrectionId?.toHexString() ?? null,
    decision: decision.data,
    id: document._id.toHexString(),
    runId: document.runId.toHexString(),
    sequence: document.sequence,
    signalId: document.signalId,
  };
}

export class TransactionIntelligenceRepository {
  constructor(
    private readonly runs: Collection<TransactionIntelligenceRunDocument>,
    private readonly reviews: Collection<TransactionIntelligenceReviewDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.runs.createIndex(
        { userId: 1, createdAt: -1, _id: -1 },
        { name: "transaction_intelligence_runs_owner_created" },
      ),
      this.runs.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        {
          name: "transaction_intelligence_runs_owner_idempotency",
          unique: true,
        },
      ),
      this.reviews.createIndex(
        { userId: 1, runId: 1, signalId: 1, sequence: 1 },
        {
          name: "transaction_intelligence_reviews_owner_signal_sequence",
          unique: true,
        },
      ),
      this.reviews.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        {
          name: "transaction_intelligence_reviews_owner_idempotency",
          unique: true,
        },
      ),
    ]);
  }

  async createRunForActor(
    actor: Actor,
    calculation: TransactionIntelligenceCalculation,
    metadata: Readonly<{
      engineVersion: string;
      inputHash: string;
      policyVersion: string;
      reviewThresholdBps: number;
      rulesetVersion: string;
    }>,
    idempotencyKey: string,
  ): Promise<TransactionIntelligenceRun> {
    const userId = objectId(actor.userId, "actor.userId");
    const hashes = runHashes(idempotencyKey, metadata.inputHash);
    const existing = await this.runs.findOne({
      idempotencyKeyHash: hashes.keyHash,
      userId,
    });
    if (existing !== null) {
      if (existing.idempotencyPayloadHash !== hashes.payloadHash) {
        throw new ConflictError(
          "The analysis idempotency key was reused after source data changed.",
        );
      }
      return mapRun(existing);
    }
    const createdAt = this.now();
    const document: TransactionIntelligenceRunDocument = {
      _id: new ObjectId(),
      analyzedThroughDate: calculation.analyzedThroughDate,
      audit: {
        action: "transaction_intelligence_analyzed",
        actorId: userId,
        at: createdAt,
        changedFields: ["signals", "merchantGroups"],
        source: "deterministic_rules",
      },
      createdAt,
      engineVersion: metadata.engineVersion,
      idempotencyKeyHash: hashes.keyHash,
      idempotencyPayloadHash: hashes.payloadHash,
      inputCount: calculation.inputCount,
      inputHash: metadata.inputHash,
      merchantGroups: calculation.merchantGroups.map((group) => ({
        latestRawMerchant: group.latestRawMerchant,
        normalizedMerchant: group.normalizedMerchant,
        occurrenceCount: group.occurrenceCount,
        transactionIds: group.transactionIds.map((id) =>
          objectId(id, "merchantGroup.transactionId"),
        ),
      })),
      omittedLowConfidenceCount: calculation.omittedLowConfidenceCount,
      policyVersion: metadata.policyVersion,
      reviewThresholdBps: metadata.reviewThresholdBps,
      rulesetVersion: metadata.rulesetVersion,
      schemaVersion: 1,
      signals: calculation.signals.map(toStoredSignal),
      truncatedSignalCount: calculation.truncatedSignalCount,
      userId,
    };
    try {
      await this.runs.insertOne(document);
      return mapRun(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.runs.findOne({
          idempotencyKeyHash: hashes.keyHash,
          userId,
        });
        if (
          concurrent !== null &&
          concurrent.idempotencyPayloadHash === hashes.payloadHash
        ) {
          return mapRun(concurrent);
        }
        throw new ConflictError(
          "The analysis idempotency key was reused after source data changed.",
        );
      }
      throw error;
    }
  }

  async latestRunForActor(actor: Actor): Promise<TransactionIntelligenceRun | null> {
    const document = await this.runs.findOne(
      { userId: objectId(actor.userId, "actor.userId") },
      { sort: { createdAt: -1, _id: -1 } },
    );
    return document === null ? null : mapRun(document);
  }

  async listAllRunsForActor(
    actor: Actor,
    maximumRuns = 100,
  ): Promise<readonly TransactionIntelligenceRun[]> {
    const documents = await this.runs
      .find({ userId: objectId(actor.userId, "actor.userId") })
      .sort({ createdAt: 1, _id: 1 })
      .limit(maximumRuns + 1)
      .toArray();
    if (documents.length > maximumRuns) {
      throw new DependencyUnavailableError(
        "The owned transaction intelligence export is too large.",
      );
    }
    return documents.map(mapRun);
  }

  async findRunForActor(
    actor: Actor,
    runId: string,
  ): Promise<TransactionIntelligenceRun | null> {
    const document = await this.runs.findOne({
      _id: objectId(runId, "runId"),
      userId: objectId(actor.userId, "actor.userId"),
    });
    return document === null ? null : mapRun(document);
  }

  async listReviewsForActor(
    actor: Actor,
    runId: string,
  ): Promise<readonly TransactionIntelligenceReview[]> {
    const documents = await this.reviews
      .find({
        runId: objectId(runId, "runId"),
        userId: objectId(actor.userId, "actor.userId"),
      })
      .sort({ sequence: 1, _id: 1 })
      .limit(1_000)
      .toArray();
    return documents.map(mapReview);
  }

  async listAllReviewsForActor(
    actor: Actor,
    maximumReviews = 1_000,
  ): Promise<readonly TransactionIntelligenceReview[]> {
    const documents = await this.reviews
      .find({ userId: objectId(actor.userId, "actor.userId") })
      .sort({ at: 1, _id: 1 })
      .limit(maximumReviews + 1)
      .toArray();
    if (documents.length > maximumReviews) {
      throw new DependencyUnavailableError(
        "The owned transaction intelligence review export is too large.",
      );
    }
    return documents.map(mapReview);
  }

  async latestReviewDecisionsForActor(
    actor: Actor,
  ): Promise<ReadonlyMap<string, TransactionIntelligenceReviewDecision>> {
    const documents = await this.reviews.aggregate<{
      _id: string;
      decision: string;
    }>([
      { $match: { userId: objectId(actor.userId, "actor.userId") } },
      { $sort: { at: 1, _id: 1 } },
      { $group: { _id: "$signalId", decision: { $last: "$decision" } } },
    ]).toArray();
    return new Map(documents.map((document) => [
      document._id,
      transactionIntelligenceReviewDecisionSchema.parse(document.decision),
    ]));
  }

  async findReviewByIdempotencyForActor(
    actor: Actor,
    idempotencyKey: string,
  ): Promise<TransactionIntelligenceReview | null> {
    const document = await this.reviews.findOne({
      idempotencyKeyHash: digest(idempotencyKey),
      userId: objectId(actor.userId, "actor.userId"),
    });
    return document === null ? null : mapReview(document);
  }

  async createReviewForActor(
    actor: Actor,
    input: Readonly<{
      categoryCorrectionId: string | null;
      decision: TransactionIntelligenceReview["decision"];
      runId: string;
      sequence: number;
      signalId: string;
    }>,
    idempotencyKey: string,
  ): Promise<TransactionIntelligenceReview> {
    const userId = objectId(actor.userId, "actor.userId");
    const hashes = reviewHashes(idempotencyKey, input);
    const existing = await this.reviews.findOne({
      idempotencyKeyHash: hashes.keyHash,
      userId,
    });
    if (existing !== null) {
      if (existing.idempotencyPayloadHash !== hashes.payloadHash) {
        throw new ConflictError(
          "The review idempotency key was already used for another decision.",
        );
      }
      return mapReview(existing);
    }
    const at = this.now();
    const document: TransactionIntelligenceReviewDocument = {
      _id: new ObjectId(),
      at,
      audit: {
        action: "transaction_intelligence_reviewed",
        actorId: userId,
        at,
        changedFields: ["decision"],
        source: "user",
      },
      categoryCorrectionId:
        input.categoryCorrectionId === null
          ? null
          : objectId(input.categoryCorrectionId, "categoryCorrectionId"),
      decision: input.decision,
      idempotencyKeyHash: hashes.keyHash,
      idempotencyPayloadHash: hashes.payloadHash,
      runId: objectId(input.runId, "runId"),
      schemaVersion: 1,
      sequence: input.sequence,
      signalId: input.signalId,
      userId,
    };
    try {
      await this.reviews.insertOne(document);
      return mapReview(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.reviews.findOne({
          idempotencyKeyHash: hashes.keyHash,
          userId,
        });
        if (
          concurrent !== null &&
          concurrent.idempotencyPayloadHash === hashes.payloadHash
        ) {
          return mapReview(concurrent);
        }
        throw new ConflictError(
          "The signal review changed; reload before trying again.",
        );
      }
      throw error;
    }
  }
}

export function transactionIntelligenceRepositoryForDatabase(
  database: Db,
  now?: () => Date,
): TransactionIntelligenceRepository {
  return new TransactionIntelligenceRepository(
    database.collection<TransactionIntelligenceRunDocument>(
      "transactionIntelligenceRuns",
    ),
    database.collection<TransactionIntelligenceReviewDocument>(
      "transactionIntelligenceReviews",
    ),
    now,
  );
}

export async function getTransactionIntelligenceRepository(): Promise<TransactionIntelligenceRepository> {
  const repository = transactionIntelligenceRepositoryForDatabase(
    await getDatabase(),
  );
  await repository.ensureIndexes();
  return repository;
}
