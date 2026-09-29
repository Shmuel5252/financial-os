/** Runtime access to the independent deletion ledger (B1), behind configuration. No configuration at all means no ledger
 * exists yet (outside production) — and therefore no erasure can have happened; any partial or invalid configuration, or
 * production without a ledger, fails closed. Connection errors surface as "Deletion ledger unavailable".
 */
import "server-only";
import { MongoClient } from "mongodb";
import { ConfigurationError } from "@/lib/errors/application-error";
import { DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";
import { parseRecoveryKeyring } from "@/lib/operations/recovery-keys";

const names = { uri: "FINANCIAL_OS_LEDGER_MONGODB_URI", database: "FINANCIAL_OS_LEDGER_DATABASE", keyPrefix: "FINANCIAL_OS_DELETION_LEDGER_KEY" } as const;
export type DeletionLedgerConfig = Readonly<{ configured: false }> | Readonly<{ configured: true; uri: string; database: string;
  environment: "staging" | "production"; keyring: ReturnType<typeof parseRecoveryKeyring> }>;

const invalid = () => new ConfigurationError("The deletion ledger configuration is incomplete or invalid.");
const loopback = (url: URL) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

/** A MongoDB URI that cannot connect without verified TLS: SRV (implies TLS) or `tls=true`, with no option switching TLS or
 * certificate/hostname verification off (case-insensitive, as the driver parses them). Loopback without TLS only when allowed. */
export function secureMongoUri(uri: string, allowLoopback: boolean): boolean {
  let url: URL; try { url = new URL(uri); } catch { return false; }
  const option = (name: string) => [...url.searchParams].filter(([key]) => key.toLowerCase() === name.toLowerCase()).map(([, value]) => value.toLowerCase());
  if (option("tls").includes("false") || option("ssl").includes("false")) return false;
  if (["tlsInsecure", "tlsAllowInvalidCertificates", "tlsAllowInvalidHostnames"].some(name => option(name).includes("true"))) return false;
  if (url.protocol === "mongodb+srv:") return true;
  return url.protocol === "mongodb:" && ((allowLoopback && loopback(url)) || option("tls").includes("true") || option("ssl").includes("true"));
}

export function deletionLedgerConfig(env: Readonly<Record<string, string | undefined>> = process.env): DeletionLedgerConfig {
  const present = (name: string) => env[name] !== undefined && env[name] !== "";
  const any = present(names.uri) || present(names.database) || Object.keys(env).some(name => name.startsWith(names.keyPrefix) && present(name));
  const environment = env.FINANCIAL_OS_ENVIRONMENT;
  if (!any) { if (environment === "production") throw invalid(); return { configured: false }; }
  if (environment !== "staging" && environment !== "production") throw invalid();
  const uri = env[names.uri]; const database = env[names.database];
  if (uri === undefined || database === undefined || !/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw invalid();
  // TLS is mandatory; a loopback ledger (local development) is never accepted in production.
  if (!secureMongoUri(uri, environment !== "production")) throw invalid();
  let keyring: ReturnType<typeof parseRecoveryKeyring>; try { keyring = parseRecoveryKeyring(env, names.keyPrefix); } catch { throw invalid(); }
  return { configured: true, uri, database, environment, keyring };
}

let cached: Promise<DeletionReceiptStore | null> | undefined;
/** The configured ledger store, or null when no ledger is configured (non-production only). */
export function getDeletionLedger(): Promise<DeletionReceiptStore | null> {
  cached ??= (async () => {
    const config = deletionLedgerConfig();
    if (!config.configured) return null;
    // Small pool: each serverless instance holds its own, and a Flex ledger allows 500 connections in total.
    const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5 });
    return new DeletionReceiptStore(client.db(config.database), config.environment, config.keyring);
  })().catch(error => { cached = undefined; throw error; });
  return cached;
}
