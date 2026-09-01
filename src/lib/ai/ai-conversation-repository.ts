import "server-only";

import { ObjectId, type Collection, type Db, type Document } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import {
  aiEvidenceLabels,
  type AiConversation,
  type AiConversationMessage,
} from "@/lib/ai/ai";
import { getDatabase } from "@/lib/db/mongodb";
import { ConflictError, DependencyUnavailableError } from "@/lib/errors/application-error";

const MAX_MESSAGES = 24;

type AiConversationDocument = {
  _id: ObjectId;
  createdAt: Date;
  messages: Document[];
  schemaVersion: 1;
  title: string;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

const objectIdStringSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const evidenceValueSchema = z.discriminatedUnion("kind", [
  z.object({ amountMinor: z.string().regex(/^-?\d+$/), currency: z.string().regex(/^[A-Z]{3}$/), kind: z.literal("money") }),
  z.object({ kind: z.literal("basis_points"), value: z.string().regex(/^-?\d+$/) }),
  z.object({ kind: z.literal("calendar_date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ kind: z.literal("status"), value: z.string().min(1).max(100) }),
]);
const evidenceSchema = z.object({
  label: z.enum(aiEvidenceLabels),
  ref: z.string().min(1).max(80),
  value: evidenceValueSchema,
});
const responseItemSchema = z.object({
  evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(8),
  text: z.string().min(1).max(500),
});
const structuredResponseSchema = z.object({
  fact: z.array(responseItemSchema).min(1).max(5),
  insight: z.array(responseItemSchema).max(5),
  recommendation: z.array(responseItemSchema).max(5),
});
const sourceReferenceSchema = z.object({
  alias: z.string().min(1).max(80),
  kind: z.enum(["budget_period", "financial_engine_snapshot", "goal_progress", "purchase_simulation"]),
  sourceId: objectIdStringSchema,
  version: z.string().min(1).max(160),
});
const userMessageSchema = z.object({
  createdAt: z.date(),
  id: z.string().uuid(),
  role: z.literal("user"),
  text: z.string().min(1).max(1_000),
});
const assistantMessageSchema = z.object({
  createdAt: z.date(),
  evidence: z.array(evidenceSchema).max(32),
  focus: z.enum(["goal", "monthly", "purchase", "safe_to_spend"]),
  id: z.string().uuid(),
  model: z.string().min(1).max(100),
  provider: z.literal("anthropic"),
  response: structuredResponseSchema,
  role: z.literal("assistant"),
  sourceReferences: z.array(sourceReferenceSchema).min(1).max(4),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});
const messageSchema = z.discriminatedUnion("role", [userMessageSchema, assistantMessageSchema]);

function parseObjectId(value: string, field: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new RangeError(`${field} is invalid.`);
  return new ObjectId(value);
}

function messageDocument(message: AiConversationMessage): Document {
  return { ...message };
}

function mapDocument(document: AiConversationDocument): AiConversation {
  const messages = z.array(messageSchema).max(MAX_MESSAGES).safeParse(document.messages);
  if (!messages.success) {
    throw new DependencyUnavailableError("Stored AI conversation data is invalid.");
  }
  return {
    createdAt: document.createdAt,
    id: document._id.toHexString(),
    messages: messages.data,
    schemaVersion: document.schemaVersion,
    title: document.title,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

export class AiConversationRepository {
  constructor(
    private readonly collection: Collection<AiConversationDocument>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, updatedAt: -1, _id: -1 },
      { name: "ai_conversations_owner_updated" },
    );
    await this.collection.createIndex(
      { userId: 1, _id: 1, version: 1 },
      { name: "ai_conversations_owner_version" },
    );
  }

  async createForActor(
    actor: Actor,
    title: string,
    messages: readonly AiConversationMessage[],
  ): Promise<AiConversation> {
    if (messages.length !== 2 || messages[0]?.role !== "user" || messages[1]?.role !== "assistant") {
      throw new RangeError("A conversation must begin with one complete exchange.");
    }
    const now = this.now();
    const document: AiConversationDocument = {
      _id: new ObjectId(),
      createdAt: now,
      messages: messages.map(messageDocument),
      schemaVersion: 1,
      title,
      updatedAt: now,
      userId: parseObjectId(actor.userId, "actor.userId"),
      version: 1,
    };
    await this.collection.insertOne(document);
    return mapDocument(document);
  }

  async appendForActor(
    actor: Actor,
    conversationId: string,
    expectedVersion: number,
    messages: readonly AiConversationMessage[],
  ): Promise<AiConversation> {
    if (messages.length !== 2 || messages[0]?.role !== "user" || messages[1]?.role !== "assistant") {
      throw new RangeError("Only a complete exchange can be appended.");
    }
    const result = await this.collection.findOneAndUpdate(
      {
        _id: parseObjectId(conversationId, "conversationId"),
        "messages.22": { $exists: false },
        userId: parseObjectId(actor.userId, "actor.userId"),
        version: expectedVersion,
      },
      {
        $inc: { version: 1 },
        $push: { messages: { $each: messages.map(messageDocument) } },
        $set: { updatedAt: this.now() },
      },
      { returnDocument: "after" },
    );
    if (result === null) throw new ConflictError("The conversation changed or reached its message limit.");
    return mapDocument(result);
  }

  async findForActor(actor: Actor, conversationId: string): Promise<AiConversation | null> {
    const document = await this.collection.findOne({
      _id: parseObjectId(conversationId, "conversationId"),
      userId: parseObjectId(actor.userId, "actor.userId"),
    });
    return document === null ? null : mapDocument(document);
  }

  async listForActor(actor: Actor, limit: number): Promise<readonly AiConversation[]> {
    const documents = await this.collection
      .find({ userId: parseObjectId(actor.userId, "actor.userId") })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return documents.map(mapDocument);
  }

  async deleteForActor(
    actor: Actor,
    conversationId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: parseObjectId(conversationId, "conversationId"),
      userId: parseObjectId(actor.userId, "actor.userId"),
      version: expectedVersion,
    });
    return result.deletedCount === 1;
  }
}

export function aiConversationRepositoryForDatabase(
  database: Db,
  now?: () => Date,
): AiConversationRepository {
  return new AiConversationRepository(
    database.collection<AiConversationDocument>("aiConversations"),
    now,
  );
}

export async function getAiConversationRepository(): Promise<AiConversationRepository> {
  const repository = aiConversationRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
