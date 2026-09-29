/** Isolated restore drill (runbook S11): newest package → fresh loopback-only target → quarantine restore → release fence.
 * Reports counts, timings and inspector barriers only — never record contents. The target is dropped unless kept.
 */
import "server-only";
import type { Document } from "mongodb";
import type { BackupObjectStore } from "@/lib/operations/backup-capture";
import { ensureApplicationIndexes } from "@/lib/operations/application-indexes";
import { inspectBankControlRecovery } from "@/lib/operations/bank-control-recovery";
import { inspectBankRecordRecovery } from "@/lib/operations/bank-record-recovery";
import { inspectBankDevelopmentRecovery } from "@/lib/operations/bank-development-recovery";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { releaseFence, restoreIntoQuarantine, type LedgerInput } from "@/lib/operations/restore-orchestration";

type Key = Readonly<{ version: number; material: Uint8Array }>;

export async function runRestoreDrill(input: LedgerInput & Readonly<{ store: BackupObjectStore; targetUri: string; packageKey: Key;
  indexManifestDigest: string; packageName?: string; keepTarget?: boolean }>) {
  const started = input.now();
  const packages = await input.store.list("packages/");
  const name = input.packageName ?? packages[packages.length - 1] ?? (() => { throw new Error("Restore drill: no package available"); })();
  const target = await createIsolatedRecoveryTarget(input.targetUri);
  try {
    const restored = await restoreIntoQuarantine({ ...input, store: input.store, name, schemas: initialRecoverySchemas,
      indexManifestDigest: input.indexManifestDigest, packageKey: input.packageKey, target: target.database, ensureIndexes: ensureApplicationIndexes });
    const restoredAt = input.now();
    const fence = await releaseFence({ ...input, target: target.database });
    const fencedAt = input.now();
    const rows = async (collection: string) => target.database.collection(collection).find().toArray() as Promise<Document[]>;
    const barriers = {
      bankControl: inspectBankControlRecovery({ bindings: await rows("bankProviderBindings"), connections: await rows("bankConnections"),
        runs: await rows("bankSyncRuns"), lifecycle: await rows("bankLifecycleCommands") }).unresolved,
      bankRecords: inspectBankRecordRecovery({ connections: await rows("bankConnections"), revisions: await rows("bankRecordRevisions"),
        accounts: await rows("accounts"), transactions: await rows("transactions"), reconciliations: await rows("bankAccountReconciliations") }).unresolved,
      development: inspectBankDevelopmentRecovery({ migrations: await rows("bankDevelopmentMigrations"), connections: await rows("bankConnections"),
        revisions: await rows("bankRecordRevisions"), accounts: await rows("accounts"), transactions: await rows("transactions") }).unresolved,
    };
    return { package: name, recoveryPoint: restored.recoveryPoint, ledgerHead: restored.ledgerHead, counts: restored.counts,
      fence, barriers, releaseAllowed: false as const,
      timings: { restoreMs: restoredAt - started, fenceMs: fencedAt - restoredAt, totalMs: fencedAt - started,
        recoveryPointAgeMs: started - restored.recoveryPoint.capturedAt } } as const;
  } finally { if (!input.keepTarget) await target.dispose(); }
}
