import "server-only";

import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { ConfigurationError } from "@/lib/errors/application-error";
import { UnauthenticatedError } from "@/lib/errors/application-error";

export type Actor = Readonly<{
  kind: "user";
  userId: string;
}>;

export function actorFromSession(session: Session | null): Actor {
  const userId = session?.user?.id;

  if (userId === undefined || userId.length === 0) {
    throw new UnauthenticatedError();
  }

  return {
    kind: "user",
    userId,
  };
}

export async function requireActor(): Promise<Actor> {
  if (!getConfigurationStatus().authentication.ready) {
    throw new ConfigurationError("Authentication is not configured.");
  }

  const session = await auth();
  return actorFromSession(session);
}
