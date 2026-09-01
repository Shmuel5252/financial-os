import { describe, expect, it } from "vitest";

import {
  acceptHouseholdInvitationCommandSchema,
  createHouseholdCommandSchema,
  createHouseholdInvitationCommandSchema,
  HOUSEHOLD_INVITATION_TTL_MS,
  householdActionAllowed,
  householdShareCommandSchema,
  updateHouseholdCommandSchema,
  versionedHouseholdMutationSchema,
  type HouseholdAction,
} from "@/lib/households/household";
import {
  hashHouseholdEmail,
  maskHouseholdEmail,
  normalizeHouseholdEmail,
} from "@/lib/households/household-identity-repository";

describe("Phase 11 household policy boundary", () => {
  it("enforces the documented owner/member permission matrix", () => {
    const ownerOnly: readonly HouseholdAction[] = [
      "dissolve",
      "invite",
      "manage_settings",
      "remove_member",
      "revoke_invitation",
    ];
    const shared: readonly HouseholdAction[] = [
      "share_own_resource",
      "unshare_own_resource",
      "view_household",
      "view_shared_resource",
    ];

    for (const action of ownerOnly) {
      expect(householdActionAllowed({ role: "owner" }, action)).toBe(true);
      expect(householdActionAllowed({ role: "member" }, action)).toBe(false);
    }
    for (const action of shared) {
      expect(householdActionAllowed({ role: "owner" }, action)).toBe(true);
      expect(householdActionAllowed({ role: "member" }, action)).toBe(true);
    }
    expect(householdActionAllowed({ role: "owner" }, "leave")).toBe(false);
    expect(householdActionAllowed({ role: "member" }, "leave")).toBe(true);
  });

  it("rejects client-supplied ownership, role, household, and visibility claims", () => {
    expect(() =>
      createHouseholdCommandSchema.parse({
        idempotencyKey: "3989ce79-807b-4cf5-b573-c04420374bbc",
        name: "הבית שלנו",
        ownerUserId: "a".repeat(24),
      }),
    ).toThrow();
    expect(() =>
      updateHouseholdCommandSchema.parse({
        expectedVersion: 1,
        name: "הבית שלנו",
        role: "owner",
      }),
    ).toThrow();
    expect(() =>
      createHouseholdInvitationCommandSchema.parse({
        email: "member@example.com",
        householdId: "b".repeat(24),
      }),
    ).toThrow();
    expect(() =>
      versionedHouseholdMutationSchema.parse({
        expectedVersion: 1,
        userId: "c".repeat(24),
      }),
    ).toThrow();
    expect(() =>
      householdShareCommandSchema.parse({
        action: "share",
        expectedVersion: null,
        resourceId: "d".repeat(24),
        resourceKind: "account",
        visibility: "household_shared",
      }),
    ).toThrow();
  });

  it("uses a seven-day invitation boundary and strict opaque tokens", () => {
    expect(HOUSEHOLD_INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(
      acceptHouseholdInvitationCommandSchema.parse({ token: "a".repeat(43) }),
    ).toEqual({ token: "a".repeat(43) });
    expect(() =>
      acceptHouseholdInvitationCommandSchema.parse({ token: "short" }),
    ).toThrow();
    expect(() =>
      acceptHouseholdInvitationCommandSchema.parse({ token: `${"a".repeat(42)}!` }),
    ).toThrow();
  });

  it("normalizes and hashes intended emails while exposing only a safe hint", () => {
    expect(normalizeHouseholdEmail("  Member@Example.COM  ")).toBe(
      "member@example.com",
    );
    expect(hashHouseholdEmail("Member@Example.COM")).toBe(
      hashHouseholdEmail("member@example.com"),
    );
    expect(maskHouseholdEmail("member@example.com")).toBe("m***@example.com");
    expect(hashHouseholdEmail("member@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});
