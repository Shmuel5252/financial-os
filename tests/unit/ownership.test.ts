import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/actor";
import {
  actorOwnershipScope,
  parseObjectId,
  requireUserScope,
} from "@/lib/authorization/ownership";
import {
  assignUserOwnership,
  ownedDocumentFilter,
  userOwnershipFilter,
  type UserOwnedDocument,
} from "@/lib/data-access/ownership-filter";

const userId = new ObjectId();
const otherUserId = new ObjectId();
const actor: Actor = {
  kind: "user",
  userId: userId.toHexString(),
};

describe("ownership enforcement", () => {
  it("derives user scope from a trusted actor", () => {
    expect(actorOwnershipScope(actor)).toEqual({
      kind: "user",
      userId: userId.toHexString(),
    });
  });

  it("constructs all-user and id-plus-user MongoDB predicates", () => {
    expect(userOwnershipFilter<UserOwnedDocument>(actor)).toEqual({ userId });

    const resourceId = new ObjectId();
    expect(ownedDocumentFilter<UserOwnedDocument>(actor, resourceId.toHexString())).toEqual({
      _id: resourceId,
      userId,
    });
  });

  it("overwrites any client-supplied ownership value on insert", () => {
    const result = assignUserOwnership(actor, {
      label: "manual record",
      userId: otherUserId,
    });

    expect(result.userId).toEqual(userId);
    expect(result.label).toBe("manual record");
  });

  it("rejects malformed identifiers before database access", () => {
    expect(() => parseObjectId("not-an-object-id")).toThrow();
  });

  it("does not treat a future household scope as authorized in Phase 0", () => {
    expect(() =>
      requireUserScope({
        householdId: new ObjectId().toHexString(),
        kind: "household",
        userId: userId.toHexString(),
      }),
    ).toThrow(/not implemented/);
  });
});
