import { BSON } from "mongodb";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aiHistoryRecoveryFixture } from "../helpers/ai-history-recovery-fixture";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

describe.each(["aiConversations", "reportAiSummaries"] as const)("%s stored AI recovery", collection => {
  const row = () => { const fixture = aiHistoryRecoveryFixture(); return collection === "aiConversations" ? fixture.conversation : fixture.summary; };
  const project = (value: ReturnType<typeof row>) => initialRecoverySchemas[collection]?.project(value);
  it("preserves historical BSON/text and exact string money without provider generation", () => {
    const value = row(); const before = BSON.serialize(value);
    expect(project(value)).toEqual(value); expect(BSON.serialize(project(value)!)).toEqual(before);
    if (collection === "reportAiSummaries") { value.deletedAt = value.createdAt; expect(project(value)).toEqual(value); }
  });
  it("rejects unknown internal context and nested adapter fields rather than silently dropping them", () => {
    const value = row(); expect(() => project({ ...value, internalContext: "synthetic-private-marker" })).toThrow();
    const message = collection === "aiConversations" ? value.messages[1] : value;
    message.usage.unexpected = true; expect(() => project(value)).toThrow(); delete message.usage.unexpected;
    message.evidence[0].value.unexpected = true; expect(() => project(value)).toThrow();
  });
  it("rejects known secret-bearing fields and text with bounded errors", () => {
    const value = row(); const message = collection === "aiConversations" ? value.messages[1] : value;
    message.response.fact[0].text = "password=synthetic-not-real";
    expect(() => project(value)).toThrow("AI history recovery requires review");
    message.response.fact[0].text = "הסבר סינתטי"; message.usage.access_token = "synthetic-not-real";
    expect(() => project(value)).toThrow("AI history recovery requires review");
  });
  it("rejects dangling/duplicate evidence instead of attributing model prose to another fact", () => {
    const value = row(); const message = collection === "aiConversations" ? value.messages[1] : value;
    message.response.fact[0].evidenceRefs = ["missing"];
    expect(() => project(value)).toThrow(); message.response.fact[0].evidenceRefs = ["engine.fact"];
    message.evidence.push({ ...message.evidence[0] }); expect(() => project(value)).toThrow();
  });
  it("rejects known secret assignments in generated metadata as well as prose", () => {
    for (const field of ["model", "ref"] as const) {
      const value = row(); const message = collection === "aiConversations" ? value.messages[1] : value;
      if (field === "model") message.model = "password=synthetic-not-real";
      else { message.evidence[0].ref = "password=synthetic-not-real"; message.response.fact[0].evidenceRefs = [message.evidence[0].ref]; }
      expect(() => project(value)).toThrow("AI history recovery requires review");
    }
  });
});
it("requires complete unique message exchanges and consistent conversation version", () => {
  const { conversation } = aiHistoryRecoveryFixture(); const project = initialRecoverySchemas.aiConversations?.project;
  expect(() => project?.({ ...conversation, version: 2 })).toThrow();
  expect(() => project?.({ ...conversation, messages: [conversation.messages[0]] })).toThrow();
  expect(() => project?.({ ...conversation, messages: [...conversation.messages].reverse() })).toThrow();
  const next = conversation.messages.map((message: Record<string, unknown>) => ({ ...message, id: randomUUID() }));
  expect(project?.({ ...conversation, version: 2, messages: [...conversation.messages, ...next] })).toBeDefined();
  expect(() => project?.({ ...conversation, version: 2, messages: [...conversation.messages, ...conversation.messages] })).toThrow();
});
it("checks source alias/version assignments without treating numeric/hash evidence as a card", () => {
  const project = initialRecoverySchemas.aiConversations?.project;
  for (const field of ["alias", "version"] as const) {
    const { conversation } = aiHistoryRecoveryFixture();
    conversation.messages[1].sourceReferences[0][field] = "password=synthetic-not-real";
    expect(() => project?.(conversation)).toThrow("AI history recovery requires review");
  }
  const { conversation } = aiHistoryRecoveryFixture();
  conversation.messages[1].sourceReferences[0].version = `engine/9007199254740993/policy`;
  expect(project?.(conversation)).toEqual(conversation);
});
