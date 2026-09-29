/** Restore orchestration, release fence and watermark verification. Isolated targets only; releaseAllowed stays false:
 * the fence proves technical preconditions, the operator decides release. Every uncertain state fails closed.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId, type Db, type Document } from "mongodb";
import { openBackupPackage, type RecoverySchemas } from "@/lib/operations/backup-package";
import { decodeBackupPackage, type BackupObjectStore } from "@/lib/operations/backup-capture";
import { restorationSuppression, type LedgerEnvironment, type LedgerKey, type RestorationLedgerContext } from "@/lib/operations/deletion-ledger";
import type { LedgerSnapshot } from "@/lib/operations/deletion-receipt-store";
import { recoveryCollections, recoveryPlan } from "@/lib/operations/recovery-plan";
import { quarantineBankControl } from "@/lib/operations/bank-control-recovery";
import { quarantineNotifications } from "@/lib/operations/notification-recovery";
import { quarantineNotificationPreferences } from "@/lib/operations/notification-preference-recovery";
import { filterHouseholdDeletionQuarantine } from "@/lib/operations/household-deletion-quarantine";
import { filterInvitationDeletionQuarantine } from "@/lib/operations/invitation-deletion-quarantine";
import { materializeInertRecoveryInvitation } from "@/lib/operations/invitation-recovery";
import { filterSharedReportDeletionQuarantine } from "@/lib/operations/shared-report-deletion-quarantine";
import { highestMirroredHead } from "@/lib/operations/ledger-mirror";

type Key = Readonly<{ version: number; material: Uint8Array }>;
/** ledgerKeys verify receipts, mirror exports and the signed release state; stateKey (the operator's active ledger key) signs state. */
export type LedgerInput = Readonly<{ ledger: Readonly<{ snapshot: () => Promise<LedgerSnapshot> }>; environment: LedgerEnvironment;
  ledgerKeys: readonly LedgerKey[]; stateKey: LedgerKey; mirror: BackupObjectStore; maxLedgerAgeMs: number; now: () => number }>;
type ReleaseFields = { state: "restoring" | "restored" | "fenced"; package: string; ledgerHead: number | null; counts: Record<string, number> | null; watermark: number | null };
type ReleaseState = ReleaseFields & { _id: "release"; keyVersion: number; signature: string };

const fail = (reason: string): never => { throw new Error(`Restore fenced: ${reason}`); };
const excluded = new Set<string>(recoveryPlan(recoveryCollections).collections.filter(item => item.action === "exclude" || item.action === "rebuild").map(item => item.name));
const hex24 = /^[a-f0-9]{24}$/i;
const releaseState = (target: Db) => target.collection<ReleaseState>("recoveryQuarantine");
const stateMac = (key: LedgerKey, fields: ReleaseFields) => createHmac("sha256", key.material).update(JSON.stringify(["restore-state-v1", key.version,
  fields.state, fields.package, fields.ledgerHead, fields.counts === null ? null : Object.entries(fields.counts).sort(), fields.watermark])).digest("hex");
const signed = (key: LedgerKey, fields: ReleaseFields): ReleaseState => ({ _id: "release", ...fields, keyVersion: key.version, signature: stateMac(key, fields) });
/** The release state lives in the restored target, so it is signed: a forged "restored"/"fenced" document fails closed. */
async function readState(target: Db, keys: readonly LedgerKey[]): Promise<ReleaseState | null> {
  const row = await releaseState(target).findOne({ _id: "release" });
  if (row === null) return null;
  const key = keys.find(item => item.version === row.keyVersion) ?? fail("release state tampered");
  const expected = Buffer.from(stateMac(key, { state: row.state, package: row.package, ledgerHead: row.ledgerHead, counts: row.counts, watermark: row.watermark }), "hex");
  const actual = Buffer.from(typeof row.signature === "string" ? row.signature : "", "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail("release state tampered");
  return row;
}
async function ledgerNotBehindMirror(input: LedgerInput, head: number) {
  let mirrored: number; try { mirrored = await highestMirroredHead(input.mirror, input.environment, input.ledgerKeys); } catch { return fail("ledger mirror unverifiable"); }
  if (head < mirrored) fail("ledger older than its mirror");
}

async function ledgerContext(input: LedgerInput): Promise<Readonly<{ snapshot: LedgerSnapshot; context: RestorationLedgerContext }>> {
  let snapshot: LedgerSnapshot;
  try { snapshot = await input.ledger.snapshot(); } catch { return fail("ledger unavailable"); }
  const context = { receipts: snapshot.receipts, environment: input.environment, keys: input.ledgerKeys, now: input.now(),
    ledgerReadAt: snapshot.readAt, maxLedgerAgeMs: input.maxLedgerAgeMs, authoritativeRevision: snapshot.head, suppliedRevision: snapshot.head };
  try { restorationSuppression(context); } catch { return fail("ledger stale or invalid"); }
  return { snapshot, context };
}

const ownerFilter = (rows: readonly Document[], isSuppressed: (id: string) => boolean, owner: (row: Document) => unknown) => rows.filter(row => {
  const value = owner(row);
  const id = value instanceof ObjectId ? value.toHexString() : typeof value === "string" && hex24.test(value) ? value.toLowerCase() : fail("row without a recognizable owner");
  return !isSuppressed(id);
});

/** Applies the current ledger to every opened collection with the existing reviewed quarantines; plain owner filter elsewhere. */
export function quarantineRestoredRecords(opened: Readonly<Record<string, readonly Document[]>>, context: RestorationLedgerContext, restoredAt: Date) {
  const { isSuppressed } = restorationSuppression(context);
  const rows = (name: string) => opened[name] ?? [];
  const graph = { households: rows("households"), householdMemberships: rows("householdMemberships"), householdResourceShares: rows("householdResourceShares"),
    authUsers: rows("authUsers"), accounts: rows("accounts"), goals: rows("goals") };
  const households = filterHouseholdDeletionQuarantine(graph, context).collections;
  const householdReports = rows("financialReports").filter(row => row.scope?.kind === "household");
  const bank = quarantineBankControl({ bindings: rows("bankProviderBindings"), connections: rows("bankConnections"), runs: rows("bankSyncRuns"),
    lifecycle: rows("bankLifecycleCommands") }, context);
  const special: Record<string, readonly Document[]> = {
    ...households,
    householdInvitations: filterInvitationDeletionQuarantine(rows("householdInvitations"), graph, context).preserved.map(row => materializeInertRecoveryInvitation(row, restoredAt)),
    financialReports: [...ownerFilter(rows("financialReports").filter(row => row.scope?.kind !== "household"), isSuppressed, row => row.userId),
      ...(householdReports.length ? filterSharedReportDeletionQuarantine(householdReports, graph, context).preserved : [])],
    notifications: quarantineNotifications(rows("notifications"), rows("authUsers"), context).preserved,
    notificationPreferences: quarantineNotificationPreferences(rows("notificationPreferences"), rows("authUsers"), context).preserved,
    bankProviderBindings: bank.bindings, bankConnections: bank.connections, bankSyncRuns: bank.runs, bankLifecycleCommands: bank.lifecycle,
    authUsers: ownerFilter(rows("authUsers"), isSuppressed, row => row._id),
  };
  return Object.fromEntries(Object.keys(opened).map(name => [name, special[name] ?? ownerFilter(rows(name), isSuppressed, row => row.userId)]));
}

/** Restores a package into a FRESH isolated target. An interrupted restore leaves state "restoring": it can never be fenced,
 * and a retry must use a new target.
 */
export async function restoreIntoQuarantine(input: LedgerInput & Readonly<{ store: BackupObjectStore; name: string; schemas: RecoverySchemas;
  indexManifestDigest: string; packageKey: Key; target: Db; ensureIndexes: (target: Db) => Promise<void> }>) {
  const existing = (await input.target.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name);
  if (existing.some(name => name !== "recoveryQuarantine") || await releaseState(input.target).countDocuments() !== 0) return fail("target is not fresh");
  const restoring: ReleaseFields = { state: "restoring", package: input.name, ledgerHead: null, counts: null, watermark: null };
  await releaseState(input.target).insertOne(signed(input.stateKey, restoring));
  const bytes = await input.store.get(input.name) ?? fail("package missing");
  let pack: ReturnType<typeof decodeBackupPackage>; let opened: Readonly<Record<string, readonly Document[]>>;
  try { pack = decodeBackupPackage(bytes); opened = openBackupPackage(pack, input.schemas, input.indexManifestDigest, input.packageKey); }
  catch { return fail("package invalid"); }
  const recoveryPoint = pack.manifest.recoveryPoint ?? fail("package has no recovery point");
  const { snapshot, context } = await ledgerContext(input);
  // The backup saw a newer ledger than the one now offered: the ledger was rolled back.
  if (snapshot.head < recoveryPoint.ledgerHead) return fail("ledger older than backup");
  await ledgerNotBehindMirror(input, snapshot.head);
  const records = quarantineRestoredRecords(opened, context, new Date(input.now()));
  await input.ensureIndexes(input.target);
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(records)) {
    if (rows.length === 0) continue;
    await input.target.collection(name).insertMany([...rows]); counts[name] = rows.length;
  }
  const restored = signed(input.stateKey, { ...restoring, state: "restored", ledgerHead: snapshot.head, counts });
  const updated = await releaseState(input.target).replaceOne({ _id: "release", state: "restoring", signature: signed(input.stateKey, restoring).signature }, restored);
  if (updated.modifiedCount !== 1) return fail("restore state changed");
  return { ledgerHead: snapshot.head, counts, recoveryPoint } as const;
}

async function scan(target: Db, context: RestorationLedgerContext, counts: Record<string, number> | null) {
  const { isSuppressed, isProviderSubjectSuppressed } = restorationSuppression(context);
  const names = (await target.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).filter(name => name !== "recoveryQuarantine" && !name.startsWith("system."));
  if (names.some(name => !recoveryCollections.includes(name) || excluded.has(name))) return fail("unexpected collection");
  if (counts !== null) for (const name of new Set([...names, ...Object.keys(counts)])) {
    if (await target.collection(name).countDocuments() !== (counts[name] ?? 0)) return fail("restored counts changed");
  }
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 64) return fail("document too deep");
    if (value instanceof ObjectId) { if (isSuppressed(value.toHexString())) fail("erased subject still referenced"); return; }
    if (typeof value === "string") { if (hex24.test(value) && isSuppressed(value.toLowerCase())) fail("erased subject still referenced"); return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) for (const item of Object.values(value)) visit(item, depth + 1);
  };
  for (const name of names) {
    for await (const row of target.collection(name).find()) {
      visit(row);
      if (name === "bankProviderBindings" && isProviderSubjectSuppressed(row.subjectAlias)) fail("erased provider subject bound");
      if ((name === "bankSyncRuns" || name === "bankLifecycleCommands") && row.status !== "completed" && row.recoveryQuarantinedAt === undefined) fail("unfenced provider command");
      if (name === "notifications" && ["deferred", "failed", "pending", "sending"].includes(row.email?.state)) fail("replayable notification");
      if (name === "householdInvitations" && row.status === "pending") fail("replayable invitation");
    }
  }
}

/** Technical release preconditions. Needs a completed restore and a ledger identical to the one the restore applied. */
export async function releaseFence(input: LedgerInput & Readonly<{ target: Db }>) {
  const state = await readState(input.target, input.ledgerKeys);
  if (state?.state !== "restored" || state.ledgerHead === null || state.counts === null) return fail("restore incomplete");
  const first = await ledgerContext(input);
  if (first.snapshot.head < state.ledgerHead) return fail("ledger rolled back");
  if (first.snapshot.head > state.ledgerHead) return fail("ledger advanced since restore; restore again from the package");
  await scan(input.target, first.context, state.counts);
  const second = await ledgerContext(input);
  if (second.snapshot.head !== first.snapshot.head) return fail("ledger advanced during fence");
  const fenced = await releaseState(input.target).replaceOne({ _id: "release", state: "restored", signature: state.signature },
    signed(input.stateKey, { state: "fenced", package: state.package, ledgerHead: state.ledgerHead, counts: state.counts, watermark: first.snapshot.head }));
  if (fenced.modifiedCount !== 1) return fail("release state changed");
  return { technicalChecksPassed: true as const, watermark: first.snapshot.head, releaseAllowed: false as const };
}

/** For a running (released) system: the watermark must exist and the current ledger must be at or after it, with no erased data. */
export async function verifyReleaseWatermark(input: LedgerInput & Readonly<{ target: Db }>) {
  const state = await readState(input.target, input.ledgerKeys);
  if (state?.state !== "fenced" || state.watermark === null) return fail("restore watermark missing");
  const { snapshot, context } = await ledgerContext(input);
  if (snapshot.head < state.watermark) return fail("ledger rolled back");
  await ledgerNotBehindMirror(input, snapshot.head);
  await scan(input.target, context, null);
  return { watermark: state.watermark, head: snapshot.head, delta: snapshot.head - state.watermark } as const;
}
