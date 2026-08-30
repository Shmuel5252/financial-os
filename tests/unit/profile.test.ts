import { describe, expect, it } from "vitest";

import {
  profileFieldsSchema,
  saveProfileCommandSchema,
  toUserProfileView,
  type UserProfile,
} from "@/lib/profiles/profile";

describe("profile domain", () => {
  it("validates the profile fields needed for financial date and currency context", () => {
    const result = profileFieldsSchema.parse({
      countryCode: "IL",
      displayName: "Dana",
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
    });

    expect(result).toEqual({
      countryCode: "IL",
      displayName: "Dana",
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
    });
  });

  it("rejects ambiguous country, currency, and timezone input", () => {
    expect(
      profileFieldsSchema.safeParse({
        countryCode: "Israel",
        displayName: "Dana",
        householdType: "single",
        primaryCurrency: "shekel",
        timeZone: "local",
      }).success,
    ).toBe(false);

    expect(
      profileFieldsSchema.safeParse({
        countryCode: "IL",
        displayName: "Dana",
        householdType: "single",
        primaryCurrency: "ZZZ",
        timeZone: "Asia/Jerusalem",
      }).success,
    ).toBe(false);
  });

  it("strips a client-supplied user ID from the command contract", () => {
    const result = saveProfileCommandSchema.parse({
      countryCode: "IL",
      displayName: "Dana",
      expectedVersion: null,
      householdType: "single",
      primaryCurrency: "ILS",
      timeZone: "Asia/Jerusalem",
      userId: "507f1f77bcf86cd799439011",
    });

    expect("userId" in result).toBe(false);
  });

  it("serializes timestamps but never exposes a user ID", () => {
    const profile: UserProfile = {
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      fields: {
        countryCode: "IL",
        displayName: "Dana",
        householdType: "single",
        primaryCurrency: "ILS",
        timeZone: "Asia/Jerusalem",
      },
      id: "507f1f77bcf86cd799439011",
      onboarding: {
        completedAt: null,
        completedSteps: ["profile"],
        currentStep: "income",
        status: "in_progress",
      },
      updatedAt: new Date("2026-08-30T10:00:00.000Z"),
      version: 1,
    };

    const view = toUserProfileView(profile);

    expect(view.createdAt).toBe("2026-08-30T10:00:00.000Z");
    expect(JSON.stringify(view)).not.toContain(profile.id);
  });
});
