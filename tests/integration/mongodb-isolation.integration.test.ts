import { randomUUID } from "node:crypto";

import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import {
  ownedDocumentFilter,
  userOwnershipFilter,
  type UserOwnedDocument,
} from "@/lib/data-access/ownership-filter";

type TestDocument = UserOwnedDocument &
  Readonly<{
    label: string;
  }>;

const testUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = testUri === undefined ? describe.skip : describe;

describeWithMongo("MongoDB ownership integration", () => {
  const databaseName = `${process.env.MONGODB_TEST_DB_NAME ?? "financial_os_integration"}_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(testUri ?? "mongodb://integration-test-not-configured");
  const firstUserId = new ObjectId();
  const secondUserId = new ObjectId();
  const firstActor: Actor = {
    kind: "user",
    userId: firstUserId.toHexString(),
  };

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.db(databaseName).dropDatabase();
    await client.close();
  });

  it("keeps same-shaped records isolated by the server-built ownership filter", async () => {
    const collection = client.db(databaseName).collection<TestDocument>("owned_records");
    const firstDocumentId = new ObjectId();
    const secondDocumentId = new ObjectId();

    await collection.insertMany([
      { _id: firstDocumentId, label: "first", userId: firstUserId },
      { _id: secondDocumentId, label: "second", userId: secondUserId },
    ]);

    const visible = await collection
      .find(userOwnershipFilter<TestDocument>(firstActor))
      .toArray();
    const forbidden = await collection.findOne(
      ownedDocumentFilter<TestDocument>(firstActor, secondDocumentId.toHexString()),
    );

    expect(visible).toHaveLength(1);
    expect(visible[0]?.label).toBe("first");
    expect(forbidden).toBeNull();
  });
});
