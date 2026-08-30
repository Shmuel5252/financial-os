import type { ApplicationErrorCode } from "@/lib/errors/application-error";
import { hebrewMessages } from "@/lib/i18n/hebrew";

export const appLocale = {
  direction: "rtl",
  htmlLanguage: "he",
  intlLocale: "he-IL",
} as const;

export const messages = hebrewMessages;

export type PublicErrorPayload = Readonly<{
  error?: Readonly<{
    code?: ApplicationErrorCode;
  }>;
}>;

export function userFacingErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return fallback;
  }

  const error = (payload as PublicErrorPayload).error;
  if (error?.code === undefined) {
    return fallback;
  }

  return messages.errors.public[error.code] ?? fallback;
}
