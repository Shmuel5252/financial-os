import { z } from "zod";

import { ianaTimeZoneSchema } from "@/lib/domain/time/financial-time";
import { supportedCurrencyCodeSchema } from "@/lib/domain/money/money-input";

export const householdTypeSchema = z.enum([
  "single",
  "couple",
  "family",
  "other",
]);

export const onboardingStepSchema = z.enum([
  "profile",
  "income",
  "accounts",
  "cards",
  "expenses",
  "debts",
  "safety_margin",
  "goals",
  "review",
]);

export const profileFieldsSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, "Use an uppercase two-letter country code."),
  displayName: z.string().trim().min(1).max(80),
  householdType: householdTypeSchema,
  primaryCurrency: supportedCurrencyCodeSchema,
  timeZone: ianaTimeZoneSchema,
});

export const saveProfileCommandSchema = profileFieldsSchema.extend({
  expectedVersion: z.number().int().positive().nullable(),
});

export type ProfileFields = z.infer<typeof profileFieldsSchema>;
export type SaveProfileCommand = z.infer<typeof saveProfileCommandSchema>;
export type HouseholdType = z.infer<typeof householdTypeSchema>;
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export type OnboardingState = Readonly<{
  completedAt: Date | null;
  completedSteps: readonly OnboardingStep[];
  currentStep: OnboardingStep;
  status: "complete" | "in_progress";
}>;

export type UserProfile = Readonly<{
  createdAt: Date;
  fields: ProfileFields;
  id: string;
  onboarding: OnboardingState;
  updatedAt: Date;
  version: number;
}>;

export type UserProfileView = Readonly<{
  countryCode: string;
  createdAt: string;
  displayName: string;
  householdType: HouseholdType;
  onboarding: Readonly<{
    completedAt: string | null;
    completedSteps: readonly OnboardingStep[];
    currentStep: OnboardingStep;
    status: "complete" | "in_progress";
  }>;
  primaryCurrency: string;
  timeZone: string;
  updatedAt: string;
  version: number;
}>;

export function toUserProfileView(profile: UserProfile): UserProfileView {
  return {
    ...profile.fields,
    createdAt: profile.createdAt.toISOString(),
    onboarding: {
      completedAt: profile.onboarding.completedAt?.toISOString() ?? null,
      completedSteps: profile.onboarding.completedSteps,
      currentStep: profile.onboarding.currentStep,
      status: profile.onboarding.status,
    },
    updatedAt: profile.updatedAt.toISOString(),
    version: profile.version,
  };
}
