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
    // Enforce the bound while consuming chunked input, not after buffering an
    // arbitrarily large request whose Content-Length is missing or dishonest.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_JSON_BYTES) {
          void reader.cancel().catch(() => {});
          throw new InputValidationError([{ field: "body", message: "Request body is too large." }]);
        }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
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
