import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationError } from "@/lib/errors/application-error";
import { deletionLedgerConfig } from "@/lib/operations/deletion-ledger-runtime";
import { directoryObjectStore, s3ObjectStore, type S3Client } from "@/lib/operations/object-stores";
import { mapParameters } from "../../workers/backup/index";
import template from "../../infra/aws/financial-os-backup.template.json";

type Statement = Readonly<{ Sid?: string; Effect: string; Action: string | string[]; Condition?: Record<string, Record<string, unknown>> }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep traversal of a CloudFormation JSON document
const resources = template.Resources as unknown as Record<string, { Type: string; Condition?: string; DeletionPolicy?: string; Properties: Record<string, any> }>;
const actions = (statement: Statement) => [statement.Action].flat();
const statementsOf = (policy: { Statement: unknown[] }) => policy.Statement as Statement[];

describe("backup infrastructure template (runbook S3-S8)", () => {
  it("creates a retained, Object Lock (Governance, 35 days) bucket that is private, versioned and encrypted", () => {
    const bucket = resources.BackupBucket!;
    expect([bucket.Type, bucket.DeletionPolicy]).toEqual(["AWS::S3::Bucket", "Retain"]);
    expect(bucket.Properties.ObjectLockEnabled).toBe(true);
    expect(bucket.Properties.ObjectLockConfiguration.Rule.DefaultRetention).toEqual({ Mode: "GOVERNANCE", Days: 35 });
    expect(bucket.Properties.VersioningConfiguration).toEqual({ Status: "Enabled" });
    expect(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(value => value === true)).toBe(true);
    expect(bucket.Properties.OwnershipControls.Rules).toEqual([{ ObjectOwnership: "BucketOwnerEnforced" }]);
    const encryption = bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault["Fn::If"];
    expect([encryption[1].SSEAlgorithm, encryption[2].SSEAlgorithm]).toEqual(["aws:kms", "AES256"]);
    // D2: history = retention; objects expire the day after their lock ends (never earlier), then disappear a day later.
    const rules = bucket.Properties.LifecycleConfiguration.Rules as { NoncurrentVersionExpiration?: { NoncurrentDays: number }; ExpirationInDays?: number; Prefix?: string }[];
    const expiry = rules.filter(rule => rule.ExpirationInDays !== undefined);
    expect(expiry).toHaveLength(1); expect(expiry[0]!.Prefix).toBeUndefined();
    expect(expiry[0]!.ExpirationInDays).toBe(bucket.Properties.ObjectLockConfiguration.Rule.DefaultRetention.Days + 1);
    expect(expiry[0]!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
  });
  it("denies non-TLS access, non-conditional writes and any retention bypass or version deletion except by break-glass", () => {
    const statements = statementsOf(resources.BackupBucketPolicy!.Properties.PolicyDocument);
    expect(statements.every(statement => statement.Effect === "Deny")).toBe(true);
    expect(statements.find(statement => statement.Sid === "DenyInsecureTransport")?.Condition).toEqual({ Bool: { "aws:SecureTransport": "false" } });
    expect(statements.find(statement => statement.Sid === "RequireWriteOnce")?.Condition).toEqual({ Null: { "s3:if-none-match": "true" } });
    // A plain delete (delete marker → noncurrent → lifecycle) or a policy/lifecycle/versioning change is as destructive as a bypass.
    const bypass = statements.find(statement => statement.Sid === "OnlyBreakGlassMayDeleteOrWeakenProtection")!;
    expect(actions(bypass)).toEqual(expect.arrayContaining(["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention", "s3:PutObjectRetention",
      "s3:PutObjectLegalHold", "s3:PutBucketObjectLockConfiguration", "s3:PutLifecycleConfiguration", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketVersioning"]));
    expect(bypass.Condition).toEqual({ ArnNotEquals: { "aws:PrincipalArn": { "Fn::GetAtt": ["BreakGlassRole", "Arn"] } } });
    expect(resources.BackupBucketPolicy!.DeletionPolicy).toBe("Retain");
  });
  it("gives the worker write-once object puts on the two prefixes only — no read, list, delete or bypass", () => {
    const statements = statementsOf(resources.WorkerRole!.Properties.Policies[0].PolicyDocument).filter(statement => statement.Effect !== undefined);
    const granted = statements.flatMap(actions);
    expect(granted.filter(action => action.startsWith("s3:"))).toEqual(["s3:PutObject"]);
    expect(statements.find(statement => actions(statement).includes("s3:PutObject"))).toMatchObject({ Resource: [
      { "Fn::Sub": "${BackupBucket.Arn}/packages/*" }, { "Fn::Sub": "${BackupBucket.Arn}/ledger-mirror/*" }] });
    expect(granted).not.toContain("*");
    expect(statements.find(statement => actions(statement).includes("cloudwatch:PutMetricData"))?.Condition).toEqual({ StringEquals: { "cloudwatch:namespace": "FinancialOS/Backup" } });
    expect(statements.find(statement => actions(statement).includes("kms:Decrypt"))?.Condition).toEqual({ StringEquals: { "kms:ViaService": { "Fn::Sub": "ssm.${AWS::Region}.amazonaws.com" } } });
    const worker = resources.WorkerFunction!.Properties;
    expect([worker.ReservedConcurrentExecutions, worker.Timeout]).toEqual([1, 600]);
    expect(Object.keys(worker.Environment.Variables).some(name => /KEY_V|URI|PASSWORD|SECRET/.test(name))).toBe(false);
  });
  it("requires MFA for the restore operator (read-only) and break-glass roles", () => {
    // Identity Center enforces MFA at sign-in (its sessions carry no MFA key); IAM-user sign-in adds the explicit trust condition.
    expect(template.Parameters.OperatorSignIn.AllowedValues).toEqual(["identity-center", "iam-user-mfa"]);
    for (const name of ["RestoreOperatorRole", "BreakGlassRole"]) {
      expect(resources[name]!.Properties.AssumeRolePolicyDocument.Statement[0].Condition)
        .toEqual({ "Fn::If": ["RequireStsMfa", { Bool: { "aws:MultiFactorAuthPresent": "true" } }, { Ref: "AWS::NoValue" }] });
    }
    // (Fn::If statements carry the optional KMS grant and have no Effect at the top level.)
    const operator = statementsOf(resources.RestoreOperatorRole!.Properties.Policies[0].PolicyDocument).filter(statement => statement.Effect !== undefined).flatMap(actions);
    expect(operator.filter(action => action.startsWith("s3:")).sort()).toEqual(["s3:GetObject", "s3:ListBucket"]);
  });
  it("alarms on a missing daily success as breaching, on errors, dead letters and long runs, and on break-glass use", () => {
    const missing = resources.MissingBackupAlarm!.Properties;
    expect(missing).toMatchObject({ Namespace: "FinancialOS/Backup", MetricName: "BackupSucceeded", TreatMissingData: "breaching", ComparisonOperator: "LessThanThreshold", Threshold: 1 });
    expect(missing.Period * missing.EvaluationPeriods).toBe(26 * 3600);
    expect(missing.Period * missing.EvaluationPeriods).toBeLessThanOrEqual(604_800);
    for (const name of ["WorkerErrorsAlarm", "WorkerDurationAlarm", "DeadLetterAlarm"]) expect(resources[name]!.Properties.AlarmActions).toEqual([{ Ref: "AlarmTopic" }]);
    expect(resources.WorkerDurationAlarm!.Properties.Threshold).toBeLessThan(resources.WorkerFunction!.Properties.Timeout * 1000);
    expect(resources.BreakGlassAssumedRule!.Properties.EventPattern.detail.requestParameters.roleArn).toEqual([{ "Fn::GetAtt": ["BreakGlassRole", "Arn"] }]);
    expect(resources.ProtectedBucketChangeRule!.Properties.EventPattern.detail.eventName).toEqual(expect.arrayContaining(["DeleteObject", "PutBucketPolicy", "PutBucketLifecycle", "PutObjectRetention"]));
    // A custom topic policy replaces the default one: CloudWatch alarms and both EventBridge rules must be allowed to publish.
    const topic = statementsOf(resources.AlarmTopicPolicy!.Properties.PolicyDocument) as (Statement & { Principal: { Service: string } })[];
    expect(topic.map(statement => statement.Principal.Service).sort()).toEqual(["cloudwatch.amazonaws.com", "events.amazonaws.com"]);
    expect(topic.find(statement => statement.Principal.Service === "events.amazonaws.com")?.Condition).toEqual({ ArnEquals: { "aws:SourceArn": [
      { "Fn::GetAtt": ["BreakGlassAssumedRule", "Arn"] }, { "Fn::GetAtt": ["ProtectedBucketChangeRule", "Arn"] }] } });
    expect(resources.WorkerSchedule!.Properties.Target.DeadLetterConfig).toEqual({ Arn: { "Fn::GetAtt": ["WorkerDeadLetterQueue", "Arn"] } });
  });
  it("makes static egress (VPC + NAT) conditional and keeps every reference resolvable", () => {
    for (const name of ["Vpc", "NatGateway", "NatEip", "WorkerSecurityGroup"]) expect(resources[name]!.Condition).toBe("UseVpc");
    const text = JSON.stringify(template);
    const referenced = new Set([...text.matchAll(/"Ref":"([A-Za-z0-9]+)"/g), ...text.matchAll(/"Fn::GetAtt":\["([A-Za-z0-9]+)"/g), ...text.matchAll(/\$\{([A-Za-z0-9]+)(?:\.[A-Za-z]+)?\}/g)]
      .map(match => match[1]!).filter(name => !name.startsWith("AWS")));
    const declared = new Set([...Object.keys(resources), ...Object.keys(template.Parameters)]);
    expect([...referenced].filter(name => !declared.has(name))).toEqual([]);
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\/|AKIA[0-9A-Z]{16}/);
  });
});

describe("object stores", () => {
  const name = `packages/${"1".repeat(13)}-${"a".repeat(16)}.bson`;
  const fakeS3 = (responses: ("created" | "exists" | "conflict")[], pages: { keys: string[]; nextToken?: string }[] = []) => {
    const calls: unknown[] = [];
    const client: S3Client = {
      async putIfAbsent(input) { calls.push(input.key); return responses.shift() ?? "created"; },
      async get() { return null; },
      async list(input) { calls.push(input); return pages.shift() ?? { keys: [] }; },
    };
    return { client, calls };
  };
  it("S3: treats 412 as already stored, retries a 409 once and then refuses", async () => {
    await expect(s3ObjectStore(fakeS3(["exists"]).client).putOnce(name, new Uint8Array([1]))).resolves.toBeUndefined();
    const retried = fakeS3(["conflict", "created"]); await s3ObjectStore(retried.client).putOnce(name, new Uint8Array([1]));
    expect(retried.calls).toEqual([name, name]);
    await expect(s3ObjectStore(fakeS3(["conflict", "conflict"]).client).putOnce(name, new Uint8Array([1]))).rejects.toThrow("Object store refused: write conflict");
  });
  it("S3: refuses unexpected names and prefixes, paginates and validates listed keys", async () => {
    const store = s3ObjectStore(fakeS3([]).client);
    for (const bad of ["packages/../x.bson", "other/1-aaaaaaaaaaaaaaaa.bson", `${name}.tmp`]) await expect(store.putOnce(bad, new Uint8Array())).rejects.toThrow("unexpected object name");
    await expect(store.list("other/")).rejects.toThrow("unexpected prefix");
    const second = `packages/2-${"b".repeat(16)}.bson`;
    const paged = fakeS3([], [{ keys: [second], nextToken: "t" }, { keys: [name] }]);
    expect(await s3ObjectStore(paged.client).list("packages/")).toEqual([name, second]);
    expect(paged.calls).toEqual([{ prefix: "packages/" }, { prefix: "packages/", continuationToken: "t" }]);
    await expect(s3ObjectStore(fakeS3([], [{ keys: ["packages/evil"] }]).client).list("packages/")).rejects.toThrow("unexpected object name");
  });
  describe("directory", () => {
    let root: string | undefined;
    afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });
    it("is create-only: identical rewrites pass, different bytes are refused, missing reads are null", async () => {
      root = await mkdtemp(join(tmpdir(), "fos-store-")); const store = directoryObjectStore(root);
      expect([await store.get(name), await store.list("packages/")]).toEqual([null, []]);
      const bytes = randomBytes(64); await store.putOnce(name, bytes); await store.putOnce(name, bytes);
      await expect(store.putOnce(name, randomBytes(64))).rejects.toThrow("object is locked");
      expect(Buffer.from((await store.get(name))!)).toEqual(bytes);
      expect(await readFile(join(root, "packages", name.slice("packages/".length)))).toEqual(bytes);
      expect(await store.list("packages/")).toEqual([name]);
      await mkdir(join(root, "ledger-mirror")); await writeFile(join(root, "ledger-mirror", "unexpected.txt"), "x");
      await expect(store.list("ledger-mirror/")).rejects.toThrow("unexpected object name");
    });
  });
});

describe("deletion ledger runtime configuration", () => {
  const key = randomBytes(32).toString("base64");
  const full = { FINANCIAL_OS_ENVIRONMENT: "staging", FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb+srv://ledger-app@ledger.example.invalid/",
    FINANCIAL_OS_LEDGER_DATABASE: "deletion_ledger", FINANCIAL_OS_DELETION_LEDGER_KEY_V1: key, FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION: "1" };
  it("is unconfigured only when nothing is set outside production", () => {
    expect(deletionLedgerConfig({})).toEqual({ configured: false });
    expect(deletionLedgerConfig({ FINANCIAL_OS_ENVIRONMENT: "staging" })).toEqual({ configured: false });
    expect(() => deletionLedgerConfig({ FINANCIAL_OS_ENVIRONMENT: "production" })).toThrow(ConfigurationError);
    expect(deletionLedgerConfig(full)).toMatchObject({ configured: true, database: "deletion_ledger", environment: "staging" });
    expect(deletionLedgerConfig({ ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb://127.0.0.1:27018/" })).toMatchObject({ configured: true });
    expect(deletionLedgerConfig({ ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb://a.example.invalid:27017/?tls=true" })).toMatchObject({ configured: true });
  });
  it("fails closed on partial, invalid or TLS-weakening configuration", () => {
    const without = (name: keyof typeof full) => Object.fromEntries(Object.entries(full).filter(([key]) => key !== name));
    const [noDatabase, noKey] = [without("FINANCIAL_OS_LEDGER_DATABASE"), without("FINANCIAL_OS_DELETION_LEDGER_KEY_V1")];
    for (const env of [noDatabase, noKey, { FINANCIAL_OS_DELETION_LEDGER_KEY_V1: key },
      { FINANCIAL_OS_ENVIRONMENT: "staging", FINANCIAL_OS_LEDGER_MONGODB_URI: full.FINANCIAL_OS_LEDGER_MONGODB_URI },
      { FINANCIAL_OS_ENVIRONMENT: "staging", FINANCIAL_OS_LEDGER_DATABASE: "deletion_ledger" }, { ...full, FINANCIAL_OS_ENVIRONMENT: undefined },
      { ...full, FINANCIAL_OS_ENVIRONMENT: "development" }, { ...full, FINANCIAL_OS_LEDGER_DATABASE: "bad name" },
      { ...full, FINANCIAL_OS_DELETION_LEDGER_KEY_V1: "short" }, { ...full, FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION: "2" },
      { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "not a uri" }, { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb://a.example.invalid:27017/" },
      { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb+srv://ledger.example.invalid/?tls=false" },
      { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb+srv://ledger.example.invalid/?SSL=FALSE" },
      { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb+srv://ledger.example.invalid/?tlsAllowInvalidCertificates=true" },
      { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb://a.example.invalid:27017/?tls=true&tlsInsecure=true" },
      { ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "http://ledger.example.invalid/" },
      { ...full, FINANCIAL_OS_ENVIRONMENT: "production", FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb://127.0.0.1:27018/" }]) {
      expect(() => deletionLedgerConfig(env)).toThrow(ConfigurationError);
    }
    // The error never echoes a value.
    try { deletionLedgerConfig({ ...full, FINANCIAL_OS_LEDGER_MONGODB_URI: "mongodb://user:hunter2@a.example.invalid/" }); }
    catch (error) { expect(String((error as Error).message)).not.toMatch(/hunter2|example/); }
  });
});

describe("backup worker parameter mapping", () => {
  it("maps only known parameters under the prefix and never another environment's", () => {
    const prefix = "/financial-os/staging";
    expect(mapParameters(prefix, [
      { Name: `${prefix}/backup/app-db-uri`, Value: "a" }, { Name: `${prefix}/ledger/read-uri`, Value: "b" },
      { Name: `${prefix}/backup/package-key-v2`, Value: "c" }, { Name: `${prefix}/backup/package-key-active-version`, Value: "2" },
      { Name: `${prefix}/ledger/key-v1`, Value: "d" }, { Name: `${prefix}/ledger/key-active-version`, Value: "1" },
      { Name: `${prefix}/ledger/key-v0`, Value: "x" }, { Name: `${prefix}/unknown`, Value: "x" }, { Name: "/financial-os/production/backup/app-db-uri", Value: "x" },
      { Name: `${prefix}-evil/backup/app-db-uri`, Value: "x" }, { Name: "/financial-os/product/backup/app-db-uri", Value: "x" } /* same length as the prefix */, { Name: `${prefix}/backup/app-db-uri-2`, Value: "x" }, { Name: 1, Value: "x" },
    ])).toEqual({ FINANCIAL_OS_BACKUP_APP_DB_URI: "a", FINANCIAL_OS_LEDGER_READ_URI: "b", FINANCIAL_OS_RECOVERY_PACKAGE_KEY_V2: "c",
      FINANCIAL_OS_RECOVERY_PACKAGE_KEY_ACTIVE_VERSION: "2", FINANCIAL_OS_DELETION_LEDGER_KEY_V1: "d", FINANCIAL_OS_DELETION_LEDGER_KEY_ACTIVE_VERSION: "1" });
  });
});
