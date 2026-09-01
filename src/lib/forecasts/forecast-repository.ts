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
  storedForecastResultSchema,
  storedForecastScenarioResultSchema,
  type ForecastScenario,
  type ForecastSnapshot,
} from "@/lib/forecasts/forecast";
import type {
  ForecastResult,
  ForecastScenarioResult,
} from "@/lib/domain/forecasts/forecast-engine";

type ForecastDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "calculated";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "forecast";
  }>[];
  calculatedAt: Date;
  idempotencyKeyHash: string;
  inputHash: string;
  intelligenceRunId: ObjectId | null;
  result: Document;
  schemaVersion: 1;
  sourceSnapshotId: ObjectId;
  userId: ObjectId;
};

type ForecastScenarioDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{
    action: "calculated";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: 1;
    source: "forecast_scenario";
  }>[];
  calculatedAt: Date;
  forecastId: ObjectId;
  idempotencyKeyHash: string;
  inputHash: string;
  name: string;
  note: string | null;
  result: Document;
  schemaVersion: 1;
  userId: ObjectId;
};

const forecastMetadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  calculatedAt: z.date(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  intelligenceRunId: z.instanceof(ObjectId).nullable(),
  schemaVersion: z.literal(1),
  sourceSnapshotId: z.instanceof(ObjectId),
});

const scenarioMetadataSchema = z.object({
  _id: z.instanceof(ObjectId),
  calculatedAt: z.date(),
  forecastId: z.instanceof(ObjectId),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().min(1).max(80),
  note: z.string().max(500).nullable(),
  schemaVersion: z.literal(1),
});

function documentValue(value: unknown, field: string): Document {
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

function mapForecast(document: ForecastDocument): ForecastSnapshot {
  const metadata = forecastMetadataSchema.safeParse(document);
  const result = storedForecastResultSchema.safeParse(
    fromStoredDomainValue(document.result),
  );
  if (!metadata.success || !result.success) {
    throw new DependencyUnavailableError("Stored forecast evidence is invalid.");
  }
  return {
    calculatedAt: metadata.data.calculatedAt,
    id: metadata.data._id.toHexString(),
    inputHash: metadata.data.inputHash,
    intelligenceRunId: metadata.data.intelligenceRunId?.toHexString() ?? null,
    result: result.data,
    schemaVersion: metadata.data.schemaVersion,
    sourceSnapshotId: metadata.data.sourceSnapshotId.toHexString(),
  };
}

function mapScenario(document: ForecastScenarioDocument): ForecastScenario {
  const metadata = scenarioMetadataSchema.safeParse(document);
  const result = storedForecastScenarioResultSchema.safeParse(
    fromStoredDomainValue(document.result),
  );
  if (!metadata.success || !result.success) {
    throw new DependencyUnavailableError("Stored forecast scenario is invalid.");
  }
  return {
    calculatedAt: metadata.data.calculatedAt,
    forecastId: metadata.data.forecastId.toHexString(),
    id: metadata.data._id.toHexString(),
    inputHash: metadata.data.inputHash,
    name: metadata.data.name,
    note: metadata.data.note,
    result: result.data,
    schemaVersion: metadata.data.schemaVersion,
  };
}

export class ForecastRepository {
  constructor(
    private readonly forecasts: Collection<ForecastDocument>,
    private readonly scenarios: Collection<ForecastScenarioDocument>,
    private readonly financialSnapshots: Collection<Document>,
    private readonly intelligenceRuns: Collection<Document>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.forecasts.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        { name: "forecasts_owner_idempotency", unique: true },
      ),
      this.forecasts.createIndex(
        { userId: 1, _id: -1 },
        { name: "forecasts_owner_page" },
      ),
      this.forecasts.createIndex(
        { userId: 1, sourceSnapshotId: 1, _id: -1 },
        { name: "forecasts_owner_source" },
      ),
      this.scenarios.createIndex(
        { userId: 1, idempotencyKeyHash: 1 },
        { name: "forecast_scenarios_owner_idempotency", unique: true },
      ),
      this.scenarios.createIndex(
        { userId: 1, forecastId: 1, _id: -1 },
        { name: "forecast_scenarios_owner_forecast" },
      ),
    ]);
  }

  async createForecastForActor(
    actor: Actor,
    result: ForecastResult,
    metadata: Readonly<{
      idempotencyKey: string;
      intelligenceRunId: string | null;
      sourceSnapshotId: string;
    }>,
  ): Promise<ForecastSnapshot> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const parsedResult = storedForecastResultSchema.parse(result);
    const sourceSnapshotId = parseObjectId(metadata.sourceSnapshotId, "sourceSnapshotId");
    const sourceExists = await this.financialSnapshots.countDocuments({
      _id: sourceSnapshotId,
      kind: "engine_result",
      userId,
    }, { limit: 1 });
    if (sourceExists !== 1) throw new ConflictError("The owned source snapshot is unavailable.");
    const intelligenceRunId = metadata.intelligenceRunId === null
      ? null : parseObjectId(metadata.intelligenceRunId, "intelligenceRunId");
    if (intelligenceRunId !== null) {
      const runExists = await this.intelligenceRuns.countDocuments({
        _id: intelligenceRunId,
        userId,
      }, { limit: 1 });
      if (runExists !== 1) throw new ConflictError("The owned intelligence evidence is unavailable.");
    }
    const inputHash = hashValue({
      intelligenceRunId: metadata.intelligenceRunId,
      result: parsedResult,
      sourceSnapshotId: metadata.sourceSnapshotId,
    });
    const idempotencyKeyHash = createHash("sha256").update(metadata.idempotencyKey).digest("hex");
    const previous = await this.forecasts.findOne({ idempotencyKeyHash, userId });
    if (previous !== null) {
      if (previous.inputHash !== inputHash) throw new ConflictError("The forecast idempotency key was reused for different evidence.");
      return mapForecast(previous);
    }
    const calculatedAt = this.now();
    const document: ForecastDocument = {
      _id: new ObjectId(),
      auditTrail: [{
        action: "calculated",
        actorUserId: userId,
        at: calculatedAt,
        changedFields: ["result", "sourceSnapshotId", "intelligenceRunId"],
        revision: 1,
        source: "forecast",
      }],
      calculatedAt,
      idempotencyKeyHash,
      inputHash,
      intelligenceRunId,
      result: documentValue(toStoredDomainValue(parsedResult), "result"),
      schemaVersion: 1,
      sourceSnapshotId,
      userId,
    };
    try {
      await this.forecasts.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.forecasts.findOne({ idempotencyKeyHash, userId });
        if (concurrent !== null && concurrent.inputHash === inputHash) return mapForecast(concurrent);
      }
      throw error;
    }
    return mapForecast(document);
  }

  async createScenarioForActor(
    actor: Actor,
    forecastIdInput: string,
    result: ForecastScenarioResult,
    metadata: Readonly<{ idempotencyKey: string; name: string; note: string | null }>,
  ): Promise<ForecastScenario> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const forecastId = parseObjectId(forecastIdInput, "forecastId");
    const ownedForecast = await this.forecasts.countDocuments({ _id: forecastId, userId }, { limit: 1 });
    if (ownedForecast !== 1) throw new ConflictError("The owned forecast is unavailable.");
    const parsedResult = storedForecastScenarioResultSchema.parse(result);
    const inputHash = hashValue({ forecastId: forecastIdInput, name: metadata.name, note: metadata.note, result: parsedResult });
    const idempotencyKeyHash = createHash("sha256").update(metadata.idempotencyKey).digest("hex");
    const previous = await this.scenarios.findOne({ idempotencyKeyHash, userId });
    if (previous !== null) {
      if (previous.inputHash !== inputHash) throw new ConflictError("The scenario idempotency key was reused for different evidence.");
      return mapScenario(previous);
    }
    const calculatedAt = this.now();
    const document: ForecastScenarioDocument = {
      _id: new ObjectId(),
      auditTrail: [{
        action: "calculated", actorUserId: userId, at: calculatedAt,
        changedFields: ["forecastId", "result", "name", "note"],
        revision: 1, source: "forecast_scenario",
      }],
      calculatedAt,
      forecastId,
      idempotencyKeyHash,
      inputHash,
      name: metadata.name,
      note: metadata.note,
      result: documentValue(toStoredDomainValue(parsedResult), "result"),
      schemaVersion: 1,
      userId,
    };
    try {
      await this.scenarios.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.scenarios.findOne({ idempotencyKeyHash, userId });
        if (concurrent !== null && concurrent.inputHash === inputHash) return mapScenario(concurrent);
      }
      throw error;
    }
    return mapScenario(document);
  }

  async findForecastForActor(actor: Actor, id: string): Promise<ForecastSnapshot | null> {
    const document = await this.forecasts.findOne({
      _id: parseObjectId(id, "forecastId"),
      userId: parseObjectId(actor.userId, "actor.userId"),
    });
    return document === null ? null : mapForecast(document);
  }

  async listForecastsForActor(actor: Actor, limit = 10): Promise<readonly ForecastSnapshot[]> {
    const documents = await this.forecasts.find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ _id: -1 }).limit(limit).toArray();
    return documents.map(mapForecast);
  }

  async listScenariosForActor(actor: Actor, limit = 20): Promise<readonly ForecastScenario[]> {
    const documents = await this.scenarios.find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ _id: -1 }).limit(limit).toArray();
    return documents.map(mapScenario);
  }
}

export function forecastRepositoryForDatabase(database: Db, now?: () => Date): ForecastRepository {
  return new ForecastRepository(
    database.collection<ForecastDocument>("forecastSnapshots"),
    database.collection<ForecastScenarioDocument>("forecastScenarios"),
    database.collection<Document>("financialSnapshots"),
    database.collection<Document>("transactionIntelligenceRuns"),
    now,
  );
}

export async function getForecastRepository(): Promise<ForecastRepository> {
  const repository = forecastRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
