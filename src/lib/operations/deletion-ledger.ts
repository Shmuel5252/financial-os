/** Server-only primitives. No environment reads, database, deletion or key provisioning. */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@/lib/auth/actor";

export const DELETION_POLICY = "erasure-v1" as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.number().int().nonnegative().max(8_640_000_000_000_000);
const environment = z.enum(["isolated-test", "staging", "production"]);
const identity = z.string().regex(/^[a-f0-9]{24}$/);
const receiptSchema = z.object({
  policy: z.literal(DELETION_POLICY), environment,
  keyVersion: z.number().int().positive(), operationId: z.string().uuid(),
  subject: digest, acceptedAt: instant, completedAt: instant.nullable(),
  status: z.enum(["suppressed", "locally-erased"]), revision: z.number().int().positive().max(2),
  signature: digest,
}).strict().refine(r => r.status === "suppressed"
  ? r.completedAt === null && r.revision === 1
  : r.completedAt !== null && r.completedAt >= r.acceptedAt && r.revision === 2);
export type DeletionReceipt = z.infer<typeof receiptSchema>;
export type LedgerKey = Readonly<{ version: number; material: Uint8Array }>;
export type LedgerEnvironment = z.infer<typeof environment>;

function fail(): never { throw new Error("Deletion safety validation failed"); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input); if (!result.success) return fail(); return result.data;
}
function mac(key: LedgerKey, domain: string, value: unknown): string {
  if (!Number.isSafeInteger(key.version) || key.version < 1 || key.material.length !== 32) return fail();
  return createHmac("sha256", key.material).update(JSON.stringify([DELETION_POLICY, domain, key.version, value])).digest("hex");
}
export function deletionSubject(userId: string, env: LedgerEnvironment, key: LedgerKey): string {
  return mac(key, "subject", [parse(environment, env), parse(identity, userId)]);
}
function payload(r: Omit<DeletionReceipt, "signature">) {
  return [r.policy, r.environment, r.keyVersion, r.operationId, r.subject, r.acceptedAt, r.completedAt, r.status, r.revision];
}
function seal(r: Omit<DeletionReceipt, "signature">, key: LedgerKey): DeletionReceipt {
  return parse(receiptSchema, { ...r, signature: mac(key, "receipt", payload(r)) });
}
export function validateDeletionReceipt(input: unknown, env: LedgerEnvironment, keys: readonly LedgerKey[]): DeletionReceipt {
  const r = parse(receiptSchema, input);
  if (new Set(keys.map(k => k.version)).size !== keys.length) return fail();
  const key = keys.find(k => k.version === r.keyVersion);
  if (!key || r.environment !== env) return fail();
  const expected = mac(key, "receipt", payload(r));
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(r.signature, "hex"))) return fail();
  return r;
}

/** Caller must obtain Actor from requireActor; request supplies no target user ID. */
export function beginDeletion(actor: Actor, env: LedgerEnvironment, operationId: string, at: number, key: LedgerKey): DeletionReceipt {
  if (actor.kind !== "user") return fail();
  return seal({ policy: DELETION_POLICY, environment: env, keyVersion: key.version, operationId,
    subject: deletionSubject(actor.userId, env, key), acceptedAt: at, completedAt: null,
    status: "suppressed", revision: 1 }, key);
}
/** Records LOCAL completion only; this never claims provider consent was revoked. */
export function completeLocalDeletion(input: unknown, actor: Actor, env: LedgerEnvironment, at: number, key: LedgerKey): DeletionReceipt {
  const r = validateDeletionReceipt(input, env, [key]);
  if (actor.kind !== "user" || r.subject !== deletionSubject(actor.userId, env, key) || !instant.safeParse(at).success || at < r.acceptedAt) return fail();
  if (r.status === "locally-erased") return r;
  return seal({ ...r, completedAt: at, status: "locally-erased", revision: 2 }, key);
}

/** Both accepted and incomplete deletions suppress restoration. Duplicate/conflicting receipts fail closed.
 * This is a decision primitive, NOT proof the caller enumerated every shared/embedded subject.
 */
export function restorationDisposition(input: {
  ownerId: string; contributingSubjectIds: readonly string[]; receipts: readonly unknown[];
  environment: LedgerEnvironment; keys: readonly LedgerKey[];
  now: number; ledgerReadAt: number; maxLedgerAgeMs: number;
  authoritativeRevision: number; suppliedRevision: number;
}): "preserve" | "exclude-owner" | "redact-shared-before-release" {
  const { now, ledgerReadAt, maxLedgerAgeMs, authoritativeRevision, suppliedRevision } = input;
  if (![now, ledgerReadAt].every(v => instant.safeParse(v).success) || !Number.isSafeInteger(maxLedgerAgeMs) || maxLedgerAgeMs < 0
    || ledgerReadAt > now || now - ledgerReadAt > maxLedgerAgeMs || !Number.isSafeInteger(authoritativeRevision)
    || authoritativeRevision < 0 || suppliedRevision !== authoritativeRevision || input.keys.length === 0) return fail();
  const seenSubjects = new Set<string>();
  const receipts = input.receipts.map(r => validateDeletionReceipt(r, input.environment, input.keys));
  for (const r of receipts) {
    const subjectKey = `${r.keyVersion}:${r.subject}`;
    // Idempotency keys are subject-scoped; reuse by a different actor cannot invalidate their ledger.
    if (seenSubjects.has(subjectKey) || r.acceptedAt > ledgerReadAt) return fail();
    seenSubjects.add(subjectKey);
  }
  const suppressed = (id: string) => input.keys.some(key => seenSubjects.has(`${key.version}:${deletionSubject(id, input.environment, key)}`));
  if (suppressed(input.ownerId)) return "exclude-owner";
  if (input.contributingSubjectIds.some(suppressed)) return "redact-shared-before-release";
  return "preserve";
}

/** No TTL decision from request age alone. Unknown coverage blocks expiry and requires operator review. */
export function deletionRetention(input: {
  now: number; completedAt: number | null; latestRestorableExpiry: number | null;
  replayWindowEnd: number | null; safetyMarginMs: number;
  inventoryVerifiedAt: number | null; maxInventoryAgeMs: number;
}): Readonly<{ status: "review-required" | "retain" | "expiry-eligible"; notBefore: number | null }> {
  const numbers = [input.now, input.safetyMarginMs, input.maxInventoryAgeMs];
  if (!numbers.every(v => instant.safeParse(v).success)) return fail();
  const times = [input.completedAt, input.latestRestorableExpiry, input.replayWindowEnd, input.inventoryVerifiedAt];
  if (times.some(v => v !== null && !instant.safeParse(v).success)) return fail();
  if (times.some(v => v === null)) return { status: "review-required", notBefore: null };
  const [completed, expiry, replay, verified] = times as number[];
  if (completed! > input.now || verified! > input.now || input.now - verified! > input.maxInventoryAgeMs) return { status: "review-required", notBefore: null };
  const notBefore = Math.max(completed!, expiry!, replay!) + input.safetyMarginMs;
  if (!instant.safeParse(notBefore).success) return fail();
  return { status: input.now >= notBefore ? "expiry-eligible" : "retain", notBefore };
}
