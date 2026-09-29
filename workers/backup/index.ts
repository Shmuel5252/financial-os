/** AWS Lambda entry for the backup worker (runbook S7). Uses the AWS SDK v3 provided by the Lambda Node.js runtime
 * (not bundled, no repository dependency). Secrets come only from SSM SecureString parameters under FINANCIAL_OS_SSM_PREFIX;
 * nothing secret is logged or returned.
 */
import { MongoClient } from "mongodb";
import type { LedgerEnvironment } from "@/lib/operations/deletion-ledger";
import { runBackupWorker } from "@/lib/operations/backup-worker";
import { s3ObjectStore, type S3Client } from "@/lib/operations/object-stores";

declare const __INDEX_MANIFEST_DIGEST__: string;

type Command = new (input: Record<string, unknown>) => unknown;
type Client = Readonly<{ send: (command: unknown) => Promise<Record<string, unknown>> }>;
type Sdk = Readonly<Record<string, unknown>>;
const load = (name: string) => import(/* @vite-ignore */ name) as Promise<Sdk>;
const client = (sdk: Sdk, name: string, region: string) => new (sdk[name] as new (input: Record<string, unknown>) => Client)({ region });
const command = (sdk: Sdk, name: string, input: Record<string, unknown>) => new (sdk[name] as Command)(input);
const env = (name: string) => { const value = process.env[name]; if (value === undefined || value === "") throw new Error(`Backup worker failed closed: ${name} missing`); return value; };

/** `<prefix>/backup/app-db-uri`, `<prefix>/ledger/read-uri`, `<prefix>/backup/package-key-v<n>`, `…/package-key-active-version`,
 * `<prefix>/ledger/key-v<n>`, `<prefix>/ledger/key-active-version`, `<prefix>/ledger/mirror-key-v<n>`,
 * `<prefix>/ledger/mirror-key-active-version` → worker secret names. Unknown parameters are ignored. */
export function mapParameters(prefix: string, parameters: readonly Readonly<{ Name?: unknown; Value?: unknown }>[]): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const parameter of parameters) {
    if (typeof parameter.Name !== "string" || typeof parameter.Value !== "string" || !parameter.Name.startsWith(`${prefix}/`)) continue;
    const path = parameter.Name.slice(prefix.length + 1);
    const packageKey = /^backup\/package-key-v([1-9][0-9]{0,5})$/.exec(path); const ledgerKey = /^ledger\/key-v([1-9][0-9]{0,5})$/.exec(path);
    const mirrorKey = /^ledger\/mirror-key-v([1-9][0-9]{0,5})$/.exec(path);
    const name = path === "backup/app-db-uri" ? "FINANCIAL_OS_BACKUP_APP_DB_URI" : path === "ledger/read-uri" ? "FINANCIAL_OS_LEDGER_READ_URI"
      : path === "backup/package-key-active-version" ? "FINANCIAL_OS_RECOVERY_PACKAGE_KEY_ACTIVE_VERSION"
        : path === "ledger/key-active-version" ? "FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION"
          : path === "ledger/mirror-key-active-version" ? "FINANCIAL_OS_LEDGER_MIRROR_KEY_ACTIVE_VERSION"
            : mirrorKey ? `FINANCIAL_OS_LEDGER_MIRROR_KEY_V${mirrorKey[1]}`
          : packageKey ? `FINANCIAL_OS_RECOVERY_PACKAGE_KEY_V${packageKey[1]}` : ledgerKey ? `FINANCIAL_OS_DELETION_LEDGER_KEY_V${ledgerKey[1]}` : undefined;
    if (name !== undefined) secrets[name] = parameter.Value;
  }
  return secrets;
}

export async function handler() {
  const region = env("AWS_REGION"); const prefix = env("FINANCIAL_OS_SSM_PREFIX"); const bucket = env("FINANCIAL_OS_BACKUP_BUCKET");
  const environment = env("FINANCIAL_OS_ENVIRONMENT");
  if (environment !== "staging" && environment !== "production") throw new Error("Backup worker failed closed: environment");
  const kmsKeyId = process.env.FINANCIAL_OS_BACKUP_KMS_KEY_ID;
  const [s3, ssm, cloudwatch] = await Promise.all([load("@aws-sdk/client-s3"), load("@aws-sdk/client-ssm"), load("@aws-sdk/client-cloudwatch")]);
  const ssmClient = client(ssm, "SSMClient", region); const s3Client = client(s3, "S3Client", region); const metrics = client(cloudwatch, "CloudWatchClient", region);
  const parameters: Record<string, unknown>[] = []; let token: string | undefined;
  do {
    const page = await ssmClient.send(command(ssm, "GetParametersByPathCommand", { Path: prefix, Recursive: true, WithDecryption: true, ...(token ? { NextToken: token } : {}) }));
    parameters.push(...(page.Parameters as Record<string, unknown>[] | undefined ?? []));
    token = typeof page.NextToken === "string" ? page.NextToken : undefined;
  } while (token !== undefined);
  const store: S3Client = {
    async putIfAbsent({ key, body }) {
      try {
        await s3Client.send(command(s3, "PutObjectCommand", { Bucket: bucket, Key: key, Body: body, IfNoneMatch: "*", ChecksumAlgorithm: "SHA256",
          ...(kmsKeyId ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kmsKeyId } : { ServerSideEncryption: "AES256" }) }));
        return "created";
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 412) return "exists"; if (status === 409) return "conflict"; throw error;
      }
    },
    // The worker role has no read/list permission; these exist for completeness of the interface only.
    async get() { throw new Error("Backup worker has no read access"); },
    async list() { throw new Error("Backup worker has no list access"); },
  };
  return runBackupWorker({ secrets: mapParameters(prefix, parameters), environment: environment as LedgerEnvironment,
    appDatabase: env("FINANCIAL_OS_APP_DATABASE"), ledgerDatabase: env("FINANCIAL_OS_LEDGER_DATABASE"), indexManifestDigest: __INDEX_MANIFEST_DIGEST__,
    connect: uri => new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect(), store: s3ObjectStore(store),
    recordSuccess: async ({ ledgerHead }) => { await metrics.send(command(cloudwatch, "PutMetricDataCommand", { Namespace: "FinancialOS/Backup",
      MetricData: [{ MetricName: "BackupSucceeded", Value: 1, Unit: "Count", Dimensions: [{ Name: "Environment", Value: environment }] },
        { MetricName: "LedgerHead", Value: ledgerHead, Unit: "None", Dimensions: [{ Name: "Environment", Value: environment }] }] })); },
    now: () => Date.now(), maxDurationMs: Number(process.env.FINANCIAL_OS_CAPTURE_MAX_MS ?? 240_000) });
}
