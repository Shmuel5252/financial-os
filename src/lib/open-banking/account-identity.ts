import "server-only";

import { createHmac } from "node:crypto";

import { getServerEnv } from "@/lib/config/server-env";
import { ConfigurationError } from "@/lib/errors/application-error";

export const ACCOUNT_IDENTITY_VERSION = "financy-account-identity-v1";

export type SafeAccountIdentity = Readonly<{
  version: typeof ACCOUNT_IDENTITY_VERSION;
  referenceDigest: string | null;
  maskedNumber: string | null;
  bankCode: string | null;
  branchCode: string | null;
}>;

export function bankAlias(kind: string, value: string): string {
  const secret = getServerEnv().AUTH_SECRET;
  if (secret === undefined) throw new ConfigurationError("Authentication is not configured.");
  return createHmac("sha256", secret).update(`financy:${kind}:${value}`, "utf8").digest("hex");
}

export function safeAccountLabel(value: string): string {
  return value.normalize("NFKC").replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\d(?:[\s-]*\d){4,}/g, "••••").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function minimizeAccountIdentity(input: Readonly<{
  accountNumber?: string | null | undefined;
  parsedAccount?: Readonly<{ bank?: string | null | undefined; branch?: string | null | undefined; number?: string | null | undefined }> | null | undefined;
  providerId: string;
  accountType: string;
  currency: string;
}>): SafeAccountIdentity {
  const code = (value: string | null | undefined) => value !== undefined && value !== null && /^\d{1,6}$/.test(value) ? value : null;
  const bankCode = code(input.parsedAccount?.bank);
  const branchCode = code(input.parsedAccount?.branch);
  const raw = input.accountNumber ?? input.parsedAccount?.number;
  const reference = raw?.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase() ?? "";
  const usable = /^[A-Z0-9]{4,128}$/.test(reference) && /\d/.test(reference);
  return {
    version: ACCOUNT_IDENTITY_VERSION,
    bankCode,
    branchCode,
    maskedNumber: usable ? `•••• ${reference.slice(-4)}` : null,
    referenceDigest: usable ? bankAlias(ACCOUNT_IDENTITY_VERSION,
      JSON.stringify([input.providerId, input.accountType, input.currency, reference, bankCode, branchCode])) : null,
  };
}
