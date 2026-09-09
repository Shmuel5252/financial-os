import "server-only";

const categories = new Set(["TIMEOUT", "RATE_LIMITED", "AUTHENTICATION", "CONFIGURATION", "PROVIDER", "RATE_LIMIT", "RESPONSE", "CONFIGURATION_ERROR", "DEPENDENCY_UNAVAILABLE", "MODEL_UNAVAILABLE", "INVALID_RESPONSE", "NETWORK_ERROR", "PROVIDER_ERROR", "SAFE_FAILURE",
  "AUTHENTICATION_REJECTED", "AUTH_HEADER_MISSING", "BILLING_UNAVAILABLE", "MESSAGE_CONTRACT_REJECTED", "METADATA_REJECTED", "OUTPUT_SCHEMA_REJECTED", "PROVIDER_CAPACITY", "PROVIDER_OUTPUT_CONTRACT_REJECTED", "PROVIDER_RESPONSE_INVALID", "REQUEST_CONTRACT_REJECTED", "STRUCTURED_OUTPUT_UNAVAILABLE", "SYSTEM_PROMPT_REJECTED", "TOKEN_LIMIT_REJECTED", "UNKNOWN_PROVIDER_ERROR", "WORKSPACE_REJECTED", "WORKSPACE_REQUIRED"]);
export function safeOperationalCategory(value: unknown): string | null {
  return value === null ? null : typeof value === "string" && categories.has(value) ? value : "UNKNOWN_FAILURE";
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
}
/** Explicit projection: TypeScript shapes are not a runtime privacy boundary. */
export function safeProviderTelemetry(event: { durationMs?: unknown; errorCategory?: unknown; retryCount?: unknown; status?: unknown; inputTokens?: unknown; outputTokens?: unknown }, provider: "anthropic" | "resend") {
  return { provider, status: event.status === "success" ? "success" : "failure",
    durationMs: count(event.durationMs), retryCount: count(event.retryCount),
    errorCategory: safeOperationalCategory(event.errorCategory),
    inputTokens: provider === "anthropic" ? count(event.inputTokens) : null,
    outputTokens: provider === "anthropic" ? count(event.outputTokens) : null,
    redactionVersion: "operational-telemetry-v1" };
}
