import "server-only";

import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
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
  const session = await auth();
  return actorFromSession(session);
}
