/** Provider control-plane evidence only: no provider call, sync resume, paid refresh or disconnect replay. */
import "server-only";
import { BSON, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { OPEN_BANKING_POLICY_VERSION, OPEN_BANKING_PROVIDER } from "@/lib/open-banking/open-banking";
import type { OpenBankingProviderErrorCategory } from "@/lib/open-banking/open-banking-provider";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { restorationSuppression, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";

const id = z.instanceof(ObjectId); const alias = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); const provider = z.literal(OPEN_BANKING_PROVIDER);
const categories = ["authentication", "consent", "credits", "locked", "not_found", "provider_unavailable", "rate_limited", "schema", "unknown", "internal"] as const satisfies readonly (OpenBankingProviderErrorCategory | "internal")[];
// HTTP rejections before execution (mutations are never retried). Timeouts, 5xx, unparseable responses, local failures after
// the call and 403/409 "consent" (ambiguous for DELETE) are unknown outcomes. A DELETE not_found still leaves local consent unverified.
const rejectedBeforeExecution: readonly string[] = ["authentication", "credits", "locked", "not_found", "rate_limited"];
const audit = <T extends readonly [string, ...string[]]>(actions: T) => z.array(z.object({ action: z.enum(actions), actorUserId: id, at: z.date(),
  changedFields: z.array(z.string()), revision, source: z.literal("open_banking") }).strict()).min(1);
const binding = z.object({ _id: id, userId: id, provider, subjectAlias: alias, claimedAt: z.date(), updatedAt: z.date(), version: revision,
  auditTrail: audit(["claimed", "refresh_requested"]) }).strict();
const connection = z.object({ _id: id, userId: id, provider, connectionAlias: alias, providerAlias: alias, fingerprint: alias,
  createdAt: z.date(), updatedAt: z.date(), version: revision, expiryDate: day.nullable(), lastFetchedAt: z.date().nullable(),
  lastFetchedDataDate: day.nullable(), mode: z.string().max(100).nullable(), status: z.string().min(1).max(2000),
  accountCount: count, transactionCount: count, auditTrail: audit(["observed", "updated", "disconnected"]) }).strict();
const counts = { accountObservationCount: count, canonicalAccountCount: count, canonicalTransactionCount: count, connectionObservationCount: count, transactionObservationCount: count };
const run = z.object({ _id: id, userId: id, provider, idempotencyKeyHash: alias, policyVersion: z.literal(OPEN_BANKING_POLICY_VERSION), ...counts,
  startedAt: z.date(), updatedAt: z.date(), completedAt: z.date().nullable(), leaseExpiresAt: z.date(), version: revision,
  status: z.enum(["completed", "failed", "partial", "running"]), errorCategory: z.enum(categories).nullable(),
  recoveryQuarantinedAt: z.date().optional(), auditTrail: audit(["started", "restarted", "completed", "failed", "partial"]) }).strict();
const lifecycle = z.object({ _id: id, userId: id, provider, idempotencyKeyHash: alias, kind: z.enum(["disconnect", "refresh"]),
  status: z.enum(["completed", "failed", "running"]), resultStatus: z.string().nullable(), startedAt: z.date(), updatedAt: z.date(),
  completedAt: z.date().nullable(), recoveryQuarantinedAt: z.date().optional() }).strict();
const fail = (): never => { throw new Error("Bank control recovery requires review"); };
const same = (left: Date, right: Date) => left.getTime() === right.getTime();

type Event = Readonly<{ action: string; actorUserId: ObjectId; at: Date; changedFields: readonly string[]; revision: number }>;
/** Owner-authored contiguous history; each action carries exactly the fields its repository writer records.
 * Event times come from different processes' clocks, so ordering is not asserted.
 */
function history(row: Readonly<{ userId: ObjectId; version: number; auditTrail: readonly Event[] }>, fields: Readonly<Record<string, readonly string[]>>, first: string) {
  const events = row.auditTrail;
  if (events.length !== row.version || events[0]!.action !== first) return fail();
  events.forEach((event, index) => {
    if (event.revision !== index + 1 || !event.actorUserId.equals(row.userId) || JSON.stringify(event.changedFields) !== JSON.stringify(fields[event.action])
      || (index > 0 && event.action === first)) return fail();
  });
  return events[events.length - 1]!;
}
function projected<T>(schema: z.ZodType<T>, row: Document): T {
  assertRecoveryContent(row); const parsed = schema.safeParse(row); if (!parsed.success) return fail(); return parsed.data;
}

export function projectRecoveryBankBinding(document: Document): Document {
  try {
    const row = projected(binding, document);
    const last = history(row, { claimed: ["subjectAlias"], refresh_requested: [] }, "claimed");
    if (!same(row.auditTrail[0]!.at, row.claimedAt) || !same(last.at, row.updatedAt)) return fail();
    // The HMAC alias is only meaningful under the same identity key; restore never re-claims or re-binds.
    return document;
  } catch { return fail(); }
}

export function projectRecoveryBankConnection(document: Document): Document {
  try {
    const row = projected(connection, document);
    const last = history(row, { observed: ["status"], updated: ["providerObservation"], disconnected: ["status"] }, "observed");
    // updatedAt is also written by unaudited, non-CAS count updates and may trail the last event.
    if (!same(row.auditTrail[0]!.at, row.createdAt) || row.status !== row.status.trim().toUpperCase()
      || (row.mode !== null && row.mode !== row.mode.trim()) || (last.action === "disconnected" && row.status !== "DISCONNECTED")) return fail();
    // Local status is not remote revocation or current consent; restored rows never enable synchronization.
    return document;
  } catch { return fail(); }
}

export function projectRecoveryBankSyncRun(document: Document): Document {
  try {
    const row = projected(run, document);
    const last = history(row, { started: ["status"], restarted: ["status", "leaseExpiresAt"], completed: ["status", "counts"],
      failed: ["status", "counts"], partial: ["status", "counts"] }, "started");
    row.auditTrail.forEach((event, index) => {
      const previous = row.auditTrail[index - 1]?.action;
      if (previous === "completed" || (previous !== undefined && previous !== "started" && previous !== "restarted" && event.action !== "restarted")) return fail();
    });
    const launch = [...row.auditTrail].reverse().find(event => event.action === "started" || event.action === "restarted")!;
    const touched = [row.accountObservationCount, row.canonicalAccountCount, row.canonicalTransactionCount, row.connectionObservationCount, row.transactionObservationCount].some(value => value > 0);
    if (!same(row.updatedAt, last.at) || !same(row.startedAt, launch.at) || (row.recoveryQuarantinedAt !== undefined && row.status === "completed")) return fail();
    if (row.status === "running") {
      if (last !== launch || touched || row.completedAt !== null || row.errorCategory !== null || row.leaseExpiresAt <= row.startedAt) return fail();
    } else if (last.action !== row.status || row.completedAt === null || !same(row.completedAt, last.at) || !same(row.leaseExpiresAt, last.at)
      || (row.status === "completed") !== (row.errorCategory === null) || (row.status === "failed" && touched) || (row.status === "partial" && !touched)) return fail();
    // A running row is an interrupted, possibly partial write: evidence only, fenced by quarantineBankControl before restore.
    return document;
  } catch { return fail(); }
}

export function projectRecoveryBankLifecycle(document: Document): Document {
  try {
    const row = projected(lifecycle, document);
    if (row.recoveryQuarantinedAt !== undefined && row.status === "completed") return fail();
    if (row.status === "running") {
      if (row.completedAt !== null || row.resultStatus !== null || !same(row.updatedAt, row.startedAt)) return fail();
    } else {
      const allowed: readonly string[] = row.status === "failed" ? categories : row.kind === "refresh" ? ["accepted", "already_running"] : ["disconnected"];
      if (row.completedAt === null || !same(row.completedAt, row.updatedAt) || row.resultStatus === null || !allowed.includes(row.resultStatus)) return fail();
    }
    // Preserving the idempotency record is what keeps a paid refresh or disconnect from being replayed.
    return document;
  } catch { return fail(); }
}

type BankControlRows = Readonly<{ bindings: readonly Document[]; connections: readonly Document[]; runs: readonly Document[]; lifecycle: readonly Document[] }>;

/** Quarantine-only inspection. A restored row never proves identity-key continuity, current consent or an external outcome. */
export function inspectBankControlRecovery(input: BankControlRows) {
  try {
    const ids = new Set<string>(); const keys = new Set<string>();
    const unique = (key: string) => { if (keys.has(key)) return fail(); keys.add(key); };
    const index = (collection: string, rows: readonly Document[], project: (row: Document) => Document, key: (row: Document) => readonly string[]) =>
      rows.map(value => {
        const row = project(value); const identity = `${collection}:${row._id.toHexString()}`;
        if (ids.has(identity)) return fail(); ids.add(identity);
        for (const item of key(row)) unique(`${collection}:${item}`);
        return row;
      });
    const bindings = index("bindings", input.bindings, projectRecoveryBankBinding,
      row => [`subject:${row.subjectAlias}`, `owner:${row.userId.toHexString()}`]);
    const connections = index("connections", input.connections, projectRecoveryBankConnection, row => [`${row.userId.toHexString()}:${row.connectionAlias}`]);
    const runs = index("runs", input.runs, projectRecoveryBankSyncRun, row => [`${row.userId.toHexString()}:${row.idempotencyKeyHash}`]);
    const commands = index("lifecycle", input.lifecycle, projectRecoveryBankLifecycle, row => [`${row.userId.toHexString()}:${row.kind}:${row.idempotencyKeyHash}`]);
    const bound = new Set(bindings.map(row => row.userId.toHexString()));
    return { policy: "bank-control-recovery-v1" as const, releaseAllowed: false as const, replayProviders: false as const, unresolved: {
      missingBinding: [...connections, ...runs, ...commands].filter(row => !bound.has(row.userId.toHexString())).length,
      unverifiedKeyContinuity: bindings.length,
      unverifiedConsent: connections.filter(row => ["CONNECTED", "ACTIVE", "COMPLETED"].includes(row.status)).length,
      interruptedSyncs: runs.filter(row => row.status === "running").length,
      unknownExternalOutcomes: commands.filter(row => row.status === "running"
        || (row.status === "failed" && !rejectedBeforeExecution.includes(row.resultStatus))).length,
    } };
  } catch { return fail(); }
}

/** Applies current owner suppression and fences every restored non-completed sync/command under its old key.
 * Completed commands keep returning their recorded outcome; nothing is resumed, retried or sent to the provider.
 */
export function quarantineBankControl(input: BankControlRows, ledger: RestorationLedgerContext) {
  inspectBankControlRecovery(input);
  const { isSuppressed, isProviderSubjectSuppressed } = restorationSuppression(ledger); let excluded = 0; let fenced = 0;
  const keep = (rows: readonly Document[], fence: boolean) => rows.flatMap(row => {
    if (isSuppressed(row.userId.toHexString())) { excluded++; return []; }
    const copy = BSON.deserialize(BSON.serialize(row), { promoteLongs: false });
    if (fence && copy.status !== "completed" && copy.recoveryQuarantinedAt === undefined) { copy.recoveryQuarantinedAt = new Date(ledger.now); fenced++; }
    return [copy];
  });
  const kept = { bindings: keep(input.bindings, false), connections: keep(input.connections, false), runs: keep(input.runs, true), lifecycle: keep(input.lifecycle, true) };
  // Evidence describes only what would be restored, after the whole input was validated above.
  return { releaseAllowed: false as const, ...kept, evidence: { policy: "bank-control-quarantine-v1" as const,
    ledgerRevision: ledger.authoritativeRevision, evaluatedAt: ledger.now, excluded, fenced, unresolved: inspectBankControlRecovery(kept).unresolved,
    // ADR-076: a surviving binding to an erased owner's provider subject is reported, never silently removed or trusted.
    erasedProviderSubjects: kept.bindings.filter(row => isProviderSubjectSuppressed(row.subjectAlias)).length } };
}
