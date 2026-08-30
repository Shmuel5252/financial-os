import type { ZodType } from "zod";

import { InputValidationError } from "@/lib/errors/application-error";

export function parseUntrusted<TOutput>(
  schema: ZodType<TOutput>,
  input: unknown,
): TOutput {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  throw new InputValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  );
}
