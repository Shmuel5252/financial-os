import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  InputValidationError,
  toPublicError,
} from "@/lib/errors/application-error";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

describe("safe error and validation boundary", () => {
  it("returns field issues for known invalid input", () => {
    const schema = z.object({ amountMinor: z.string().regex(/^\d+$/) });

    expect(() => parseUntrusted(schema, { amountMinor: "12.5" })).toThrow(
      InputValidationError,
    );

    try {
      parseUntrusted(schema, { amountMinor: "12.5" });
    } catch (error) {
      expect(toPublicError(error, "correlation-1")).toMatchObject({
        correlationId: "correlation-1",
        error: {
          code: "INVALID_INPUT",
          issues: [{ field: "amountMinor" }],
        },
      });
    }
  });

  it("does not expose unknown error messages or causes", () => {
    const publicError = toPublicError(
      new Error("internal cause containing do-not-leak-test-secret"),
      "correlation-2",
    );

    expect(JSON.stringify(publicError)).not.toContain("do-not-leak-test-secret");
    expect(publicError.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });
});
