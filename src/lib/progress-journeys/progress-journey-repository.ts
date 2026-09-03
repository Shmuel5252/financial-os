import "server-only";

import { type Collection, type Db, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import { ConflictError, DependencyUnavailableError } from "@/lib/errors/application-error";
import type { ProgressEventDraft } from "@/lib/domain/progress-journeys/progress-journey-engine";
import {
  PROGRESS_JOURNEY_ENGINE_VERSION,
  PROGRESS_JOURNEY_POLICY_VERSION,
  PROGRESS_JOURNEY_RULE_VERSION,
  progressDimensionSchema,
  progressEventKindSchema,
  progressOriginSchema,
  progressOutcomeSchema,
  progressPeriodSchema,
  progressSourceReferenceSchema,
  type ProgressJourneyEvent,
  type ProgressJourneyPreference,
  type UpdateProgressJourneyPreferencesCommand,
} from "@/lib/progress-journeys/progress-journey";

type ProgressJourneyEventDocument = {
  _id: ObjectId;
  auditTrail: readonly Readonly<{ action: "appended"; actorUserId: ObjectId; at: Date; revision: 1 }>[];
  createdAt: Date;
  dimension: ProgressJourneyEvent["dimension"];
  engineVersion: typeof PROGRESS_JOURNEY_ENGINE_VERSION;
  evaluationDate: string;
  eventKind: ProgressJourneyEvent["eventKind"];
  evidenceFingerprint: string;
  origin: ProgressJourneyEvent["origin"];
  outcome: ProgressJourneyEvent["outcome"];
  period: ProgressJourneyEvent["period"];
  policyVersion: typeof PROGRESS_JOURNEY_POLICY_VERSION;
  ruleId: string;
  ruleVersion: typeof PROGRESS_JOURNEY_RULE_VERSION;
  seriesKey: string;
  schemaVersion: 1;
  sourceReferences: ProgressJourneyEvent["sourceReferences"];
  stableKey: string;
  subjectLabel: string;
  supersedesId: ObjectId | null;
  userId: ObjectId;
  value: number | null;
};

type ProgressJourneyPreferenceDocument = {
  _id: ObjectId;
  auditTrail: Array<Readonly<{
    action: "created" | "updated";
    actorUserId: ObjectId;
    at: Date;
    changedFields: readonly string[];
    revision: number;
  }>>;
  celebrationsEnabled: boolean;
  createdAt: Date;
  progressNotificationsEnabled: boolean;
  schemaVersion: 1;
  streaksEnabled: boolean;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

const eventSchema = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  dimension: progressDimensionSchema,
  engineVersion: z.literal(PROGRESS_JOURNEY_ENGINE_VERSION),
  evaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventKind: progressEventKindSchema,
  evidenceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  origin: progressOriginSchema,
  outcome: progressOutcomeSchema,
  period: progressPeriodSchema,
  policyVersion: z.literal(PROGRESS_JOURNEY_POLICY_VERSION),
  ruleId: z.string().min(1).max(100),
  ruleVersion: z.literal(PROGRESS_JOURNEY_RULE_VERSION),
  seriesKey: z.string().regex(/^[0-9a-f]{64}$/),
  schemaVersion: z.literal(1),
  sourceReferences: z.array(progressSourceReferenceSchema).min(1).max(50),
  stableKey: z.string().regex(/^[0-9a-f]{64}$/),
  subjectLabel: z.string().min(1).max(200),
  supersedesId: z.instanceof(ObjectId).nullable(),
  value: z.number().int().min(0).max(10_000).nullable(),
});

function mapEvent(document: ProgressJourneyEventDocument): ProgressJourneyEvent {
  const parsed = eventSchema.safeParse(document);
  if (!parsed.success) throw new DependencyUnavailableError("Stored progress journey evidence is invalid.");
  return {
    createdAt: parsed.data.createdAt,
    dimension: parsed.data.dimension,
    engineVersion: parsed.data.engineVersion,
    evaluationDate: parsed.data.evaluationDate,
    eventKind: parsed.data.eventKind,
    evidenceFingerprint: parsed.data.evidenceFingerprint,
    id: parsed.data._id.toHexString(),
    origin: parsed.data.origin,
    outcome: parsed.data.outcome,
    period: parsed.data.period,
    policyVersion: parsed.data.policyVersion,
    ruleId: parsed.data.ruleId,
    ruleVersion: parsed.data.ruleVersion,
    seriesKey: parsed.data.seriesKey,
    sourceReferences: parsed.data.sourceReferences,
    stableKey: parsed.data.stableKey,
    subjectLabel: parsed.data.subjectLabel,
    supersedesId: parsed.data.supersedesId?.toHexString() ?? null,
    value: parsed.data.value,
  };
}

function mapPreference(document: ProgressJourneyPreferenceDocument): ProgressJourneyPreference {
  if (!(document.createdAt instanceof Date) || !(document.updatedAt instanceof Date) || !Number.isInteger(document.version) || document.version < 1) {
    throw new DependencyUnavailableError("Stored progress journey preferences are invalid.");
  }
  return {
    celebrationsEnabled: document.celebrationsEnabled,
    createdAt: document.createdAt,
    progressNotificationsEnabled: document.progressNotificationsEnabled,
    streaksEnabled: document.streaksEnabled,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

export class ProgressJourneyRepository {
  constructor(
    private readonly events: Collection<ProgressJourneyEventDocument>,
    private readonly preferences: Collection<ProgressJourneyPreferenceDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.events.createIndex({ userId: 1, evidenceFingerprint: 1 }, { name: "progress_events_owner_evidence", unique: true }),
      this.events.createIndex({ userId: 1, stableKey: 1, createdAt: -1, _id: -1 }, { name: "progress_events_owner_stable_history" }),
      this.events.createIndex({ userId: 1, seriesKey: 1, evaluationDate: -1, _id: -1 }, { name: "progress_events_owner_series" }),
      this.events.createIndex({ userId: 1, evaluationDate: -1, _id: -1 }, { name: "progress_events_owner_timeline" }),
      this.preferences.createIndex({ userId: 1 }, { name: "progress_preferences_owner", unique: true }),
    ]);
  }

  async listEventsForActor(actor: Actor, maximumRecords = 5_000): Promise<readonly ProgressJourneyEvent[]> {
    const documents = await this.events.find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ evaluationDate: -1, createdAt: -1, _id: -1 }).limit(maximumRecords + 1).toArray();
    if (documents.length > maximumRecords) throw new DependencyUnavailableError("The progress journey exceeds its bounded evidence set.");
    return documents.map(mapEvent);
  }

  async findLatestForStableKey(actor: Actor, stableKey: string): Promise<ProgressJourneyEvent | null> {
    const document = await this.events.findOne(
      { stableKey, userId: parseObjectId(actor.userId, "actor.userId") },
      { sort: { createdAt: -1, _id: -1 } },
    );
    return document === null ? null : mapEvent(document);
  }

  async appendForActor(actor: Actor, draft: ProgressEventDraft): Promise<ProgressJourneyEvent> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const existingEvidence = await this.events.findOne({ evidenceFingerprint: draft.evidenceFingerprint, userId });
    if (existingEvidence !== null) return mapEvent(existingEvidence);
    const previous = await this.events.findOne({ stableKey: draft.stableKey, userId }, { sort: { createdAt: -1, _id: -1 } });
    if (previous !== null && previous.evidenceFingerprint === draft.evidenceFingerprint) return mapEvent(previous);
    const createdAt = this.now();
    const document: ProgressJourneyEventDocument = {
      _id: new ObjectId(),
      auditTrail: [{ action: "appended", actorUserId: userId, at: createdAt, revision: 1 }],
      createdAt,
      ...draft,
      eventKind: previous === null ? draft.eventKind : "correction",
      schemaVersion: 1,
      supersedesId: previous?._id ?? null,
      userId,
    };
    try {
      await this.events.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.events.findOne({ evidenceFingerprint: draft.evidenceFingerprint, userId });
        if (concurrent !== null) return mapEvent(concurrent);
      }
      throw error;
    }
    return mapEvent(document);
  }

  async findPreferencesForActor(actor: Actor): Promise<ProgressJourneyPreference | null> {
    const document = await this.preferences.findOne({ userId: parseObjectId(actor.userId, "actor.userId") });
    return document === null ? null : mapPreference(document);
  }

  async savePreferencesForActor(actor: Actor, command: UpdateProgressJourneyPreferencesCommand): Promise<ProgressJourneyPreference> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const at = this.now();
    const fields = {
      celebrationsEnabled: command.celebrationsEnabled,
      progressNotificationsEnabled: command.progressNotificationsEnabled,
      streaksEnabled: command.streaksEnabled,
    };
    if (command.expectedVersion === null) {
      const document: ProgressJourneyPreferenceDocument = {
        _id: new ObjectId(),
        auditTrail: [{ action: "created", actorUserId: userId, at, changedFields: Object.keys(fields), revision: 1 }],
        ...fields,
        createdAt: at,
        schemaVersion: 1,
        updatedAt: at,
        userId,
        version: 1,
      };
      try { await this.preferences.insertOne(document); } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError("Progress preferences already exist.");
        throw error;
      }
      return mapPreference(document);
    }
    const changedFields = Object.keys(fields);
    const document = await this.preferences.findOneAndUpdate(
      { userId, version: command.expectedVersion },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: "updated", actorUserId: userId, at, changedFields, revision: command.expectedVersion + 1 } },
        $set: { ...fields, updatedAt: at },
      },
      { returnDocument: "after" },
    );
    if (document === null) throw new ConflictError("Progress preferences changed. Reload and try again.");
    return mapPreference(document);
  }
}

export function progressJourneyRepositoryForDatabase(database: Db, now?: () => Date): ProgressJourneyRepository {
  return new ProgressJourneyRepository(
    database.collection<ProgressJourneyEventDocument>("progressJourneyEvents"),
    database.collection<ProgressJourneyPreferenceDocument>("progressJourneyPreferences"),
    now,
  );
}

export async function getProgressJourneyRepository(): Promise<ProgressJourneyRepository> {
  const repository = progressJourneyRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
