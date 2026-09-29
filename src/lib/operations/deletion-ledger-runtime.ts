/** Runtime access to the independent deletion ledger (B1), behind configuration. No configuration at all means no ledger
 * exists yet (outside production) — and therefore no erasure can have happened; any partial or invalid configuration, or
 * production without a ledger, fails closed. Connection errors surface as "Deletion ledger unavailable".
 *
 * Authentication: a SCRAM user in the URI, or AWS IAM (`authMechanism=MONGODB-AWS`, never with a secret in the URI). With
 * `FINANCIAL_OS_LEDGER_AWS_ROLE_ARN` the app exchanges its Vercel OIDC token for short-lived role credentials (STS
 * AssumeRoleWithWebIdentity) and rotates the client before they expire; without it the driver uses the runtime's AWS
 * credentials (e.g. the Lambda role). Enabling IAM needs the driver's optional `aws4` module and a Vercel OIDC token source
 * (not installed yet); until then an IAM configuration fails closed as "unavailable".
 */
import "server-only";
import { MongoClient } from "mongodb";
import { ConfigurationError } from "@/lib/errors/application-error";
import { DeletionReceiptStore } from "@/lib/operations/deletion-receipt-store";
import { parseRecoveryKeyring } from "@/lib/operations/recovery-keys";

const names = { uri: "FINANCIAL_OS_LEDGER_MONGODB_URI", database: "FINANCIAL_OS_LEDGER_DATABASE", keyPrefix: "FINANCIAL_OS_DELETION_LEDGER_KEY",
  roleArn: "FINANCIAL_OS_LEDGER_AWS_ROLE_ARN", region: "FINANCIAL_OS_LEDGER_AWS_REGION" } as const;
export type LedgerAuth = Readonly<{ kind: "uri" }> | Readonly<{ kind: "aws-runtime" }> | Readonly<{ kind: "aws-web-identity"; roleArn: string; region: string }>;
export type DeletionLedgerConfig = Readonly<{ configured: false }> | Readonly<{ configured: true; uri: string; database: string;
  environment: "staging" | "production"; keyring: ReturnType<typeof parseRecoveryKeyring>; auth: LedgerAuth }>;

const invalid = () => new ConfigurationError("The deletion ledger configuration is incomplete or invalid.");
const loopback = (url: URL) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

/** A MongoDB URI that cannot connect without verified TLS: SRV (implies TLS) or `tls=true`, with no option switching TLS or
 * certificate/hostname verification off (case-insensitive, as the driver parses them). Loopback without TLS only when allowed. */
export function secureMongoUri(uri: string, allowLoopback: boolean): boolean {
  let url: URL; try { url = new URL(uri); } catch { return false; }
  const option = (name: string) => [...url.searchParams].filter(([key]) => key.toLowerCase() === name.toLowerCase()).map(([, value]) => value.toLowerCase());
  if (option("tls").includes("false") || option("ssl").includes("false")) return false;
  if (["tlsInsecure", "tlsAllowInvalidCertificates", "tlsAllowInvalidHostnames"].some(name => option(name).includes("true"))) return false;
  // AWS IAM authentication never carries a long-lived secret in the URI.
  if (option("authMechanism").includes("mongodb-aws") && url.password !== "") return false;
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
  const iam = new URL(uri).searchParams.get("authMechanism")?.toUpperCase() === "MONGODB-AWS";
  const roleArn = env[names.roleArn]; const region = env[names.region] || "eu-central-1";
  if (present(names.roleArn) && (!iam || !/^arn:aws[a-z-]*:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]{1,128}$/.test(roleArn!))) throw invalid();
  if (!/^[a-z]{2}(-[a-z]+)+-[0-9]$/.test(region)) throw invalid();
  const auth: LedgerAuth = !iam ? { kind: "uri" } : present(names.roleArn) ? { kind: "aws-web-identity", roleArn: roleArn!, region } : { kind: "aws-runtime" };
  return { configured: true, uri, database, environment, keyring, auth };
}

export type AwsCredentials = Readonly<{ accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: number }>;
/** STS AssumeRoleWithWebIdentity (an unsigned call: the OIDC token is the proof). No SDK; nothing from the response is logged. */
export async function assumeRoleWithWebIdentity(input: Readonly<{ roleArn: string; region: string; token: string;
  fetch?: typeof fetch }>): Promise<AwsCredentials> {
  const body = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: input.roleArn,
    RoleSessionName: "financial-os-ledger", WebIdentityToken: input.token, DurationSeconds: "900" });
  let text: string;
  try {
    const response = await (input.fetch ?? fetch)(`https://sts.${input.region}.amazonaws.com/`, { method: "POST", body,
      headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    text = await response.text();
  } catch { throw new Error("Deletion ledger unavailable"); }
  const field = (name: string) => /^[A-Za-z0-9+/=:._-]+$/.exec(new RegExp(`<${name}>([^<]+)</${name}>`).exec(text)?.[1] ?? "")?.[0];
  const accessKeyId = field("AccessKeyId"); const secretAccessKey = field("SecretAccessKey"); const sessionToken = field("SessionToken");
  const expiration = Date.parse(field("Expiration") ?? "");
  if (!accessKeyId || !secretAccessKey || !sessionToken || !Number.isFinite(expiration)) throw new Error("Deletion ledger unavailable");
  return { accessKeyId, secretAccessKey, sessionToken, expiration };
}

export type LedgerRuntime = Readonly<{ env?: Readonly<Record<string, string | undefined>>; now?: () => number; fetch?: typeof fetch;
  /** Vercel OIDC token source (e.g. `getVercelOidcToken` from `@vercel/oidc`, read per request); defaults to VERCEL_OIDC_TOKEN. */
  webIdentityToken?: () => Promise<string | undefined> }>;
type Current = Readonly<{ store: DeletionReceiptStore; client: MongoClient; expiresAt: number }> | null;
let current: Current | undefined; let pending: Promise<Current> | undefined;
const renewBeforeMs = 5 * 60_000;

/** The configured ledger store, or null when no ledger is configured (non-production only). IAM clients are replaced before
 * their credentials expire; the previous client is closed after a grace period so in-flight operations can finish. */
export async function getDeletionLedger(runtime: LedgerRuntime = {}): Promise<DeletionReceiptStore | null> {
  const now = runtime.now ?? Date.now;
  if (current !== undefined && (current === null || now() < current.expiresAt)) return current?.store ?? null;
  pending ??= (async (): Promise<Current> => {
    const config = deletionLedgerConfig(runtime.env);
    if (!config.configured) { current = null; return null; }
    // Small pool: each serverless instance holds its own, and a Free/Flex ledger allows 500 connections in total.
    const options = { serverSelectionTimeoutMS: 5000, maxPoolSize: 5 };
    let client: MongoClient; let expiresAt = Number.POSITIVE_INFINITY;
    if (config.auth.kind === "aws-web-identity") {
      const token = await (runtime.webIdentityToken ?? (async () => (runtime.env ?? process.env).VERCEL_OIDC_TOKEN))();
      if (!token) throw new Error("Deletion ledger unavailable");
      const credentials = await assumeRoleWithWebIdentity({ roleArn: config.auth.roleArn, region: config.auth.region, token, ...(runtime.fetch ? { fetch: runtime.fetch } : {}) });
      client = new MongoClient(config.uri, { ...options, auth: { username: credentials.accessKeyId, password: credentials.secretAccessKey },
        authMechanismProperties: { AWS_SESSION_TOKEN: credentials.sessionToken } });
      expiresAt = credentials.expiration - renewBeforeMs;
    } else client = new MongoClient(config.uri, options);
    const next = { store: new DeletionReceiptStore(client.db(config.database), config.environment, config.keyring), client, expiresAt };
    // Swap exactly once, inside the shared promise: concurrent callers must never close the client they are about to use.
    const previous = current; current = next;
    if (previous) setTimeout(() => { void previous.client.close().catch(() => undefined); }, 60_000).unref?.();
    return next;
  })().finally(() => { pending = undefined; });
  const next = await pending;
  return next?.store ?? null;
}

/** Test/operator reset of the process-wide handle (closes the current client). */
export async function resetDeletionLedger() {
  const previous = current; current = undefined; pending = undefined;
  await previous?.client.close().catch(() => undefined);
}
