import "server-only";
import { ConfigurationError } from "@/lib/errors/application-error";

const keys = { ai: "OPERATIONS_DISABLE_AI", bankRefresh: "OPERATIONS_DISABLE_BANK_REFRESH", email: "OPERATIONS_DISABLE_EMAIL" } as const;
export type OptionalCapability = keyof typeof keys;
/** Deployment-controlled only. No request input, user preference or public route
 * can change these controls. Invalid nonempty values disable, never enable.
 */
export function capabilityEnabled(capability: OptionalCapability, environment: Record<string, string | undefined> = process.env): boolean {
  const value = environment[keys[capability]];
  return value === undefined || value === "" || value === "false";
}
export function assertCapabilityEnabled(capability: OptionalCapability): void {
  if (!capabilityEnabled(capability)) throw new ConfigurationError();
}
