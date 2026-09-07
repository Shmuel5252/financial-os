import "server-only";

import { type Db, MongoServerError, ObjectId } from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";
import { getDatabase } from "@/lib/db/mongodb";
import { ConflictError, NotFoundError } from "@/lib/errors/application-error";
import type { SafeAccountIdentity } from "@/lib/open-banking/account-identity";
import { bankAlias } from "@/lib/open-banking/account-identity";
import {
  ACCOUNT_RECONCILIATION_POLICY, ACCOUNT_RECONCILIATION_WORKFLOW,
  type AccountReconciliationCommand, type ReconciliationComparison,
} from "@/lib/open-banking/account-reconciliation";
import { OPEN_BANKING_PROVIDER } from "@/lib/open-banking/open-banking";

export type AccountIdentityReference = Readonly<{
  accountAlias: string;
  connectionAlias: string;
  institutionAlias: string;
  identity: SafeAccountIdentity | null;
  comparison: ReconciliationComparison;
}>;
type DecisionEvidence = Readonly<{
  requestKey: string;
  requestFingerprint: string;
  actorUserId: ObjectId;
  at: Date;
  decision: AccountReconciliationCommand["decision"];
  resultClass: "OWNER_ATTESTED" | "REJECTED" | "UNDETERMINED";
  source: "authenticated_owner";
  policyVersion: typeof ACCOUNT_RECONCILIATION_POLICY;
  workflowVersion: typeof ACCOUNT_RECONCILIATION_WORKFLOW;
  canonicalVersion: number;
  oldIdentity: AccountIdentityReference;
  newIdentity: AccountIdentityReference | null;
  matchingFields: readonly string[];
  ambiguityResolvedByOwner: boolean;
}>;
export type AccountReconciliationLedger = {
  _id: ObjectId;
  userId: ObjectId;
  provider: typeof OPEN_BANKING_PROVIDER;
  canonicalAccountId: ObjectId;
  aliases: string[];
  active: AccountIdentityReference | null;
  version: number;
  events: DecisionEvidence[];
};
export type LegacyAccountEvidence = Readonly<{
  id: string;
  version: number;
  accountAlias: string;
  connectionAlias: string;
  institutionAlias: string;
  institutionStatus: string;
  name: string;
  type: ReconciliationComparison["type"];
  currency: string;
  identity: SafeAccountIdentity | null;
}>;

export class AccountReconciliationRepository {
  constructor(private readonly database: Db, private readonly now: () => Date = () => new Date()) {}

  private get ledger() { return this.database.collection<AccountReconciliationLedger>("bankAccountReconciliations"); }

  async ensureIndexes() {
    await this.ledger.createIndex({ userId: 1, provider: 1, canonicalAccountId: 1 },
      { unique: true, name: "bank_reconciliation_owner_canonical_unique" });
    await this.ledger.createIndex({ userId: 1, provider: 1, aliases: 1 },
      { unique: true, name: "bank_reconciliation_owner_alias_unique" });
    await this.ledger.createIndex({ userId: 1, provider: 1, "events.requestKey": 1 },
      { unique: true, name: "bank_reconciliation_owner_request_unique" });
  }

  async listLedgers(actor: Actor) {
    return this.ledger.find({ userId: parseObjectId(actor.userId), provider: OPEN_BANKING_PROVIDER }).limit(501).toArray();
  }

  async isRecordedRequest(actor: Actor, command: AccountReconciliationCommand): Promise<boolean> {
    const requestKey = bankAlias("account-review-request", command.idempotencyKey);
    const ledger = await this.ledger.findOne({ userId: parseObjectId(actor.userId), provider: OPEN_BANKING_PROVIDER, "events.requestKey": requestKey });
    const event = ledger?.events.find((item) => item.requestKey === requestKey);
    if (event === undefined) return false;
    if (event.requestFingerprint !== bankAlias("account-review-command", JSON.stringify(command))) throw new ConflictError();
    return true;
  }

  async listLegacyAccounts(actor: Actor): Promise<LegacyAccountEvidence[]> {
    const userId = parseObjectId(actor.userId);
    const accounts = await this.database.collection("accounts").find({
      userId, "source.kind": "open_banking", "source.provider": OPEN_BANKING_PROVIDER, deletedAt: null,
    }).limit(501).toArray();
    if (accounts.length > 500) throw new ConflictError("Account review requires a bounded scope.");
    const result: LegacyAccountEvidence[] = [];
    for (const account of accounts) {
      const source = account.source as { recordAlias: string; connectionAlias: string };
      const [connection, revision] = await Promise.all([
        this.database.collection("bankConnections").findOne({ userId, provider: OPEN_BANKING_PROVIDER, connectionAlias: source.connectionAlias }),
        this.database.collection("bankRecordRevisions").findOne({
          userId, provider: OPEN_BANKING_PROVIDER, recordKind: "account", recordAlias: source.recordAlias,
        }, { sort: { sequence: -1 } }),
      ]);
      if (connection === null || revision?.account === undefined) throw new ConflictError("Historical account evidence is incomplete.");
      const prior = revision.account as { accountType: ReconciliationComparison["type"]; displayName: string; currency: string; identity?: SafeAccountIdentity };
      result.push({ id: account._id.toHexString(), version: account.version as number,
        accountAlias: source.recordAlias, connectionAlias: source.connectionAlias,
        institutionAlias: connection.providerAlias as string, institutionStatus: connection.status as string,
        name: prior.displayName, type: prior.accountType, currency: prior.currency, identity: prior.identity ?? null });
    }
    return result;
  }

  async recordDecision(actor: Actor, input: Readonly<{
    legacy: LegacyAccountEvidence;
    expectedVersion: number;
    oldIdentity: AccountIdentityReference;
    newIdentity: AccountIdentityReference | null;
    command: AccountReconciliationCommand;
  }>): Promise<void> {
    const userId = parseObjectId(actor.userId);
    const canonicalAccountId = parseObjectId(input.legacy.id);
    const canonical = await this.database.collection("accounts").findOne({
      _id: canonicalAccountId, userId, version: input.legacy.version, deletedAt: null,
      "source.kind": "open_banking", "source.provider": OPEN_BANKING_PROVIDER,
      "source.recordAlias": input.legacy.accountAlias, "source.connectionAlias": input.legacy.connectionAlias,
    });
    if (canonical === null) throw new NotFoundError();
    const filter = { userId, provider: OPEN_BANKING_PROVIDER, canonicalAccountId };
    const existing = await this.ledger.findOne(filter);
    const requestKey = bankAlias("account-review-request", input.command.idempotencyKey);
    const requestFingerprint = bankAlias("account-review-command", JSON.stringify(input.command));
    const prior = existing?.events.find((event) => event.requestKey === requestKey);
    if (prior !== undefined) {
      if (prior.requestFingerprint !== requestFingerprint) throw new ConflictError();
      return;
    }
    if ((existing?.version ?? 0) !== input.expectedVersion || (existing?.events.length ?? 0) >= 500) throw new ConflictError();
    if (existing?.active !== null && existing?.active !== undefined &&
      existing.active.accountAlias !== input.oldIdentity.accountAlias) throw new ConflictError();
    if (input.command.decision === "same_account" && (input.newIdentity === null || !input.command.confirmation)) throw new ConflictError();
    if (input.newIdentity !== null) {
      // A new alias already present in canonical truth cannot be silently merged.
      const other = await this.database.collection("accounts").findOne({
        userId, "source.kind": "open_banking", "source.provider": OPEN_BANKING_PROVIDER,
        "source.recordAlias": input.newIdentity.accountAlias, _id: { $ne: canonicalAccountId },
      }, { projection: { _id: 1 } });
      if (other !== null) throw new ConflictError();
    }
    const confirmed = input.command.decision === "same_account";
    const event: DecisionEvidence = {
      requestKey, requestFingerprint, actorUserId: userId, at: this.now(), decision: input.command.decision,
      resultClass: confirmed ? "OWNER_ATTESTED" : input.command.decision === "not_same" ? "REJECTED" : "UNDETERMINED",
      source: "authenticated_owner", policyVersion: ACCOUNT_RECONCILIATION_POLICY, workflowVersion: ACCOUNT_RECONCILIATION_WORKFLOW,
      canonicalVersion: input.legacy.version, oldIdentity: input.oldIdentity, newIdentity: input.newIdentity,
      matchingFields: confirmed ? ["owner_attestation", "institution", "account_type", "currency", "displayed_comparison"] : ["displayed_comparison"],
      ambiguityResolvedByOwner: confirmed,
    };
    const aliases = [input.oldIdentity.accountAlias];
    if (confirmed && input.newIdentity !== null) aliases.push(input.newIdentity.accountAlias);
    try {
      if (existing === null) {
        await this.ledger.insertOne({ _id: new ObjectId(), ...filter, aliases,
          active: confirmed ? input.newIdentity : null, events: [event], version: 1 });
      } else {
        const updated = await this.ledger.updateOne({ ...filter, version: input.expectedVersion }, {
          $inc: { version: 1 }, $push: { events: event }, $addToSet: { aliases: { $each: aliases } },
          ...(confirmed ? { $set: { active: input.newIdentity } } : {}),
        });
        if (updated.modifiedCount !== 1) throw new ConflictError();
      }
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ConflictError("The account identity is already assigned or changed concurrently.");
      throw error;
    }
  }
}

export async function getAccountReconciliationRepository() {
  const repository = new AccountReconciliationRepository(await getDatabase());
  await repository.ensureIndexes();
  return repository;
}
