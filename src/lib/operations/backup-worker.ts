/** Backup worker core (A): one run = sign-and-mirror the ledger, then one snapshot capture of the application database.
 * Environment-free: the Lambda entry resolves secrets from SSM into `secrets`; local rehearsals pass synthetic ones.
 * Fails closed on missing/invalid configuration before any connection or upload.
 */
import "server-only";
import type { MongoClient } from "mongodb";
import { captureBackup, type BackupObjectStore } from "@/lib/operations/backup-capture";
import type { LedgerEnvironment } from "@/lib/operations/deletion-ledger";
import { secureMongoUri } from "@/lib/operations/deletion-ledger-runtime";
import { DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";
import { assertSeparateMirrorKeys, mirrorLedger } from "@/lib/operations/ledger-mirror";
import { parseRecoveryKeyring } from "@/lib/operations/recovery-keys";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

export const BACKUP_SECRET_NAMES = ["FINANCIAL_OS_BACKUP_APP_DB_URI", "FINANCIAL_OS_LEDGER_READ_URI"] as const;
export type BackupWorkerInput = Readonly<{
  /** Resolved secret values: package keys (FINANCIAL_OS_RECOVERY_PACKAGE_KEY_V<n> + _ACTIVE_VERSION), ledger keys
   * (FINANCIAL_OS_DELETION_LEDGER_KEY_V<n> + _ACTIVE_VERSION; verify receipts), mirror keys (FINANCIAL_OS_LEDGER_MIRROR_KEY_V<n>
   * + _ACTIVE_VERSION; sign the mirror, never equal to a ledger key), and the two read-only database URIs. Never logged. */
  secrets: Readonly<Record<string, string | undefined>>;
  environment: LedgerEnvironment; appDatabase: string; ledgerDatabase: string; indexManifestDigest: string;
  connect: (uri: string) => Promise<MongoClient>;
  store: BackupObjectStore;
  /** Emitted only after both objects are stored; `ledgerHead` is the mirrored head (an independent lower bound for rebuilds). */
  recordSuccess: (result: Readonly<{ ledgerHead: number }>) => Promise<void>;
  now: () => number; maxDurationMs: number;
}>;

const fail = (reason: string): never => { throw new Error(`Backup worker failed closed: ${reason}`); };

export async function runBackupWorker(input: BackupWorkerInput) {
  if (!/^[a-f0-9]{64}$/.test(input.indexManifestDigest) || !/^[A-Za-z0-9_-]{1,63}$/.test(input.appDatabase)
    || !/^[A-Za-z0-9_-]{1,63}$/.test(input.ledgerDatabase) || input.appDatabase === input.ledgerDatabase) return fail("configuration");
  let packageKeys: ReturnType<typeof parseRecoveryKeyring>; let ledgerKeys: ReturnType<typeof parseRecoveryKeyring>;
  let mirrorKeys: ReturnType<typeof parseRecoveryKeyring>;
  try {
    packageKeys = parseRecoveryKeyring(input.secrets, "FINANCIAL_OS_RECOVERY_PACKAGE_KEY");
    ledgerKeys = parseRecoveryKeyring(input.secrets, "FINANCIAL_OS_DELETION_LEDGER_KEY");
    mirrorKeys = parseRecoveryKeyring(input.secrets, "FINANCIAL_OS_LEDGER_MIRROR_KEY");
    assertSeparateMirrorKeys(ledgerKeys.keys, mirrorKeys.keys);
  } catch { return fail("keys"); }
  const [appUri, ledgerUri] = BACKUP_SECRET_NAMES.map(name => input.secrets[name] ?? fail("database URI missing"));
  if (![appUri!, ledgerUri!].every(uri => secureMongoUri(uri, input.environment !== "production"))) return fail("database URI must require TLS");
  const clients: MongoClient[] = [];
  try {
    const ledgerClient = await input.connect(ledgerUri!); clients.push(ledgerClient);
    const appClient = await input.connect(appUri!); clients.push(appClient);
    // Read-only use of the ledger: snapshot for the mirror and the head recorded in the package.
    const ledger = new DeletionReceiptStore(ledgerClient.db(input.ledgerDatabase), input.environment, ledgerKeys, input.now);
    const mirror = await mirrorLedger({ ledger, store: input.store, environment: input.environment, key: mirrorKeys.active });
    const capture = await captureBackup({ client: appClient, databaseName: input.appDatabase, schemas: initialRecoverySchemas,
      indexManifestDigest: input.indexManifestDigest, key: packageKeys.active, ledgerHead: async () => (await ledger.snapshot()).head,
      store: input.store, now: input.now, maxDurationMs: input.maxDurationMs });
    await input.recordSuccess({ ledgerHead: mirror.head });
    return { package: capture.name, atClusterTime: capture.atClusterTime, ledgerHead: capture.ledgerHead, mirror: mirror.name } as const;
  } finally { await Promise.all(clients.map(client => client.close().catch(() => undefined))); }
}
