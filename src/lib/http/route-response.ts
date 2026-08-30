import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  ApplicationError,
  applicationErrorStatus,
  toPublicError,
} from "@/lib/errors/application-error";

export function noStoreJson<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
    },
    status,
  });
}

export function errorResponse(error: unknown): NextResponse {
  const correlationId = randomUUID();

  if (!(error instanceof ApplicationError)) {
    console.error("Unhandled route error", {
      correlationId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return noStoreJson(
    toPublicError(error, correlationId),
    applicationErrorStatus(error),
  );
}
