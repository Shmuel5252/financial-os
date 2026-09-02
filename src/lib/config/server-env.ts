import "server-only";

import { z } from "zod";

import { ConfigurationError } from "@/lib/errors/application-error";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const isNotPlaceholder = (value: string) => !/[<>]/.test(value);

function isHttpsOrLoopback(value: string): boolean {
  const url = new URL(value);

  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["127.0.0.1", "::1", "localhost"].includes(url.hostname))
  );
}

const optionalNonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .min(1)
    .refine(isNotPlaceholder, "Replace the placeholder with a real value.")
    .optional(),
);

const optionalSecret = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .min(1)
    .refine(isNotPlaceholder, "Replace the placeholder with a real value.")
    .optional(),
);

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    AUTH_SECRET: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .min(32)
        .refine(isNotPlaceholder, "Replace the placeholder with a real value.")
        .optional(),
    ),
    AUTH_URL: z.preprocess(
      emptyStringToUndefined,
      z.url().optional(),
    ),
    GOOGLE_CLIENT_ID: optionalNonEmptyString,
    GOOGLE_CLIENT_SECRET: optionalSecret,
    MONGODB_URI: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .refine(
          (value) =>
            (value.startsWith("mongodb://") ||
              value.startsWith("mongodb+srv://")) &&
            isNotPlaceholder(value),
          "MONGODB_URI must use the mongodb or mongodb+srv protocol.",
        )
        .optional(),
    ),
    MONGODB_DB_NAME: z.preprocess(
      emptyStringToUndefined,
      z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
    ),
    MONGODB_TEST_URI: optionalSecret,
    MONGODB_TEST_DB_NAME: z.preprocess(
      emptyStringToUndefined,
      z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
    ),
    ANTHROPIC_API_KEY: optionalSecret,
    ANTHROPIC_WORKSPACE_ID: z.preprocess(
      emptyStringToUndefined,
      z.string().regex(/^wrkspc_[A-Za-z0-9]+$/).optional(),
    ),
    ANTHROPIC_MODEL: z.preprocess(
      emptyStringToUndefined,
      z.string().regex(/^claude-[a-z0-9-]+$/).optional(),
    ),
    RESEND_API_KEY: optionalSecret,
    RESEND_FROM_EMAIL: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(3).max(320).refine(
        (value) => /^(?:[^<>]{1,100}\s<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value),
        "RESEND_FROM_EMAIL must be an email address with an optional display name.",
      ).optional(),
    ),
    OPEN_BANKING_PROVIDER: optionalNonEmptyString,
    OPEN_BANKING_CLIENT_ID: optionalNonEmptyString,
    OPEN_BANKING_CLIENT_SECRET: optionalSecret,
    OPEN_BANKING_WEBHOOK_SECRET: optionalSecret,
  })
  .superRefine((env, context) => {
    if (
      env.NODE_ENV === "production" &&
      env.AUTH_URL !== undefined &&
      !isHttpsOrLoopback(env.AUTH_URL)
    ) {
      context.addIssue({
        code: "custom",
        message: "AUTH_URL must use HTTPS outside loopback development.",
        path: ["AUTH_URL"],
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

type CapabilityStatus = Readonly<{
  missing: readonly string[];
  ready: boolean;
}>;

export type ConfigurationStatus = Readonly<{
  authentication: CapabilityStatus;
  database: CapabilityStatus;
  futureAdapters: Readonly<{
    anthropicConfigured: boolean;
    openBankingConfigured: boolean;
    resendConfigured: boolean;
  }>;
}>;

export function parseServerEnv(input: Record<string, unknown>): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

function missingKeys(
  env: ServerEnv,
  keys: readonly (keyof ServerEnv)[],
): string[] {
  return keys.filter((key) => env[key] === undefined);
}

export function getConfigurationStatus(env = getServerEnv()): ConfigurationStatus {
  const databaseMissing = missingKeys(env, ["MONGODB_URI", "MONGODB_DB_NAME"]);
  const authenticationMissing = missingKeys(env, [
    "AUTH_SECRET",
    "AUTH_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MONGODB_URI",
    "MONGODB_DB_NAME",
  ]);
  const openBankingMissing = missingKeys(env, [
    "OPEN_BANKING_PROVIDER",
    "OPEN_BANKING_CLIENT_ID",
    "OPEN_BANKING_CLIENT_SECRET",
    "OPEN_BANKING_WEBHOOK_SECRET",
  ]);

  return {
    authentication: {
      missing: authenticationMissing,
      ready: authenticationMissing.length === 0,
    },
    database: {
      missing: databaseMissing,
      ready: databaseMissing.length === 0,
    },
    futureAdapters: {
      anthropicConfigured: env.ANTHROPIC_API_KEY !== undefined,
      openBankingConfigured: openBankingMissing.length === 0,
      resendConfigured:
        env.RESEND_API_KEY !== undefined && env.RESEND_FROM_EMAIL !== undefined,
    },
  };
}

export function requireDatabaseEnv(): Readonly<{
  databaseName: string;
  uri: string;
}> {
  const env = getServerEnv();

  if (env.MONGODB_URI === undefined || env.MONGODB_DB_NAME === undefined) {
    throw new ConfigurationError("MongoDB is not configured.");
  }

  return {
    databaseName: env.MONGODB_DB_NAME,
    uri: env.MONGODB_URI,
  };
}

export function requireAnthropicEnv(): Readonly<{
  apiKey: string;
  model: string;
  workspaceId?: string;
}> {
  const env = getServerEnv();

  if (env.ANTHROPIC_API_KEY === undefined) {
    throw new ConfigurationError("Anthropic is not configured.");
  }

  return {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    ...(env.ANTHROPIC_WORKSPACE_ID === undefined
      ? {}
      : { workspaceId: env.ANTHROPIC_WORKSPACE_ID }),
  };
}

export function requireResendEnv(): Readonly<{
  apiKey: string;
  fromEmail: string;
}> {
  const env = getServerEnv();
  if (env.RESEND_API_KEY === undefined || env.RESEND_FROM_EMAIL === undefined) {
    throw new ConfigurationError("Resend email delivery is not configured.");
  }
  return { apiKey: env.RESEND_API_KEY, fromEmail: env.RESEND_FROM_EMAIL };
}
