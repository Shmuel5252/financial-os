/** Offline ledger rebuild (runbook "Ledger disaster recovery"). Reads a local copy of the bucket (mirrors + journal, e.g. `aws s3
 * sync` with the restore-operator role), proves one ledger state from it and writes that state into a fresh, empty ledger database.
 * `--listing` is the JSON of `aws s3api list-objects-v2` taken right after the sync: a local copy that differs is refused, so a
 * truncated copy can never pass as complete. `--expect-head` (e.g. the latest `LedgerHead` metric) is a lower bound the plan must reach.
 * `--plan` only verifies and prints the plan. Prints head, counts, evidence names and a digest; never a receipt or a key.
 * Usage: node .build/ledger-rebuild/index.mjs --store <directory> --listing <file> [--expect-head <n>] [--plan]
 */
import { MongoClient } from "mongodb";
import { secureMongoUri } from "@/lib/operations/deletion-ledger-runtime";
import { readFileSync } from "node:fs";
import { listedDirectoryObjectStore } from "@/lib/operations/object-stores";
import { planLedgerRebuild, rebuildLedger } from "@/lib/operations/ledger-rebuild";
import { parseRecoveryKeyring } from "@/lib/operations/recovery-keys";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Ledger rebuild: ${name} missing`); return value; };

async function main() {
  const environment = required("FINANCIAL_OS_ENVIRONMENT");
  if (environment !== "staging" && environment !== "production") throw new Error("Ledger rebuild: environment");
  const directory = argument("--store") ?? (() => { throw new Error("Ledger rebuild: --store missing"); })();
  const listing = argument("--listing") ?? (() => { throw new Error("Ledger rebuild: --listing missing"); })();
  const store = listedDirectoryObjectStore(directory, readFileSync(listing, "utf8"));
  const expectHead = argument("--expect-head");
  if (expectHead !== undefined && !/^[0-9]{1,15}$/.test(expectHead)) throw new Error("Ledger rebuild: --expect-head");
  const minimumHead = expectHead === undefined ? 0 : Number(expectHead);
  const ledgerKeys = parseRecoveryKeyring(process.env, "FINANCIAL_OS_DELETION_LEDGER_KEY").keys;
  const mirrorKeys = parseRecoveryKeyring(process.env, "FINANCIAL_OS_LEDGER_MIRROR_KEY").keys;
  const summary = (plan: Awaited<ReturnType<typeof planLedgerRebuild>>) => ({ head: plan.head, rows: plan.rows.length, digest: plan.digest,
    baseMirror: plan.baseMirror, baseHead: plan.baseHead, mirrors: plan.mirrors, journalApplied: plan.journalApplied });
  if (process.argv.includes("--plan")) { console.log(JSON.stringify(summary(await planLedgerRebuild({ store, environment, ledgerKeys, mirrorKeys, minimumHead })), null, 2)); return; }
  const uri = required("LEDGER_REBUILD_TARGET_URI"); const database = required("LEDGER_REBUILD_TARGET_DATABASE");
  if (!secureMongoUri(uri, environment !== "production") || !/^[A-Za-z0-9_-]{1,38}$/.test(database)) throw new Error("Ledger rebuild: target must require TLS");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try { console.log(JSON.stringify(summary(await rebuildLedger({ store, environment, ledgerKeys, mirrorKeys, minimumHead, target: client.db(database) })), null, 2)); }
  finally { await client.close(); }
}

main().then(() => process.exit(0), (error: unknown) => {
  // Messages are fixed categories; no key, URI or record is ever part of them.
  console.error(error instanceof Error ? error.message : "Ledger rebuild failed");
  process.exit(1);
});
