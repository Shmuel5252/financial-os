import { ObjectId } from "mongodb";
import { z } from "zod";

import type { Actor } from "@/lib/auth/actor";
import {
  InputValidationError,
  UnauthorizedError,
} from "@/lib/errors/application-error";

export type OwnershipScope =
  | Readonly<{
      kind: "user";
      userId: string;
    }>
  | Readonly<{
      householdId: string;
      kind: "household";
      userId: string;
    }>;

const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i, {
  message: "Expected an opaque 24-character identifier.",
});

export function parseObjectId(value: string, field = "id"): ObjectId {
  const result = objectIdSchema.safeParse(value);

  if (!result.success) {
    throw new InputValidationError([
      {
        field,
        message: result.error.issues[0]?.message ?? "Invalid identifier.",
      },
    ]);
  }

  return new ObjectId(result.data);
}

export function requireUserScope(scope: OwnershipScope): Extract<
  OwnershipScope,
  { kind: "user" }
> {
  if (scope.kind !== "user") {
    throw new UnauthorizedError(
      "Household authorization is not implemented in this phase.",
    );
  }

  return scope;
}

export function actorOwnershipScope(actor: Actor): Extract<
  OwnershipScope,
  { kind: "user" }
> {
  return {
    kind: "user",
    userId: actor.userId,
  };
}
