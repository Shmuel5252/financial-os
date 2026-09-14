/** Synthetic/quarantined package assembly. No DB, filesystem, provider or release operation. */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { BSON, type Document } from "mongodb";
import { z } from "zod";
import { projectAuthLink, recoveryCollections, recoveryPlan, bsonIntegrity } from "@/lib/operations/recovery-plan";
import { encryptRecoveryBson, decryptRecoveryBson, type RecoveryEnvelope } from "@/lib/operations/recovery-envelope";

/** Trusted repository adapters only, never populated from a request or the artifact itself.
 * Returning a value certifies schema/field minimization; unknown schemas must throw.
 */
export type RecoverySchema = Readonly<{ version: string; project: (record: Document) => Document }>;
export type RecoverySchemas = Readonly<Partial<Record<string, RecoverySchema>>>;
const version = "synthetic-backup-package-v1";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({ collection: z.string(), schema: z.string().regex(/^[a-z0-9-]{1,64}$/), count: z.number().int().nonnegative(), digest: hash }).strict();
const manifestSchema = z.object({ version: z.literal(version), source: z.literal("isolated-synthetic"),
  indexManifestDigest: hash, inventory: z.array(z.string()), excluded: z.array(z.string()),
  entries: z.array(entrySchema), releaseAllowed: z.literal(false) }).strict();
type Manifest = z.infer<typeof manifestSchema>;
export type BackupPackage = Readonly<{ manifest: Manifest; signature: string; parts: readonly RecoveryEnvelope[] }>;
type Key = Readonly<{ version: number; material: Uint8Array }>;
const excluded: readonly string[] = recoveryPlan(recoveryCollections).collections.filter(c => c.action === "exclude" || c.action === "rebuild").map(c => c.name);
const authSchema: RecoverySchema = { version: "auth-link-v1", project: projectAuthLink };
function fail(): never { throw new Error("Backup package validation failed"); }
function signature(manifest: Manifest, key: Key): string {
  if (key.material.length !== 32 || !Number.isSafeInteger(key.version) || key.version < 1) return fail();
  return createHmac("sha256", key.material).update(JSON.stringify([version, "manifest", key.version, manifest])).digest("hex");
}
function adapter(name: string, schemas: RecoverySchemas): RecoverySchema | undefined {
  return name === "authAccounts" ? authSchema : schemas[name];
}
function validateRegistry(schemas: RecoverySchemas) {
  for (const name of Object.keys(schemas)) if (!recoveryCollections.includes(name) || excluded.includes(name) || name === "authAccounts") return fail();
}
export function createBackupPackage(records: Readonly<Record<string, readonly Document[]>>, schemas: RecoverySchemas,
  indexManifestDigest: string, key: Key): BackupPackage {
  try {
    validateRegistry(schemas);
    const names = Object.keys(records);
    // Complete declared inventory, even absent/empty collections, prevents accidental omitted classes.
    if (names.length !== recoveryCollections.length || names.some(n => !recoveryCollections.includes(n))) return fail();
    const parts: RecoveryEnvelope[] = []; const entries: Manifest["entries"] = [];
    for (const name of recoveryCollections) {
      const rows = records[name]; if (!Array.isArray(rows)) return fail();
      if (excluded.includes(name)) continue;
      const schema = adapter(name, schemas);
      // A known collection is NOT sufficient evidence its fields are safe. No raw-copy fallback.
      if (rows.length && !schema) return fail();
      const projected = rows.map(row => schema!.project(row));
      const bson = BSON.serialize({ records: projected });
      const part = encryptRecoveryBson(bson, name, indexManifestDigest, key);
      parts.push(part); entries.push({ collection: name, schema: schema?.version ?? "empty-unreviewed-v1", count: projected.length, digest: part.header.digest });
    }
    const manifest = manifestSchema.parse({ version, source: "isolated-synthetic", indexManifestDigest,
      inventory: [...recoveryCollections], excluded, entries, releaseAllowed: false });
    return { manifest, parts, signature: signature(manifest, key) };
  } catch { return fail(); }
}

/** Verifies all parts before returning any records. Caller must apply CURRENT ledger and remain quarantined.
 * No callback invoked for credentials/excluded collections; the auth projector cannot be overridden.
 */
export function openBackupPackage(input: BackupPackage, schemas: RecoverySchemas, indexManifestDigest: string, key: Key): Readonly<Record<string, readonly Document[]>> {
  try {
    validateRegistry(schemas);
    if (Object.keys(input).sort().join(",") !== "manifest,parts,signature") return fail();
    const parsed = manifestSchema.safeParse(input.manifest); if (!parsed.success || !hash.safeParse(input.signature).success) return fail();
    const manifest = parsed.data;
    if (manifest.indexManifestDigest !== indexManifestDigest || JSON.stringify(manifest.inventory) !== JSON.stringify(recoveryCollections)
      || JSON.stringify(manifest.excluded) !== JSON.stringify(excluded)
      || manifest.entries.length !== recoveryCollections.length - excluded.length
      || input.parts.length !== manifest.entries.length
      || !timingSafeEqual(Buffer.from(signature(manifest, key), "hex"), Buffer.from(input.signature, "hex"))) return fail();
    const result: Record<string, readonly Document[]> = {};
    const included = recoveryCollections.filter(n => !excluded.includes(n));
    for (let i = 0; i < manifest.entries.length; i++) {
      const entry = manifest.entries[i]!; const part = input.parts[i]!;
      if (entry.collection !== included[i] || part.header.collection !== entry.collection || part.header.digest !== entry.digest) return fail();
      const schema = adapter(entry.collection, schemas);
      if (entry.schema !== (schema?.version ?? "empty-unreviewed-v1") || (entry.count > 0 && !schema)) return fail();
      const bytes = decryptRecoveryBson(part, indexManifestDigest, key);
      const decoded = BSON.deserialize(bytes, { promoteLongs: false });
      if (Object.keys(decoded).join(",") !== "records" || !Array.isArray(decoded.records) || decoded.records.length !== entry.count) return fail();
      const records = decoded.records as Document[];
      // Revalidate/minimize with the trusted current adapter; no silent repair or schema drift at restore.
      const reprojected = BSON.serialize({ records: records.map(row => schema!.project(row)) });
      if (bsonIntegrity(reprojected) !== entry.digest) return fail();
      result[entry.collection] = records;
    }
    return result;
  } catch { return fail(); }
}
