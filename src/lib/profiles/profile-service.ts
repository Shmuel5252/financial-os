import "server-only";

import type { Actor } from "@/lib/auth/actor";
import {
  getUserProfileRepository,
  type UserProfileRepository,
} from "@/lib/profiles/profile-repository";
import {
  onboardingStepSchema,
  profileFieldsSchema,
  type OnboardingStep,
  type SaveProfileCommand,
  type UserProfile,
} from "@/lib/profiles/profile";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

type ProfileServiceDependencies = Readonly<{
  repository: UserProfileRepository;
}>;

async function resolveDependencies(
  dependencies?: ProfileServiceDependencies,
): Promise<ProfileServiceDependencies> {
  return dependencies ?? {
    repository: await getUserProfileRepository(),
  };
}

export async function loadProfile(
  actor: Actor,
  dependencies?: ProfileServiceDependencies,
): Promise<UserProfile | null> {
  const { repository } = await resolveDependencies(dependencies);
  return repository.findForActor(actor);
}

export async function saveProfile(
  actor: Actor,
  command: SaveProfileCommand,
  dependencies?: ProfileServiceDependencies,
): Promise<UserProfile> {
  const fields = parseUntrusted(profileFieldsSchema, command);
  const { repository } = await resolveDependencies(dependencies);
  return repository.saveForActor(actor, fields, command.expectedVersion);
}

export async function completeOnboardingStep(
  actor: Actor,
  step: OnboardingStep,
  expectedVersion: number,
  dependencies?: ProfileServiceDependencies,
): Promise<UserProfile> {
  const validatedStep = parseUntrusted(onboardingStepSchema, step);
  const { repository } = await resolveDependencies(dependencies);
  return repository.completeOnboardingStep(
    actor,
    validatedStep,
    expectedVersion,
  );
}
