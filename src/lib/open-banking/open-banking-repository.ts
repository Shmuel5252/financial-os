import "server-only";

import { createHash } from "node:crypto";

import {
  type Collection,
  type Db,
  MongoServerError,
  ObjectId,
} from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import type { SafeAccountIdentity } from "@/lib/open-banking/account-identity";
import { parseObjectId } from "@/lib/authorization/ownership";
import { fromStoredMoney, toStoredMoney, type StoredMoney } from "@/lib/db/money-mapper";
import { getDatabase } from "@/lib/db/mongodb";
import type { Money } from "@/lib/domain/money/money";
import { serializeMoney } from "@/lib/domain/money/money";
import {
  ConflictError,
  ReconciliationRequiredError,
  UnauthorizedError,
} from "@/lib/errors/application-error";
import type { ManualFields } from "@/lib/onboarding/manual-record";
import {
  OPEN_BANKING_FRESHNESS_MAX_AGE_DAYS,
  OPEN_BANKING_POLICY_VERSION,
  OPEN_BANKING_PROVIDER,
  type OpenBankingAccountView,
  type OpenBankingCenterView,
  type OpenBankingConnectionView,
  type OpenBankingFreshness,
  type OpenBankingSyncRunView,
} from "@/lib/open-banking/open-banking";
import type {
  OpenBankingAccountObservation,
  OpenBankingConnectionObservation,
  OpenBankingTransactionObservation,
} from "@/lib/open-banking/open-banking-provider";

type AuditEvent = Readonly<{
  action: string;
  actorUserId: ObjectId;
  at: Date;
  changedFields: readonly string[];
  revision: number;
  source: "open_banking";
}>;

type BindingDocument = {
  _id: ObjectId;
  auditTrail: AuditEvent[];
  claimedAt: Date;
  provider: typeof OPEN_BANKING_PROVIDER;
  subjectAlias: string;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type ConnectionDocument = {
  _id: ObjectId;
  accountCount: number;
  auditTrail: AuditEvent[];
  connectionAlias: string;
  createdAt: Date;
  expiryDate: string | null;
  fingerprint: string;
  lastFetchedAt: Date | null;
  lastFetchedDataDate: string | null;
  mode: string | null;
  provider: typeof OPEN_BANKING_PROVIDER;
  providerAlias: string;
  status: string;
  transactionCount: number;
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type StoredBalance = {
  amount: StoredMoney;
  creditLimitIncluded: boolean | null;
  referenceDate: string | null;
  type: string;
};

type RecordRevisionDocument = {
  _id: ObjectId;
  account?: {
    identity?: SafeAccountIdentity;
    accountType: OpenBankingAccountObservation["accountType"];
    balances: StoredBalance[];
    currency: string;
    displayName: string;
    isDuplicate: boolean;
  };
  accountAlias: string | null;
  canonicalRecordId: ObjectId | null;
  connection?: {
    expiryDate: string | null;
    lastFetchedAt: Date | null;
    lastFetchedDataDate: string | null;
    mode: string | null;
    providerAlias: string;
    status: string;
  };
  connectionAlias: string;
  fingerprint: string;
  observedAt: Date;
  provider: typeof OPEN_BANKING_PROVIDER;
  recordAlias: string;
  recordKind: "account" | "connection" | "transaction";
  sequence: number;
  transaction?: {
    amount: StoredMoney | null;
    bookingDate: string | null;
    categoryMain: string | null;
    categorySub: string | null;
    changedCategoryMain: string | null;
    changedCategorySub: string | null;
    installmentNumber: number | null;
    installmentTotal: number | null;
    isDuplicate: boolean;
    merchantName: string | null;
    originalAmount: StoredMoney | null;
    status: string;
    transactionDate: string | null;
    type: string;
    valueDate: string | null;
  };
  userId: ObjectId;
};

type SyncCounts = {
  accountObservationCount: number;
  canonicalAccountCount: number;
  canonicalTransactionCount: number;
  connectionObservationCount: number;
  transactionObservationCount: number;
};

type SyncRunDocument = SyncCounts & {
  _id: ObjectId;
  auditTrail: AuditEvent[];
  completedAt: Date | null;
  errorCategory: string | null;
  idempotencyKeyHash: string;
  leaseExpiresAt: Date;
  policyVersion: string;
  provider: typeof OPEN_BANKING_PROVIDER;
  startedAt: Date;
  status: "completed" | "failed" | "partial" | "running";
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

type LifecycleDocument = {
  _id: ObjectId;
  completedAt: Date | null;
  idempotencyKeyHash: string;
  kind: "disconnect" | "refresh";
  provider: typeof OPEN_BANKING_PROVIDER;
  resultStatus: string | null;
  startedAt: Date;
  status: "completed" | "failed" | "running";
  updatedAt: Date;
  userId: ObjectId;
};

type CanonicalRecordDocument = {
  _id: ObjectId;
  auditTrail: AuditEvent[];
  createdAt: Date;
  deletedAt: Date | null;
  fields: Record<string, unknown>;
  schemaVersion: number;
  source: {
    connectionAlias: string;
    kind: "open_banking";
    observationFingerprint: string;
    observedAt: Date;
    provider: typeof OPEN_BANKING_PROVIDER;
    recordAlias: string;
  };
  updatedAt: Date;
  userId: ObjectId;
  version: number;
};

export type OpenBankingRepositoryCollections = Readonly<{
  developmentMigrations: Collection<{ _id: string; userId: ObjectId; policyVersion: string; state: string; oldConnectionAliases: string[] }>;
  accounts: Collection<CanonicalRecordDocument>;
  bindings: Collection<BindingDocument>;
  connections: Collection<ConnectionDocument>;
  lifecycle: Collection<LifecycleDocument>;
  revisions: Collection<RecordRevisionDocument>;
  runs: Collection<SyncRunDocument>;
  transactions: Collection<CanonicalRecordDocument>;
}>;

export type StartSyncResult = Readonly<{
  alreadyCompleted: boolean;
  run: OpenBankingSyncRunView;
}>;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function userId(actor: Actor): ObjectId {
  return parseObjectId(actor.userId, "actor.userId");
}

function storedValue(value: unknown): unknown {
  if (
    typeof value === "object" && value !== null &&
    "amountMinor" in value && typeof value.amountMinor === "bigint" &&
    "currency" in value && typeof value.currency === "string"
  ) return toStoredMoney(value as Money);
  if (Array.isArray(value)) return value.map(storedValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, storedValue(item)]));
  }
  return value;
}

function storedFields(fields: ManualFields): Record<string, unknown> {
  const value = storedValue(fields);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError("Canonical fields must be an object.");
  }
  return value as Record<string, unknown>;
}

function runView(run: SyncRunDocument): OpenBankingSyncRunView {
  return {
    accountObservationCount: run.accountObservationCount,
    canonicalAccountCount: run.canonicalAccountCount,
    canonicalTransactionCount: run.canonicalTransactionCount,
    completedAt: run.completedAt?.toISOString() ?? null,
    connectionObservationCount: run.connectionObservationCount,
    errorCategory: run.errorCategory,
    id: run._id.toHexString(),
    startedAt: run.startedAt.toISOString(),
    status: run.status,
    transactionObservationCount: run.transactionObservationCount,
  };
}

function freshness(lastFetchedDataDate: string | null, today: string): OpenBankingFreshness {
  if (lastFetchedDataDate === null) return "UNKNOWN";
  const elapsed = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastFetchedDataDate}T12:00:00Z`)) / 86_400_000);
  return elapsed >= 0 && elapsed <= OPEN_BANKING_FRESHNESS_MAX_AGE_DAYS ? "FRESH" : "STALE";
}

export class OpenBankingRepository {
  constructor(
    private readonly collections: OpenBankingRepositoryCollections,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collections.bindings.createIndex(
        { provider: 1, subjectAlias: 1 },
        { name: "bank_binding_provider_subject_unique", unique: true },
      ),
      this.collections.bindings.createIndex(
        { userId: 1, provider: 1 },
        { name: "bank_binding_owner_provider_unique", unique: true },
      ),
      this.collections.connections.createIndex(
        { userId: 1, provider: 1, connectionAlias: 1 },
        { name: "bank_connections_owner_provider_external_unique", unique: true },
      ),
      this.collections.revisions.createIndex(
        { userId: 1, recordKind: 1, recordAlias: 1, sequence: -1 },
        { name: "bank_revisions_owner_record_sequence_unique", unique: true },
      ),
      this.collections.runs.createIndex(
        { userId: 1, provider: 1, idempotencyKeyHash: 1 },
        { name: "bank_sync_owner_idempotency_unique", unique: true },
      ),
      this.collections.lifecycle.createIndex(
        { userId: 1, provider: 1, kind: 1, idempotencyKeyHash: 1 },
        { name: "bank_lifecycle_owner_idempotency_unique", unique: true },
      ),
      this.collections.runs.createIndex(
        { userId: 1, startedAt: -1 },
        { name: "bank_sync_owner_started" },
      ),
      this.collections.accounts.createIndex(
        { userId: 1, "source.kind": 1, "source.provider": 1, "source.recordAlias": 1 },
        {
          name: "accounts_owner_open_banking_record_unique",
          partialFilterExpression: { "source.kind": "open_banking" },
          unique: true,
        },
      ),
      this.collections.transactions.createIndex(
        { userId: 1, "source.kind": 1, "source.provider": 1, "source.recordAlias": 1 },
        {
          name: "transactions_owner_open_banking_record_unique",
          partialFilterExpression: { "source.kind": "open_banking" },
          unique: true,
        },
      ),
    ]);
  }

  async claimBinding(actor: Actor, subjectAlias: string): Promise<void> {
    const owner = userId(actor);
    const existing = await this.collections.bindings.findOne({ provider: OPEN_BANKING_PROVIDER, subjectAlias });
    if (existing !== null) {
      if (!existing.userId.equals(owner)) throw new UnauthorizedError();
      return;
    }
    const now = this.now();
    try {
      await this.collections.bindings.insertOne({
        _id: new ObjectId(),
        auditTrail: [{ action: "claimed", actorUserId: owner, at: now, changedFields: ["subjectAlias"], revision: 1, source: "open_banking" }],
        claimedAt: now,
        provider: OPEN_BANKING_PROVIDER,
        subjectAlias,
        updatedAt: now,
        userId: owner,
        version: 1,
      });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError("The configured bank connection is already bound.");
      throw error;
    }
  }

  async assertBinding(actor: Actor, subjectAlias: string): Promise<void> {
    const binding = await this.collections.bindings.findOne({
      provider: OPEN_BANKING_PROVIDER,
      subjectAlias,
      userId: userId(actor),
    });
    if (binding === null) throw new UnauthorizedError("The configured bank connection has not been claimed by this user.");
  }

  async hasBinding(actor: Actor, subjectAlias: string): Promise<boolean> {
    return (await this.collections.bindings.countDocuments({ provider: OPEN_BANKING_PROVIDER, subjectAlias, userId: userId(actor) }, { limit: 1 })) === 1;
  }

  async assertConnectionContinuity(
    actor: Actor,
    incoming: readonly Readonly<{ connectionAlias: string; providerAlias: string; status: string }>[],
  ): Promise<void> {
    const owner = userId(actor);
    const readable = incoming.filter((item) => ["CONNECTED", "ACTIVE", "COMPLETED"].includes(item.status));
    if (readable.length === 0) return;
    const endedStatuses = ["DISCONNECTED", "TERMINATED_BY_USER", "REVOKED", "REPLACED", "EXPIRED", "TERMINATED_BY_ASPSP", "TERMINATED_BY_TPP"];
    const endedIncoming = incoming.filter((item) => endedStatuses.includes(item.status)).map((item) => item.connectionAlias);
    const historical = await this.collections.connections.find({
      userId: owner,
      provider: OPEN_BANKING_PROVIDER,
      providerAlias: { $in: readable.map((item) => item.providerAlias) },
      $or: [{ status: { $in: endedStatuses } }, { connectionAlias: { $in: endedIncoming } }],
    }).toArray();
    for (const previous of historical) {
      if (!readable.some((item) => item.providerAlias === previous.providerAlias && item.connectionAlias !== previous.connectionAlias)) continue;
      const filter = {
        userId: owner,
        "source.kind": "open_banking" as const,
        "source.provider": OPEN_BANKING_PROVIDER,
        "source.connectionAlias": previous.connectionAlias,
      };
      const [account, transaction] = await Promise.all([
        this.collections.accounts.findOne(filter, { projection: { _id: 1 } }),
        this.collections.transactions.findOne(filter, { projection: { _id: 1 } }),
      ]);
      if (account !== null || transaction !== null) throw new ReconciliationRequiredError();
    }
  }

  async retiredDevelopmentConnectionAliases(actor: Actor): Promise<ReadonlySet<string>> {
    const completed = await this.collections.developmentMigrations.find({
      userId: userId(actor), policyVersion: "financy-development-baseline-2026-09-06-v1", state: "retired",
    }).toArray();
    return new Set(completed.flatMap((item) => item.oldConnectionAliases));
  }

  async startSync(actor: Actor, idempotencyKey: string): Promise<StartSyncResult> {
    const owner = userId(actor);
    const idempotencyKeyHash = hash(idempotencyKey);
    const existing = await this.collections.runs.findOne({ userId: owner, provider: OPEN_BANKING_PROVIDER, idempotencyKeyHash });
    const now = this.now();
    if (existing?.status === "completed") return { alreadyCompleted: true, run: runView(existing) };
    if (existing?.status === "running" && existing.leaseExpiresAt > now) throw new ConflictError("A bank synchronization is already running.");
    if (existing !== null) {
      const updated = await this.collections.runs.findOneAndUpdate(
        { _id: existing._id, userId: owner, version: existing.version },
        {
          $inc: { version: 1 },
          $push: { auditTrail: { action: "restarted", actorUserId: owner, at: now, changedFields: ["status", "leaseExpiresAt"], revision: existing.version + 1, source: "open_banking" } },
          $set: {
            accountObservationCount: 0,
            canonicalAccountCount: 0,
            canonicalTransactionCount: 0,
            completedAt: null,
            connectionObservationCount: 0,
            errorCategory: null,
            leaseExpiresAt: new Date(now.getTime() + 120_000),
            startedAt: now,
            status: "running",
            transactionObservationCount: 0,
            updatedAt: now,
          },
        },
        { returnDocument: "after" },
      );
      if (updated === null) throw new ConflictError();
      return { alreadyCompleted: false, run: runView(updated) };
    }
    const run: SyncRunDocument = {
      _id: new ObjectId(),
      accountObservationCount: 0,
      auditTrail: [{ action: "started", actorUserId: owner, at: now, changedFields: ["status"], revision: 1, source: "open_banking" }],
      canonicalAccountCount: 0,
      canonicalTransactionCount: 0,
      completedAt: null,
      connectionObservationCount: 0,
      errorCategory: null,
      idempotencyKeyHash,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
      policyVersion: OPEN_BANKING_POLICY_VERSION,
      provider: OPEN_BANKING_PROVIDER,
      startedAt: now,
      status: "running",
      transactionObservationCount: 0,
      updatedAt: now,
      userId: owner,
      version: 1,
    };
    try {
      await this.collections.runs.insertOne(run);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError("A bank synchronization with this key already exists.");
      throw error;
    }
    return { alreadyCompleted: false, run: runView(run) };
  }

  async completeSync(actor: Actor, runId: string, counts: SyncCounts): Promise<OpenBankingSyncRunView> {
    return this.finishSync(actor, runId, "completed", counts, null);
  }

  async startLifecycle(
    actor: Actor,
    kind: LifecycleDocument["kind"],
    idempotencyKey: string,
  ): Promise<Readonly<{ completed: boolean; id: string; resultStatus: string | null }>> {
    const owner = userId(actor);
    const idempotencyKeyHash = hash(idempotencyKey);
    const existing = await this.collections.lifecycle.findOne({ userId: owner, provider: OPEN_BANKING_PROVIDER, kind, idempotencyKeyHash });
    if (existing?.status === "completed") return { completed: true, id: existing._id.toHexString(), resultStatus: existing.resultStatus };
    if (existing?.status === "running") throw new ConflictError("This bank lifecycle action is already running.");
    if (existing?.status === "failed" && kind === "refresh") {
      throw new ConflictError("This paid refresh was already attempted. A new explicit authorization is required.");
    }
    const now = this.now();
    if (existing !== null) {
      await this.collections.lifecycle.updateOne({ _id: existing._id, userId: owner }, { $set: { completedAt: null, resultStatus: null, startedAt: now, status: "running", updatedAt: now } });
      return { completed: false, id: existing._id.toHexString(), resultStatus: null };
    }
    const document: LifecycleDocument = {
      _id: new ObjectId(),
      completedAt: null,
      idempotencyKeyHash,
      kind,
      provider: OPEN_BANKING_PROVIDER,
      resultStatus: null,
      startedAt: now,
      status: "running",
      updatedAt: now,
      userId: owner,
    };
    try {
      await this.collections.lifecycle.insertOne(document);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError("This bank lifecycle action already exists.");
      throw error;
    }
    return { completed: false, id: document._id.toHexString(), resultStatus: null };
  }

  async finishLifecycle(
    actor: Actor,
    id: string,
    status: "completed" | "failed",
    resultStatus: string | null,
  ): Promise<void> {
    const now = this.now();
    const result = await this.collections.lifecycle.updateOne(
      { _id: parseObjectId(id), userId: userId(actor), status: "running" },
      { $set: { completedAt: now, resultStatus, status, updatedAt: now } },
    );
    if (result.modifiedCount !== 1) throw new ConflictError();
  }

  async failSync(actor: Actor, runId: string, counts: SyncCounts, errorCategory: string): Promise<OpenBankingSyncRunView> {
    const status = Object.values(counts).some((count) => count > 0) ? "partial" : "failed";
    return this.finishSync(actor, runId, status, counts, errorCategory);
  }

  private async finishSync(
    actor: Actor,
    runId: string,
    status: "completed" | "failed" | "partial",
    counts: SyncCounts,
    errorCategory: string | null,
  ): Promise<OpenBankingSyncRunView> {
    const now = this.now();
    const current = await this.collections.runs.findOne({
      _id: parseObjectId(runId),
      status: "running",
      userId: userId(actor),
    });
    if (current === null) throw new ConflictError();
    const updated = await this.collections.runs.findOneAndUpdate(
      { _id: current._id, status: "running", userId: current.userId, version: current.version },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: status, actorUserId: current.userId, at: now, changedFields: ["status", "counts"], revision: current.version + 1, source: "open_banking" } },
        $set: { ...counts, completedAt: now, errorCategory, leaseExpiresAt: now, status, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (updated === null) throw new ConflictError();
    return runView(updated);
  }

  private async appendRevision(document: Omit<RecordRevisionDocument, "_id" | "sequence">): Promise<boolean> {
    const latest = await this.collections.revisions.findOne(
      { userId: document.userId, recordKind: document.recordKind, recordAlias: document.recordAlias },
      { sort: { sequence: -1 } },
    );
    if (latest?.fingerprint === document.fingerprint) return false;
    try {
      await this.collections.revisions.insertOne({ ...document, _id: new ObjectId(), sequence: (latest?.sequence ?? 0) + 1 });
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError("Bank evidence changed concurrently.");
      throw error;
    }
  }

  async observeConnection(
    actor: Actor,
    input: OpenBankingConnectionObservation,
    aliases: Readonly<{ connection: string; provider: string }>,
    fingerprint: string,
  ): Promise<string> {
    const owner = userId(actor);
    const now = this.now();
    const existing = await this.collections.connections.findOne({ userId: owner, provider: OPEN_BANKING_PROVIDER, connectionAlias: aliases.connection });
    await this.appendRevision({
      accountAlias: null,
      canonicalRecordId: null,
      connection: {
        expiryDate: input.expiryDate,
        lastFetchedAt: input.lastFetchedAt === null ? null : new Date(input.lastFetchedAt),
        lastFetchedDataDate: input.lastFetchedDataDate,
        mode: input.mode,
        providerAlias: aliases.provider,
        status: input.status,
      },
      connectionAlias: aliases.connection,
      fingerprint,
      observedAt: now,
      provider: OPEN_BANKING_PROVIDER,
      recordAlias: aliases.connection,
      recordKind: "connection",
      userId: owner,
    });
    if (existing === null) {
      const inserted: ConnectionDocument = {
        _id: new ObjectId(),
        accountCount: 0,
        auditTrail: [{ action: "observed", actorUserId: owner, at: now, changedFields: ["status"], revision: 1, source: "open_banking" }],
        connectionAlias: aliases.connection,
        createdAt: now,
        expiryDate: input.expiryDate,
        fingerprint,
        lastFetchedAt: input.lastFetchedAt === null ? null : new Date(input.lastFetchedAt),
        lastFetchedDataDate: input.lastFetchedDataDate,
        mode: input.mode,
        provider: OPEN_BANKING_PROVIDER,
        providerAlias: aliases.provider,
        status: input.status,
        transactionCount: 0,
        updatedAt: now,
        userId: owner,
        version: 1,
      };
      await this.collections.connections.insertOne(inserted);
      return inserted._id.toHexString();
    }
    if (existing.fingerprint !== fingerprint) {
      await this.collections.connections.updateOne(
        { _id: existing._id, userId: owner, version: existing.version },
        {
          $inc: { version: 1 },
          $push: { auditTrail: { action: "updated", actorUserId: owner, at: now, changedFields: ["providerObservation"], revision: existing.version + 1, source: "open_banking" } },
          $set: {
            expiryDate: input.expiryDate,
            fingerprint,
            lastFetchedAt: input.lastFetchedAt === null ? null : new Date(input.lastFetchedAt),
            lastFetchedDataDate: input.lastFetchedDataDate,
            mode: input.mode,
            providerAlias: aliases.provider,
            status: input.status,
            updatedAt: now,
          },
        },
      );
    }
    return existing._id.toHexString();
  }

  private async upsertCanonical(
    collection: Collection<CanonicalRecordDocument>,
    actor: Actor,
    fields: ManualFields,
    source: CanonicalRecordDocument["source"],
  ): Promise<Readonly<{ changed: boolean; id: ObjectId }>> {
    const owner = userId(actor);
    const existing = await collection.findOne({ userId: owner, "source.kind": "open_banking", "source.provider": OPEN_BANKING_PROVIDER, "source.recordAlias": source.recordAlias });
    const now = this.now();
    if (existing === null) {
      const document: CanonicalRecordDocument = {
        _id: new ObjectId(),
        auditTrail: [{ action: "created", actorUserId: owner, at: now, changedFields: Object.keys(fields), revision: 1, source: "open_banking" }],
        createdAt: now,
        deletedAt: null,
        fields: storedFields(fields),
        schemaVersion: 3,
        source,
        updatedAt: now,
        userId: owner,
        version: 1,
      };
      await collection.insertOne(document);
      return { changed: true, id: document._id };
    }
    if (existing.source.observationFingerprint === source.observationFingerprint) {
      return { changed: false, id: existing._id };
    }
    const result = await collection.updateOne(
      { _id: existing._id, userId: owner, version: existing.version, "source.kind": "open_banking" },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: "updated", actorUserId: owner, at: now, changedFields: Object.keys(fields), revision: existing.version + 1, source: "open_banking" } },
        $set: { deletedAt: null, fields: storedFields(fields), source, updatedAt: now },
      },
    );
    if (result.modifiedCount !== 1) throw new ConflictError("Bank record changed concurrently.");
    return { changed: true, id: existing._id };
  }

  async observeAccount(
    actor: Actor,
    input: OpenBankingAccountObservation,
    aliases: Readonly<{ account: string; connection: string }>,
    fingerprint: string,
    canonicalFields: ManualFields | null,
  ): Promise<Readonly<{ canonicalId: string | null; canonicalChanged: boolean; observationChanged: boolean }>> {
    const owner = userId(actor);
    const now = this.now();
    const observationChanged = await this.appendRevision({
      account: {
        ...(input.identity === undefined ? {} : { identity: input.identity }),
        accountType: input.accountType,
        balances: input.balances.map((balance) => ({ ...balance, amount: toStoredMoney(balance.amount) })),
        currency: input.currency,
        displayName: input.displayName,
        isDuplicate: input.isDuplicate,
      },
      accountAlias: aliases.account,
      canonicalRecordId: null,
      connectionAlias: aliases.connection,
      fingerprint,
      observedAt: now,
      provider: OPEN_BANKING_PROVIDER,
      recordAlias: aliases.account,
      recordKind: "account",
      userId: owner,
    });
    if (canonicalFields === null) return { canonicalChanged: false, canonicalId: null, observationChanged };
    const canonical = await this.upsertCanonical(this.collections.accounts, actor, canonicalFields, {
      connectionAlias: aliases.connection,
      kind: "open_banking",
      observationFingerprint: fingerprint,
      observedAt: now,
      provider: OPEN_BANKING_PROVIDER,
      recordAlias: aliases.account,
    });
    return { canonicalChanged: canonical.changed, canonicalId: canonical.id.toHexString(), observationChanged };
  }

  async observeTransaction(
    actor: Actor,
    input: OpenBankingTransactionObservation,
    aliases: Readonly<{ account: string; connection: string; transaction: string }>,
    fingerprint: string,
    canonicalFields: ManualFields | null,
  ): Promise<Readonly<{ canonicalChanged: boolean; observationChanged: boolean }>> {
    const owner = userId(actor);
    const now = this.now();
    const observationChanged = await this.appendRevision({
      accountAlias: aliases.account,
      canonicalRecordId: null,
      connectionAlias: aliases.connection,
      fingerprint,
      observedAt: now,
      provider: OPEN_BANKING_PROVIDER,
      recordAlias: aliases.transaction,
      recordKind: "transaction",
      transaction: {
        amount: input.amount === null ? null : toStoredMoney(input.amount),
        bookingDate: input.bookingDate,
        categoryMain: input.categoryMain,
        categorySub: input.categorySub,
        changedCategoryMain: input.changedCategoryMain,
        changedCategorySub: input.changedCategorySub,
        installmentNumber: input.installmentNumber,
        installmentTotal: input.installmentTotal,
        isDuplicate: input.isDuplicate,
        merchantName: input.merchantName,
        originalAmount: input.originalAmount === null ? null : toStoredMoney(input.originalAmount),
        status: input.status,
        transactionDate: input.transactionDate,
        type: input.type,
        valueDate: input.valueDate,
      },
      userId: owner,
    });
    if (canonicalFields === null) return { canonicalChanged: false, observationChanged };
    const canonical = await this.upsertCanonical(this.collections.transactions, actor, canonicalFields, {
      connectionAlias: aliases.connection,
      kind: "open_banking",
      observationFingerprint: fingerprint,
      observedAt: now,
      provider: OPEN_BANKING_PROVIDER,
      recordAlias: aliases.transaction,
    });
    return { canonicalChanged: canonical.changed, observationChanged };
  }

  async updateConnectionCounts(
    actor: Actor,
    counts: ReadonlyMap<string, Readonly<{ accounts: number; transactions: number }>>,
  ): Promise<void> {
    const owner = userId(actor);
    await Promise.all([...counts].map(([connectionAlias, value]) => this.collections.connections.updateOne(
      { userId: owner, connectionAlias, provider: OPEN_BANKING_PROVIDER },
      { $set: { accountCount: value.accounts, transactionCount: value.transactions, updatedAt: this.now() } },
    )));
  }

  async connectionById(actor: Actor, connectionId: string): Promise<ConnectionDocument | null> {
    return this.collections.connections.findOne({ _id: parseObjectId(connectionId), userId: userId(actor), provider: OPEN_BANKING_PROVIDER });
  }

  async markDisconnected(actor: Actor, connectionId: string, expectedVersion: number): Promise<void> {
    const owner = userId(actor);
    const now = this.now();
    const result = await this.collections.connections.updateOne(
      { _id: parseObjectId(connectionId), userId: owner, provider: OPEN_BANKING_PROVIDER, version: expectedVersion },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: "disconnected", actorUserId: owner, at: now, changedFields: ["status"], revision: expectedVersion + 1, source: "open_banking" } },
        $set: { status: "DISCONNECTED", updatedAt: now },
      },
    );
    if (result.modifiedCount !== 1) throw new ConflictError();
  }

  async recordRefresh(actor: Actor): Promise<void> {
    const owner = userId(actor);
    const binding = await this.collections.bindings.findOne({ userId: owner, provider: OPEN_BANKING_PROVIDER });
    if (binding === null) throw new UnauthorizedError();
    const now = this.now();
    await this.collections.bindings.updateOne(
      { _id: binding._id, userId: owner, version: binding.version },
      {
        $inc: { version: 1 },
        $push: { auditTrail: { action: "refresh_requested", actorUserId: owner, at: now, changedFields: [], revision: binding.version + 1, source: "open_banking" } },
        $set: { updatedAt: now },
      },
    );
  }

  async loadCenter(actor: Actor, subjectAlias: string, today: string): Promise<OpenBankingCenterView> {
    const owner = userId(actor);
    const [bound, connections, run, revisions] = await Promise.all([
      this.hasBinding(actor, subjectAlias),
      this.collections.connections.find({ userId: owner, provider: OPEN_BANKING_PROVIDER }).sort({ createdAt: 1 }).toArray(),
      this.collections.runs.findOne({ userId: owner, provider: OPEN_BANKING_PROVIDER }, { sort: { startedAt: -1, _id: -1 } }),
      this.collections.revisions.find({ userId: owner, provider: OPEN_BANKING_PROVIDER, recordKind: "account" }).sort({ recordAlias: 1, sequence: -1 }).limit(2_000).toArray(),
    ]);
    const latestAccounts = new Map<string, RecordRevisionDocument>();
    for (const revision of revisions) if (!latestAccounts.has(revision.recordAlias)) latestAccounts.set(revision.recordAlias, revision);
    const accounts: OpenBankingAccountView[] = [...latestAccounts.values()].flatMap((revision) => revision.account === undefined ? [] : [{
      balances: revision.account.balances.map((balance) => ({ amount: serializeMoney(fromStoredMoney(balance.amount)), referenceDate: balance.referenceDate, type: balance.type })),
      currency: revision.account.currency,
      displayName: revision.account.displayName,
      type: revision.account.accountType,
    }]);
    const connectionViews: OpenBankingConnectionView[] = connections.map((connection) => ({
      accountCount: connection.accountCount,
      consentExpiresOn: connection.expiryDate,
      freshness: freshness(connection.lastFetchedDataDate, today),
      id: connection._id.toHexString(),
      lastFetchedAt: connection.lastFetchedAt?.toISOString() ?? null,
      lastFetchedDataDate: connection.lastFetchedDataDate,
      mode: connection.mode,
      status: connection.status,
      transactionCount: connection.transactionCount,
      version: connection.version,
    }));
    return {
      accounts,
      bindingClaimed: bound,
      configured: true,
      connections: connectionViews,
      latestRun: run === null ? null : runView(run),
      policyVersion: OPEN_BANKING_POLICY_VERSION,
      provider: OPEN_BANKING_PROVIDER,
    };
  }
}

export function openBankingRepositoryForDatabase(
  database: Db,
  now?: () => Date,
): OpenBankingRepository {
  return new OpenBankingRepository({
    developmentMigrations: database.collection("bankDevelopmentMigrations"),
    accounts: database.collection<CanonicalRecordDocument>("accounts"),
    bindings: database.collection<BindingDocument>("bankProviderBindings"),
    connections: database.collection<ConnectionDocument>("bankConnections"),
    lifecycle: database.collection<LifecycleDocument>("bankLifecycleCommands"),
    revisions: database.collection<RecordRevisionDocument>("bankRecordRevisions"),
    runs: database.collection<SyncRunDocument>("bankSyncRuns"),
    transactions: database.collection<CanonicalRecordDocument>("transactions"),
  }, now);
}

export async function getOpenBankingRepository(): Promise<OpenBankingRepository> {
  const repository = openBankingRepositoryForDatabase(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
