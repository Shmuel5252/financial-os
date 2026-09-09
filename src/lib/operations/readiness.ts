import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { UnauthenticatedError } from "@/lib/errors/application-error";

/** Environment-local immutable Auth.js IDs, never email/domain/household roles. */
export function parseOperatorAllowlist(value: string | undefined): readonly string[] {
  if (!value || value.length > 2_500) return [];
  const ids = value.split(",").map((id) => id.trim());
  if (ids.length > 100 || ids.some((id) => !/^[a-f0-9]{24}$/.test(id))) return [];
  return [...new Set(ids)];
}

type Dependencies = Readonly<{
  authenticate: () => Promise<Actor>;
  operatorIds: readonly string[];
  probe: () => Promise<void>;
  deadlineAt?: number;
}>;

type Result = Readonly<{
  status: 200 | 401 | 403 | 503;
  category: "ready" | "authentication_required" | "forbidden" | "unavailable";
}>;

const unavailable: Result = { status: 503, category: "unavailable" };

/** Does not serialize arbitrary errors or identifiers, even for operators. */
export async function evaluateReadiness(dependencies: Dependencies): Promise<Result> {
  // Disabled by default; do not create database work for an unconfigured surface.
  if (dependencies.operatorIds.length === 0) return { status: 403, category: "forbidden" };
  try {
    const actor = await dependencies.authenticate();
    if (dependencies.deadlineAt !== undefined && Date.now() >= dependencies.deadlineAt) return unavailable;
    if (actor.kind !== "user" || !dependencies.operatorIds.includes(actor.userId)) {
      return { status: 403, category: "forbidden" };
    }
    await dependencies.probe();
    if (dependencies.deadlineAt !== undefined && Date.now() >= dependencies.deadlineAt) return unavailable;
    return { status: 200, category: "ready" };
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) return { status: 401, category: "authentication_required" };
    return unavailable;
  }
}

/** Bound response latency without closing the shared application Mongo pool.
 * The underlying operation is not cancelled. Its rejection stays observed.
 */
export async function boundedReadiness(operation: Promise<Result>, timeoutMs = 5_000): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.catch(() => unavailable),
      new Promise<Result>((resolve) => { timer = setTimeout(() => resolve(unavailable), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Collapse overlapping probes per process; never cache an authorization result. */
export function singleFlightProbe(probe: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= Promise.resolve().then(probe).finally(() => { pending = undefined; });
    return pending;
  };
}
