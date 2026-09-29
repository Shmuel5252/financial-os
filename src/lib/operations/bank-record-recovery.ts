/** Private provider observations, bank-sourced canonical provenance and owner reconciliation evidence.
 * No provider call, re-observation, identity re-derivation or canonical recomputation.
 */
import "server-only";
import { Long, ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { fromStoredDomainValue, stableSerializableDomainValue } from "@/lib/db/domain-value-mapper";
import { manualSectionDomainSchemas } from "@/lib/onboarding/manual-record";
import { ACCOUNT_IDENTITY_VERSION } from "@/lib/open-banking/account-identity";
import { ACCOUNT_RECONCILIATION_POLICY, ACCOUNT_RECONCILIATION_WORKFLOW } from "@/lib/open-banking/account-reconciliation";
import { OPEN_BANKING_PROVIDER } from "@/lib/open-banking/open-banking";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";
import { projectRecoveryBankConnection } from "@/lib/operations/bank-control-recovery";

const id = z.instanceof(ObjectId); const alias = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); const currency = z.string().regex(/^[A-Z]{3}$/);
const provider = z.literal(OPEN_BANKING_PROVIDER); const label = z.string().max(120);
const money = z.object({ amountMinor: z.instanceof(Long), currency }).strict();
const accountType = z.enum(["CARD", "CHECKING", "LOAN", "SAVINGS", "SECURITY"]);
const code = z.string().regex(/^\d{1,6}$/).nullable(); const masked = z.string().regex(/^•••• [A-Z0-9]{4}$/).nullable();
const identity = z.object({ version: z.literal(ACCOUNT_IDENTITY_VERSION), bankCode: code, branchCode: code, maskedNumber: masked,
  referenceDigest: alias.nullable() }).strict().refine(value => (value.maskedNumber === null) === (value.referenceDigest === null));
const observation = { _id: id, userId: id, provider, recordAlias: alias, connectionAlias: alias, fingerprint: alias, observedAt: z.date(),
  sequence: revision, canonicalRecordId: z.null() };
const recordRevision = z.discriminatedUnion("recordKind", [
  z.object({ ...observation, recordKind: z.literal("connection"), accountAlias: z.null(), connection: z.object({ expiryDate: day.nullable(),
    lastFetchedAt: z.date().nullable(), lastFetchedDataDate: day.nullable(), mode: z.string().max(100).nullable(), providerAlias: alias,
    status: z.string().min(1).max(2000) }).strict() }).strict(),
  z.object({ ...observation, recordKind: z.literal("account"), accountAlias: alias, account: z.object({ identity: identity.optional(), accountType,
    balances: z.array(z.object({ amount: money, creditLimitIncluded: z.boolean().nullable(), referenceDate: day.nullable(), type: z.string().min(1).max(500) }).strict()).max(32),
    currency, displayName: label, isDuplicate: z.boolean() }).strict() }).strict(),
  z.object({ ...observation, recordKind: z.literal("transaction"), accountAlias: alias, transaction: z.object({ amount: money.nullable(),
    bookingDate: day.nullable(), categoryMain: label.nullable(), categorySub: label.nullable(), changedCategoryMain: label.nullable(), changedCategorySub: label.nullable(),
    installmentNumber: z.number().int().positive().max(10_000).nullable(), installmentTotal: z.number().int().positive().max(10_000).nullable(),
    isDuplicate: z.boolean(), merchantName: label.nullable(), originalAmount: money.nullable(), status: z.string().min(1).max(2000),
    transactionDate: day.nullable(), type: z.string().min(1).max(500), valueDate: day.nullable() }).strict() }).strict(),
]);
const canonicalRecord = z.object({ _id: id, userId: id, createdAt: z.date(), updatedAt: z.date(), deletedAt: z.null(), schemaVersion: z.literal(3),
  version: revision, fields: z.record(z.string(), z.unknown()),
  source: z.object({ connectionAlias: alias, kind: z.literal("open_banking"), observationFingerprint: alias, observedAt: z.date(), provider, recordAlias: alias }).strict(),
  auditTrail: z.array(z.object({ action: z.enum(["created", "updated"]), actorUserId: id, at: z.date(), changedFields: z.array(z.string()), revision,
    source: z.literal("open_banking") }).strict()).min(1) }).strict();
const reference = z.object({ accountAlias: alias, connectionAlias: alias, institutionAlias: alias, identity: identity.nullable(),
  comparison: z.object({ institution: label, name: label, type: accountType, currency, maskedNumber: masked, bankCode: code, branchCode: code }).strict() }).strict();
const decision = z.object({ requestKey: alias, requestFingerprint: alias, actorUserId: id, at: z.date(), decision: z.enum(["same_account", "not_same", "cannot_determine"]),
  resultClass: z.enum(["OWNER_ATTESTED", "REJECTED", "UNDETERMINED"]), source: z.literal("authenticated_owner"),
  policyVersion: z.literal(ACCOUNT_RECONCILIATION_POLICY), workflowVersion: z.literal(ACCOUNT_RECONCILIATION_WORKFLOW), canonicalVersion: revision,
  oldIdentity: reference, newIdentity: reference.nullable(), matchingFields: z.array(z.string()), ambiguityResolvedByOwner: z.boolean() }).strict();
const ledger = z.object({ _id: id, userId: id, provider, canonicalAccountId: id, aliases: z.array(alias).min(1), active: reference.nullable(),
  version: revision, events: z.array(decision).min(1).max(500) }).strict();
const attested = ["owner_attestation", "institution", "account_type", "currency", "displayed_comparison"];
const fail = (): never => { throw new Error("Bank record recovery requires review"); };
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
function parsed<T>(schema: z.ZodType<T>, row: Document): T {
  assertRecoveryContent(row); const result = schema.safeParse(row); if (!result.success) return fail(); return result.data;
}

export function projectRecoveryBankRecordRevision(document: Document): Document {
  try {
    const row = parsed(recordRevision, document);
    if (row.recordKind === "connection") {
      const status = row.connection.status;
      if (row.recordAlias !== row.connectionAlias || status !== status.trim().toUpperCase()) return fail();
    } else if (row.recordKind === "account" && row.accountAlias !== row.recordAlias) return fail();
    // Historical observations are private evidence, not current balances, consent or canonical truth.
    return document;
  } catch { return fail(); }
}

export function projectRecoveryOpenBankingRecord(section: "accounts" | "transactions", document: Document): Document {
  try {
    const row = parsed(canonicalRecord, document); const events = row.auditTrail; const last = events[events.length - 1]!;
    const keys = JSON.stringify(Object.keys(row.fields));
    if (events.length !== row.version || events[0]!.action !== "created" || events[0]!.at.getTime() !== row.createdAt.getTime()
      || last.at.getTime() !== row.updatedAt.getTime()) return fail();
    // source.observedAt comes from the observation's own now(), taken before the canonical write; it is not equal to updatedAt.
    events.forEach((event, index) => {
      if (event.revision !== index + 1 || !event.actorUserId.equals(row.userId) || (index > 0 && event.action !== "updated")
        || JSON.stringify(event.changedFields) !== keys) return fail();
    });
    const fields = fromStoredDomainValue(row.fields); const domain = manualSectionDomainSchemas[section].safeParse(fields);
    if (!domain.success || stable(fields) !== stable(domain.data)) return fail();
    // Constants of canonicalAccountFields/canonicalTransactionFields: a bank row cannot carry manual-only links or annotations.
    const value = domain.data as Record<string, unknown>;
    if (section === "accounts" ? !["bank", "credit_card", "loan", "savings"].includes(value.type as string)
      : !["expense", "income"].includes(value.type as string) || value.destinationAccountId !== null || value.refundOfTransactionId !== null
        || value.notes !== null || value.recurring !== false || value.confidenceBps !== 10_000) return fail();
    return document;
  } catch { return fail(); }
}

export function projectRecoveryBankReconciliation(document: Document): Document {
  try {
    const row = parsed(ledger, document); const expected = new Set<string>(); const requests = new Set<string>();
    let active: z.infer<typeof reference> | null = null;
    if (row.events.length !== row.version || new Set(row.aliases).size !== row.aliases.length) return fail();
    for (const event of row.events) {
      const confirmed = event.decision === "same_account";
      const resultClass = confirmed ? "OWNER_ATTESTED" : event.decision === "not_same" ? "REJECTED" : "UNDETERMINED";
      // The writer only records a decision against the currently active identity.
      if (!event.actorUserId.equals(row.userId) || requests.has(event.requestKey) || event.resultClass !== resultClass
        || (active !== null && event.oldIdentity.accountAlias !== active.accountAlias)
        || event.ambiguityResolvedByOwner !== confirmed || stable(event.matchingFields) !== stable(confirmed ? attested : ["displayed_comparison"])
        || (confirmed && event.newIdentity === null)) return fail();
      requests.add(event.requestKey); expected.add(event.oldIdentity.accountAlias);
      if (confirmed) { expected.add(event.newIdentity!.accountAlias); active = event.newIdentity; }
    }
    if (stable([...expected].sort()) !== stable([...row.aliases].sort()) || stable(active) !== stable(row.active)) return fail();
    // Owner attestation history, not proof that the provider's current account identity still matches.
    return document;
  } catch { return fail(); }
}

/** Quarantine-only link inspection over schema-reviewed rows; missing evidence stays unresolved, foreign links fail closed. */
export function inspectBankRecordRecovery(input: Readonly<{ connections: readonly Document[]; revisions: readonly Document[];
  accounts: readonly Document[]; transactions: readonly Document[]; reconciliations: readonly Document[] }>) {
  try {
    const ids = new Set<string>(); const keys = new Set<string>();
    const unique = (key: string) => { if (keys.has(key)) return fail(); keys.add(key); };
    const index = (collection: string, rows: readonly Document[], project: (row: Document) => Document, key: (row: Document) => readonly string[]) =>
      rows.map(value => {
        const row = project(value); const identity = `${collection}:${row._id.toHexString()}`;
        if (ids.has(identity)) return fail(); ids.add(identity);
        for (const item of key(row)) unique(`${collection}:${row.userId.toHexString()}:${item}`);
        return row;
      });
    const bank = (row: Document) => row.source?.kind === "open_banking";
    const connections = index("connections", input.connections, projectRecoveryBankConnection, row => [row.connectionAlias]);
    const revisions = index("revisions", input.revisions, projectRecoveryBankRecordRevision, row => [`${row.recordKind}:${row.recordAlias}:${row.sequence}`]);
    const accounts = index("accounts", input.accounts.filter(bank), row => projectRecoveryOpenBankingRecord("accounts", row), row => [row.source.recordAlias]);
    const transactions = index("transactions", input.transactions.filter(bank), row => projectRecoveryOpenBankingRecord("transactions", row), row => [row.source.recordAlias]);
    const ledgers = index("reconciliations", input.reconciliations, projectRecoveryBankReconciliation,
      row => [`account:${row.canonicalAccountId.toHexString()}`, ...row.aliases.map((item: string) => `alias:${item}`), ...row.events.map((item: Document) => `request:${item.requestKey}`)]);
    const connected = new Set(connections.map(row => `${row.userId.toHexString()}:${row.connectionAlias}`));
    const evidence = new Set(revisions.map(row => `${row.userId.toHexString()}:${row.recordKind}:${row.recordAlias}:${row.fingerprint}`));
    // All account rows, manual included: a bank transaction or ledger never legitimately targets a manual or foreign account.
    const accountById = new Map<string, Readonly<{ owner: ObjectId; bank: boolean }>>();
    for (const row of input.accounts) {
      if (!(row._id instanceof ObjectId) || !(row.userId instanceof ObjectId)) return fail();
      accountById.set(row._id.toHexString(), { owner: row.userId, bank: bank(row) });
    }
    const sequences = new Map<string, number[]>();
    for (const row of revisions) {
      const key = `${row.userId.toHexString()}:${row.recordKind}:${row.recordAlias}`; sequences.set(key, [...(sequences.get(key) ?? []), row.sequence]);
    }
    let matched = 0; const unresolved = { missingConnection: 0, missingEvidence: 0, missingAccount: 0, sequenceGaps: 0, historicalObservations: revisions.length };
    const link = (found: boolean, gap: keyof typeof unresolved) => { if (found) matched++; else unresolved[gap]++; };
    for (const row of revisions) link(connected.has(`${row.userId.toHexString()}:${row.connectionAlias}`), "missingConnection");
    for (const [kind, rows] of [["account", accounts], ["transaction", transactions]] as const) {
      for (const row of rows) {
        const owner = row.userId.toHexString();
        link(connected.has(`${owner}:${row.source.connectionAlias}`), "missingConnection");
        link(evidence.has(`${owner}:${kind}:${row.source.recordAlias}:${row.source.observationFingerprint}`), "missingEvidence");
      }
    }
    const account = (owner: ObjectId, target: string) => {
      const found = accountById.get(target.toLowerCase()); if (found && (!found.owner.equals(owner) || !found.bank)) return fail(); link(found !== undefined, "missingAccount");
    };
    for (const row of transactions) account(row.userId, row.fields.accountId);
    for (const row of ledgers) account(row.userId, row.canonicalAccountId.toHexString());
    // Revisions are appended from sequence 1; a gap means earlier observation evidence is absent from this recovery point.
    for (const values of sequences.values()) if (values.length !== Math.max(...values)) unresolved.sequenceGaps++;
    return { policy: "bank-record-recovery-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
