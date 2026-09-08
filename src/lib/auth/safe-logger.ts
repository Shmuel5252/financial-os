import "server-only";

import { randomUUID } from "node:crypto";
import {
  AdapterError, AuthError, CallbackRouteError, InvalidCheck,
  MissingSecret, OAuthCallbackError, SessionTokenError,
} from "@auth/core/errors";
import type { NextAuthConfig } from "next-auth";

function category(error: unknown): string {
  // Never trust mutable error names/types or serialize message/cause/stack.
  if (error instanceof InvalidCheck) return "InvalidCheck";
  if (error instanceof AdapterError) return "AdapterError";
  if (error instanceof SessionTokenError) return "SessionTokenError";
  if (error instanceof CallbackRouteError) return "CallbackRouteError";
  if (error instanceof OAuthCallbackError) return "OAuthCallbackError";
  if (error instanceof MissingSecret) return "MissingSecret";
  return error instanceof AuthError ? "AuthError" : "UnexpectedAuthError";
}

// Override every level: Auth.js defaults include raw upstream error details.
// This changes logging only, never callbacks, checks, session or error propagation.
export const safeAuthLogger: NonNullable<NextAuthConfig["logger"]> = {
  error(error) {
    console.error("Authentication failure", {
      category: category(error), correlationId: randomUUID(), redactionVersion: "auth-log-v1",
    });
  },
  warn() {
    console.warn("Authentication warning", {
      category: "AuthWarning", correlationId: randomUUID(), redactionVersion: "auth-log-v1",
    });
  },
  debug() {},
};
