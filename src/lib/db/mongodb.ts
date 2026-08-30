import "server-only";

import { type Db, MongoClient } from "mongodb";

import { requireDatabaseEnv } from "@/lib/config/server-env";
import { DependencyUnavailableError } from "@/lib/errors/application-error";

declare global {
  var financialOsMongoClientPromise: Promise<MongoClient> | undefined;
}

let processClientPromise: Promise<MongoClient> | undefined;

function createClientPromise(): Promise<MongoClient> {
  const { uri } = requireDatabaseEnv();
  const client = new MongoClient(uri, {
    appName: "financial-os",
    maxPoolSize: 20,
    minPoolSize: 0,
    promoteLongs: false,
    serverSelectionTimeoutMS: 5_000,
  });

  return client.connect().catch((error: unknown) => {
    processClientPromise = undefined;
    globalThis.financialOsMongoClientPromise = undefined;
    throw new DependencyUnavailableError("MongoDB is unavailable.", error);
  });
}

export function getMongoClientPromise(): Promise<MongoClient> {
  if (process.env.NODE_ENV === "development") {
    globalThis.financialOsMongoClientPromise ??= createClientPromise();
    return globalThis.financialOsMongoClientPromise;
  }

  processClientPromise ??= createClientPromise();
  return processClientPromise;
}

export async function getDatabase(): Promise<Db> {
  const { databaseName } = requireDatabaseEnv();
  const client = await getMongoClientPromise();
  return client.db(databaseName);
}

export async function pingDatabase(): Promise<void> {
  const database = await getDatabase();
  await database.command({ ping: 1 });
}
