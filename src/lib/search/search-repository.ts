import "server-only";

import { type Collection, type Db, ObjectId } from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import { SEARCH_INDEX_VERSION, type SearchIndexItem } from "@/lib/search/search";

type SearchDocument = {
  _id: ObjectId;
  domain: SearchIndexItem["domain"];
  indexedAt: Date;
  indexVersion: typeof SEARCH_INDEX_VERSION;
  searchText: string;
  sourceId: string;
  sourceUpdatedAt: string;
  sourceVersion: number;
  subtitle: string;
  title: string;
  tokens: string[];
  userId: ObjectId;
};

export type SearchCandidate = Readonly<SearchIndexItem & { id: string; indexedAt: Date }>;

export function normalizeSearchTokens(text: string): readonly string[] {
  const words = text.normalize("NFKC").toLocaleLowerCase("he-IL").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter((word) => word.length >= 2);
  const tokens = new Set<string>();
  for (const word of words) for (let length = 2; length <= Math.min(word.length, 32); length += 1) tokens.add(word.slice(0, length));
  return [...tokens].sort();
}

export class SearchRepository {
  constructor(private readonly collection: Collection<SearchDocument>, private readonly now: () => Date = () => new Date()) {}
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ userId: 1, domain: 1, sourceId: 1 }, { name: "search_owner_source", unique: true }),
      this.collection.createIndex({ userId: 1, tokens: 1, _id: 1 }, { name: "search_owner_tokens" }),
    ]);
  }
  async rebuildForActor(actor: Actor, items: readonly SearchIndexItem[]): Promise<void> {
    const userId = parseObjectId(actor.userId, "actor.userId");
    const indexedAt = this.now();
    await this.collection.deleteMany({ userId });
    if (items.length === 0) return;
    await this.collection.insertMany(items.map((item) => ({
      _id: new ObjectId(), ...item, indexedAt, indexVersion: SEARCH_INDEX_VERSION,
      searchText: item.searchText ?? "", tokens: [...normalizeSearchTokens(`${item.title} ${item.subtitle} ${item.searchText ?? ""}`)], userId,
    })), { ordered: false });
  }
  async queryForActor(actor: Actor, tokens: readonly string[], input: Readonly<{ afterId?: string | undefined; limit: number }>): Promise<readonly SearchCandidate[]> {
    const documents = await this.collection.find({
      ...(input.afterId === undefined ? {} : { _id: { $gt: parseObjectId(input.afterId, "cursor") } }),
      tokens: { $all: tokens }, userId: parseObjectId(actor.userId, "actor.userId"),
    }).sort({ _id: 1 }).limit(input.limit).toArray();
    return documents.map((document) => ({ domain: document.domain, id: document._id.toHexString(), indexedAt: document.indexedAt, sourceId: document.sourceId, sourceUpdatedAt: document.sourceUpdatedAt, sourceVersion: document.sourceVersion, subtitle: document.subtitle, title: document.title }));
  }
}

export function searchRepositoryForDatabase(database: Db, now?: () => Date): SearchRepository {
  return new SearchRepository(database.collection<SearchDocument>("authorizedSearchDocuments"), now);
}
export async function getSearchRepository(): Promise<SearchRepository> {
  const repository = searchRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
