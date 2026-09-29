/** Offline restore-drill CLI (runbook S11). Reads a local copy of the bucket (e.g. `aws s3 sync` with the restore-operator
 * role), restores into a loopback-only replica set and runs the release fence. Prints counts, barriers and timings only.
 * `--listing` is the JSON of `aws s3api list-objects-v2` taken right after the sync; a local copy that differs is refused.
 * Usage: node .build/restore-drill/index.mjs --store <directory> --listing <file> [--package packages/<name>.bson] [--keep]
 */
import { MongoClient } from "mongodb";
import { secureMongoUri } from "@/lib/operations/deletion-ledger-runtime";
import { DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";
import { readFileSync } from "node:fs";
import { listedDirectoryObjectStore } from "@/lib/operations/object-stores";
import { parseRecoveryKeyring } from "@/lib/operations/recovery-keys";
import { runRestoreDrill } from "@/lib/operations/restore-drill";

declare const __INDEX_MANIFEST_DIGEST__: string;

const argument = (name: string) => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Restore drill: ${name} missing`); return value; };

async function main() {
  const environment = required("FINANCIAL_OS_ENVIRONMENT");
  if (environment !== "staging" && environment !== "production") throw new Error("Restore drill: environment");
  const storeDirectory = argument("--store") ?? (() => { throw new Error("Restore drill: --store missing"); })();
  const packageKeys = parseRecoveryKeyring(process.env, "FINANCIAL_OS_RECOVERY_PACKAGE_KEY");
  const ledgerKeys = parseRecoveryKeyring(process.env, "FINANCIAL_OS_DELETION_LEDGER_KEY");
  const mirrorKeys = parseRecoveryKeyring(process.env, "FINANCIAL_OS_LEDGER_MIRROR_KEY");
  const ledgerUri = required("FINANCIAL_OS_LEDGER_READ_URI");
  if (!secureMongoUri(ledgerUri, environment !== "production")) throw new Error("Restore drill: ledger URI must require TLS");
  const ledgerClient = new MongoClient(ledgerUri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const ledger = new DeletionReceiptStore(ledgerClient.db(required("FINANCIAL_OS_LEDGER_DATABASE")), environment, ledgerKeys);
    const listing = argument("--listing") ?? (() => { throw new Error("Restore drill: --listing missing"); })();
    const store = listedDirectoryObjectStore(storeDirectory, readFileSync(listing, "utf8")); const packageName = argument("--package");
    const result = await runRestoreDrill({ ledger, environment, ledgerKeys: ledgerKeys.keys, mirrorKeys: mirrorKeys.keys, stateKey: ledgerKeys.active, mirror: store,
      maxLedgerAgeMs: Number(process.env.FINANCIAL_OS_RESTORE_MAX_LEDGER_AGE_MS ?? 300_000), now: () => Date.now(), store,
      targetUri: required("RESTORE_TARGET_URI"), packageKey: packageKeys.active, indexManifestDigest: __INDEX_MANIFEST_DIGEST__,
      keepTarget: process.argv.includes("--keep"), ...(packageName ? { packageName } : {}) });
    console.log(JSON.stringify(result, null, 2));
  } finally { await ledgerClient.close(); }
}

main().then(() => process.exit(0), (error: unknown) => {
  // Messages are fixed categories; no key, URI or record is ever part of them.
  console.error(error instanceof Error ? error.message : "Restore drill failed");
  process.exit(1);
});
