/** Authenticated encryption for ALREADY FILTERED BSON. Not a database exporter or restore executor. */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BSON } from "mongodb";
import { z } from "zod";
import { bsonIntegrity, recoveryCollections } from "@/lib/operations/recovery-plan";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const version = "financial-recovery-envelope-v1";
const maximumBytes = 16 * 1024 * 1024;
const headerSchema = z.object({
  version: z.literal(version), schemaVersion: z.literal(1),
  keyVersion: z.number().int().positive(),
  source: z.literal("isolated-synthetic"),
  collection: z.enum(recoveryCollections as [string, ...string[]]),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  indexManifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const excluded = new Set(["authSessions", "authVerificationTokens", "bankDevelopmentMigrationLocks", "authorizedSearchDocuments", "rateLimits"]);
type Header = z.infer<typeof headerSchema>;
export type RecoveryEnvelope = Readonly<{ header: Header; iv: Uint8Array; tag: Uint8Array; ciphertext: Uint8Array }>;
function fail(): never { throw new Error("Recovery envelope validation failed"); }
function header(input: unknown): Header {
  const result = headerSchema.safeParse(input);
  if (!result.success || excluded.has(result.data.collection)) return fail();
  return result.data;
}
function keyCheck(material: Uint8Array, keyVersion: number) {
  if (material.length !== 32 || !Number.isSafeInteger(keyVersion) || keyVersion < 1) return fail();
}
/** The explicit synthetic-only source cannot be switched to staging/production through an option. */
export function encryptRecoveryBson(bytes: Uint8Array, collection: string, indexManifestDigest: string,
  key: Readonly<{ version: number; material: Uint8Array }>): RecoveryEnvelope {
  keyCheck(key.material, key.version);
  if (!bytes.length || bytes.length > maximumBytes) return fail();
  try { assertRecoveryContent(BSON.deserialize(bytes, { promoteLongs: false })); } catch { return fail(); }
  const metadata = header({ version, schemaVersion: 1, keyVersion: key.version,
    source: "isolated-synthetic", collection, digest: bsonIntegrity(bytes), indexManifestDigest });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.material, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { header: metadata, iv, tag: cipher.getAuthTag(), ciphertext };
}
export function decryptRecoveryBson(input: RecoveryEnvelope, indexManifestDigest: string,
  key: Readonly<{ version: number; material: Uint8Array }>): Uint8Array {
  try {
    keyCheck(key.material, key.version);
    if (Object.keys(input).sort().join(",") !== "ciphertext,header,iv,tag") return fail();
    const metadata = header(input.header);
    if (metadata.keyVersion !== key.version || metadata.indexManifestDigest !== indexManifestDigest
      || input.iv.length !== 12 || input.tag.length !== 16 || !input.ciphertext.length || input.ciphertext.length > maximumBytes) return fail();
    const cipher = createDecipheriv("aes-256-gcm", key.material, input.iv);
    cipher.setAAD(Buffer.from(JSON.stringify(metadata))); cipher.setAuthTag(Buffer.from(input.tag));
    const bytes = Buffer.concat([cipher.update(input.ciphertext), cipher.final()]);
    if (bsonIntegrity(bytes) !== metadata.digest) return fail();
    assertRecoveryContent(BSON.deserialize(bytes, { promoteLongs: false }));
    return bytes;
  } catch { return fail(); }
}
