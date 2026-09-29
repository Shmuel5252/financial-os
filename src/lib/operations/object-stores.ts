/** BackupObjectStore implementations. Object names are content-addressed (`…-<sha256 prefix>.bson`) under three fixed prefixes,
 * so "already exists" on a write-once store means "already stored" and never needs read or delete permission.
 */
import "server-only";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BackupObjectStore } from "@/lib/operations/backup-capture";

const objectName = /^(packages|ledger-mirror|ledger-journal)\/[0-9]{1,20}-[a-f0-9]{16}\.bson$/;
const prefixes = new Set(["packages/", "ledger-mirror/", "ledger-journal/"]);
const fail = (reason: string): never => { throw new Error(`Object store refused: ${reason}`); };
const checkName = (name: string) => { if (!objectName.test(name)) fail("unexpected object name"); };
const checkPrefix = (prefix: string) => { if (!prefixes.has(prefix)) fail("unexpected prefix"); };

/** The subset of S3 the stores use; the Lambda entry adapts the runtime-provided AWS SDK to it. */
export type S3Client = Readonly<{
  /** Conditional create (`If-None-Match: *`): "created", or "exists" on HTTP 412; "conflict" on HTTP 409 (retryable). */
  putIfAbsent: (input: Readonly<{ key: string; body: Uint8Array }>) => Promise<"created" | "exists" | "conflict">;
  get: (key: string) => Promise<Uint8Array | null>;
  list: (input: Readonly<{ prefix: string; continuationToken?: string }>) => Promise<Readonly<{ keys: readonly string[]; nextToken?: string }>>;
}>;

export function s3ObjectStore(client: S3Client): BackupObjectStore {
  return {
    async putOnce(name, bytes) {
      checkName(name);
      // One retry after a 409 (a concurrent delete marker race), as S3 documents for conditional PutObject.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await client.putIfAbsent({ key: name, body: bytes });
        if (result !== "conflict") return;
      }
      fail("write conflict");
    },
    async get(name) { checkName(name); return client.get(name); },
    async list(prefix) {
      checkPrefix(prefix);
      const keys: string[] = []; let token: string | undefined;
      for (let page = 0; page < 10_000; page++) {
        const result = await client.list(token === undefined ? { prefix } : { prefix, continuationToken: token });
        for (const key of result.keys) { checkName(key); keys.push(key); }
        if (result.nextToken === undefined) return keys.sort();
        token = result.nextToken;
      }
      return fail("listing too long");
    },
  };
}

/** A local copy is only as good as its completeness: a truncated `aws s3 sync` would hide the newest mirrors and journal writes.
 * This view refuses to list a prefix unless the local names equal the authoritative bucket listing exactly (the JSON of
 * `aws s3api list-objects-v2 --bucket <bucket> --output json`, taken right after the sync; ListObjectsV2 is strongly consistent). */
export function listedDirectoryObjectStore(root: string, listingJson: string): BackupObjectStore {
  let keys: string[];
  try {
    const listing = JSON.parse(listingJson) as { Contents?: { Key?: unknown }[] };
    keys = (listing.Contents ?? []).map(item => (typeof item.Key === "string" ? item.Key : fail("listing unreadable")));
  } catch { return fail("listing unreadable"); }
  const local = directoryObjectStore(root);
  return {
    putOnce: async () => fail("read-only copy"),
    get: local.get,
    async list(prefix) {
      const names = await local.list(prefix);
      const listed = keys.filter(key => key.startsWith(prefix)).sort();
      if (listed.length !== names.length || listed.some((key, index) => key !== names[index])) fail("local copy incomplete");
      return names;
    },
  };
}

/** Local copy of the bucket for the offline restore drill (e.g. after `aws s3 sync`). Writes are create-only. */
export function directoryObjectStore(root: string): BackupObjectStore {
  const path = (name: string) => { checkName(name); const [prefix, file] = name.split("/"); return join(root, prefix!, file!); };
  return {
    async putOnce(name, bytes) {
      const target = path(name); await mkdir(join(target, ".."), { recursive: true });
      try { await writeFile(target, bytes, { flag: "wx" }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Buffer.compare(await readFile(target), Buffer.from(bytes)) !== 0) fail("object is locked");
      }
    },
    async get(name) {
      try { return Uint8Array.from(await readFile(path(name))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async list(prefix) {
      checkPrefix(prefix);
      let files: string[];
      try { files = await readdir(join(root, prefix.slice(0, -1))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      const names = files.map(file => `${prefix}${file}`);
      for (const name of names) checkName(name);
      return names.sort();
    },
  };
}
