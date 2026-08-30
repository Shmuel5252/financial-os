import type { Filter, ObjectId } from "mongodb";

import type { Actor } from "@/lib/auth/actor";
import { parseObjectId } from "@/lib/authorization/ownership";

export type UserOwnedDocument = Readonly<{
  _id: ObjectId;
  userId: ObjectId;
}>;

export function userOwnershipFilter<TDocument extends UserOwnedDocument>(
  actor: Actor,
): Filter<TDocument> {
  return {
    userId: parseObjectId(actor.userId, "actor.userId"),
  } as Filter<TDocument>;
}

export function ownedDocumentFilter<TDocument extends UserOwnedDocument>(
  actor: Actor,
  resourceId: string,
): Filter<TDocument> {
  return {
    _id: parseObjectId(resourceId),
    ...userOwnershipFilter<TDocument>(actor),
  } as Filter<TDocument>;
}

export function assignUserOwnership<TValues extends Readonly<Record<string, unknown>>>(
  actor: Actor,
  values: TValues,
): TValues & Readonly<{ userId: ObjectId }> {
  return {
    ...values,
    userId: parseObjectId(actor.userId, "actor.userId"),
  };
}
