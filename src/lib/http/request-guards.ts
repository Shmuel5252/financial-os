import "server-only";

import { getServerEnv } from "@/lib/config/server-env";
import {
  InputValidationError,
  UnauthorizedError,
} from "@/lib/errors/application-error";

const MAX_JSON_BYTES = 16_384;

export function assertTrustedMutationOrigin(request: Request): void {
  const configuredOrigin = getServerEnv().AUTH_URL;
  const requestOrigin = request.headers.get("origin");

  if (
    configuredOrigin === undefined ||
    requestOrigin === null ||
    requestOrigin !== new URL(configuredOrigin).origin
  ) {
    throw new UnauthorizedError("The request origin is not allowed.");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");

  if (contentType?.toLowerCase().startsWith("application/json") !== true) {
    throw new InputValidationError([
      {
        field: "content-type",
        message: "Expected application/json.",
      },
    ]);
  }

  if (contentLength !== null && Number(contentLength) > MAX_JSON_BYTES) {
    throw new InputValidationError([
      {
        field: "content-length",
        message: "Request body is too large.",
      },
    ]);
  }

  try {
    const body = await request.text();
    const byteLength = new TextEncoder().encode(body).byteLength;

    if (byteLength > MAX_JSON_BYTES) {
      throw new InputValidationError([
        {
          field: "body",
          message: "Request body is too large.",
        },
      ]);
    }

    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof InputValidationError) {
      throw error;
    }

    throw new InputValidationError([
      {
        field: "body",
        message: "Expected valid JSON.",
      },
    ]);
  }
}
