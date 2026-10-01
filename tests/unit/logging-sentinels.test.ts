import { randomUUID } from "node:crypto";
import { AdapterError, CallbackRouteError, InvalidCheck, OAuthCallbackError, SessionTokenError } from "@auth/core/errors";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { ResendNotificationEmailProvider } from "@/lib/adapters/resend/resend-notification-email-provider";
import { ConsoleAiTelemetrySink, type AiTelemetryEvent } from "@/lib/ai/ai-telemetry";
import { safeAuthLogger } from "@/lib/auth/safe-logger";
import { ConflictError, NotFoundError } from "@/lib/errors/application-error";
import { createHouseholdInvitationCommandSchema } from "@/lib/households/household";
import { errorResponse } from "@/lib/http/route-response";
import { buildNotificationEmailCommand } from "@/lib/notifications/notification-email-content";
import { ConsoleNotificationTelemetrySink, type NotificationTelemetryEvent } from "@/lib/notifications/notification-telemetry";
import { manualSectionInputSchemas } from "@/lib/onboarding/manual-record";
import { safeProviderTelemetry } from "@/lib/operations/safe-telemetry";
import { generateReportAiSummary } from "@/lib/reports/report-summary-service";
import { searchQuerySchema } from "@/lib/search/search";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";
import { captureOutput, dump, expectNoSentinel, hostile, sentinels, type Sentinels } from "../security/log-capture";

// Phase 18 rows 18-07/18-20: synthetic secrets, tokens, e-mail addresses, user/resource ids, amounts and financial text are pushed
// into every application log/telemetry sink - directly and hidden in nested objects, arrays, Error message/cause/stack, URLs with
// query strings, headers and toJSON/toString hooks - and nothing of them may reach console or process output.
const report = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("@/lib/reports/report-service", () => ({ findSavedReport: async () => report.value }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECTION_KEYS = ["durationMs", "errorCategory", "inputTokens", "outputTokens", "provider", "redactionVersion", "retryCount", "status"];

function hostileEvent(s: Sentinels, status: unknown): Record<string, unknown> {
  return { ...hostile(s), status, durationMs: s.amountMinor, retryCount: -1, errorCategory: `TIMEOUT ${s.email}`, inputTokens: 1.5, outputTokens: 10n,
    requestId: s.userId, model: s.merchant, minimizationVersion: s.hebrewNote, adapterVersion: s.resendKey, operation: s.url, provider: s.anthropicKey };
}
const outputOf = (calls: unknown[][]) => dump(calls.flat());

describe("logging and telemetry sentinels (18-07/18-20)", () => {
  it("[log-provider-projection] projects provider telemetry to allowlisted literals, enums and bounded counts only", () => {
    const s = sentinels();
    for (const provider of ["anthropic", "resend"] as const) {
      const projected = safeProviderTelemetry(hostileEvent(s, { toString: () => "success" }), provider);
      expect(projected).toEqual({ provider, status: "failure", durationMs: null, retryCount: null, errorCategory: "UNKNOWN_FAILURE",
        inputTokens: null, outputTokens: null, redactionVersion: "operational-telemetry-v1" });
      expectNoSentinel(dump([projected]), s, `${provider} projection`);
      for (const errorCategory of [hostile(s), [s.email], new Error("TIMEOUT"), new URL(s.url), { toString: () => "TIMEOUT" }, 42]) {
        expect(safeProviderTelemetry({ status: "failure", errorCategory }, provider).errorCategory).toBe("UNKNOWN_FAILURE");
      }
      for (const bad of [-1, 1.5, 1_000_000_001, Number.NaN, Infinity, "12", 12n, null, { valueOf: () => 3 }]) {
        expect(safeProviderTelemetry({ status: "success", durationMs: bad, retryCount: bad, inputTokens: bad }, provider)).toMatchObject({ durationMs: null, retryCount: null, inputTokens: null });
      }
      const ok = safeProviderTelemetry({ status: "success", durationMs: 120, retryCount: 0, errorCategory: null, inputTokens: 50, outputTokens: 25 }, provider);
      expect(ok).toMatchObject({ status: "success", durationMs: 120, retryCount: 0, errorCategory: null, inputTokens: provider === "anthropic" ? 50 : null });
      expect(Object.keys(ok).sort()).toEqual(PROJECTION_KEYS);
    }
  });

  it("[log-ai-sink] the console AI sink emits only the projection, on info for success and warn for failure", () => {
    const s = sentinels(); const calls = captureOutput(); const sink = new ConsoleAiTelemetrySink();
    sink.emit(hostileEvent(s, "success") as unknown as AiTelemetryEvent);
    sink.emit(hostileEvent(s, "failure") as unknown as AiTelemetryEvent);
    expect(calls.map(([level, message]) => [level, message])).toEqual([["info", "AI provider telemetry"], ["warn", "AI provider telemetry"]]);
    for (const call of calls) expect(Object.keys(call[2] as object).sort()).toEqual(PROJECTION_KEYS);
    expectNoSentinel(outputOf(calls), s, "AI sink");
  });

  it("[log-notification-sink] the console notification sink emits only the projection", () => {
    const s = sentinels(); const calls = captureOutput(); const sink = new ConsoleNotificationTelemetrySink();
    sink.emit(hostileEvent(s, "success") as unknown as NotificationTelemetryEvent);
    sink.emit(hostileEvent(s, "failure") as unknown as NotificationTelemetryEvent);
    expect(calls.map(([level, message]) => [level, message])).toEqual([["info", "Notification provider telemetry"], ["warn", "Notification provider telemetry"]]);
    expectNoSentinel(outputOf(calls), s, "notification sink");
  });

  it("[log-resend-path] the real Resend adapter logs nothing of the key, recipient, message id, provider bodies or thrown errors", async () => {
    const s = sentinels(); const requestId = randomUUID(); const calls = captureOutput();
    const command = buildNotificationEmailCommand({ applicationOrigin: "https://app.example.test", idempotencyKey: s.sessionToken, recipient: s.email, requestId });
    const leakyBody = JSON.stringify({ message: `invalid recipient ${s.email}`, key: s.resendKey, to: [s.email], subject: s.merchant, url: s.url });
    const responses: Array<() => Promise<Response>> = [
      async () => new Response(leakyBody, { status: 500, headers: { "x-request-url": s.url } }),
      async () => new Response(leakyBody, { status: 422 }),
      async () => new Response(JSON.stringify({ id: s.providerMessageId, echo: s.email }), { status: 200 }),
      async () => { throw hostile(s).error; },
      async () => new Response(JSON.stringify({ id: s.providerMessageId }), { status: 200 }),
      async () => new Response(JSON.stringify({ last_event: "delivered", to: [s.email], subject: s.merchant }), { status: 200 }),
      async () => new Response(leakyBody, { status: 401 }),
      async () => { throw hostile(s).error; },
    ];
    let next = 0;
    const provider = new ResendNotificationEmailProvider({ apiKey: s.resendKey, fromEmail: `Financial OS <sender.${s.email}>`,
      fetchImplementation: vi.fn(async () => responses[next++]!()) as unknown as typeof fetch });
    const thrown: unknown[] = [];
    for (let attempt = 0; attempt < 5; attempt++) await provider.send(command).catch((error: unknown) => thrown.push(error));
    for (let attempt = 0; attempt < 3; attempt++) await provider.getDeliveryStatus(s.providerMessageId).catch((error: unknown) => thrown.push(error));
    expect(next).toBe(8);
    expect(calls.filter(([level]) => level === "info" || level === "warn")).toHaveLength(8);
    expect(calls.every(([, message]) => message === "Notification provider telemetry")).toBe(true);
    expectNoSentinel(outputOf(calls), s, "Resend telemetry");
    expect(outputOf(calls)).not.toContain(requestId);
    expect(thrown.length).toBeGreaterThan(0);
    expectNoSentinel(dump(thrown), s, "Resend thrown errors");
  });

  it("[log-auth-logger] the Auth.js logger reduces every error, warning and debug call to a category and a random correlation id", () => {
    const s = sentinels(); const calls = captureOutput(); const leak = hostile(s);
    const driver = new MongoServerError({ message: `E11000 duplicate key error collection: authUsers dup key: { email: "${s.email}" }`, keyValue: { email: s.email }, code: 11000 });
    // Auth.js core wraps the raw upstream error as `message` (typed as string): reproduce that exactly.
    const errors: unknown[] = [new CallbackRouteError(leak.error as never), new AdapterError(driver as never), new InvalidCheck(`state ${s.bearer}`),
      new SessionTokenError(`token ${s.sessionToken}`), new OAuthCallbackError(`code ${s.jwt}`, { provider: s.url } as never), leak.error, driver, leak, s.anthropicKey, undefined];
    for (const error of errors) safeAuthLogger.error!(error as Error);
    safeAuthLogger.warn!(s.email as never);
    safeAuthLogger.debug!(s.merchant, leak);
    expect(calls).toHaveLength(errors.length + 1);
    const categories = calls.map((call) => (call[2] as { category: string }).category);
    expect(categories).toEqual(["CallbackRouteError", "AdapterError", "InvalidCheck", "SessionTokenError", "OAuthCallbackError",
      "UnexpectedAuthError", "UnexpectedAuthError", "UnexpectedAuthError", "UnexpectedAuthError", "UnexpectedAuthError", "AuthWarning"]);
    for (const call of calls) {
      expect(Object.keys(call[2] as object).sort()).toEqual(["category", "correlationId", "redactionVersion"]);
      expect((call[2] as { correlationId: string }).correlationId).toMatch(UUID);
    }
    expectNoSentinel(outputOf(calls), s, "auth logger");
  });

  it("[log-route-error] unexpected route errors log a literal and a random id, and the response discloses nothing", async () => {
    const s = sentinels(); const calls = captureOutput(); const leak = hostile(s);
    const driver = new MongoServerError({ message: `E11000 dup key: { email: "${s.email}", amountMinor: ${s.amountMinor} }`, keyValue: { email: s.email }, code: 11000 });
    const failures: unknown[] = [leak.error, driver, leak, s.bearer, new TypeError(`Cannot read ${s.merchant}`), Object.assign(new RangeError(s.hebrewNote), { cause: leak })];
    const bodies: string[] = [];
    for (const failure of failures) {
      const response = errorResponse(failure);
      expect(response.status).toBe(500);
      const body = await response.text(); bodies.push(body);
      expect(JSON.parse(body)).toEqual({ correlationId: expect.stringMatching(UUID), error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
    }
    expect(calls.map(([level, message, payload]) => [level, message, Object.keys(payload as object).sort()]))
      .toEqual(failures.map(() => ["error", "Unhandled route error", ["correlationId", "errorName"]]));
    expectNoSentinel(outputOf(calls), s, "route error log"); expectNoSentinel(bodies.join("\n"), s, "route error body");
    calls.length = 0;
    for (const expected of [new NotFoundError(), new ConflictError()]) await errorResponse(expected).text();
    expect(calls, "application errors are not logged").toEqual([]);
  });

  it("[log-validation-echo] validation errors from real input schemas name fields, never echo submitted values, and log nothing", async () => {
    const s = sentinels(); const calls = captureOutput();
    const attempts: Array<[Parameters<typeof parseUntrusted>[0], unknown]> = [
      [searchQuerySchema, { query: `${s.merchant} ${s.hebrewNote}`.repeat(4), householdId: s.email, scopeKind: s.bearer, limit: s.amountText, cursor: s.jwt.repeat(12) }],
      [createHouseholdInvitationCommandSchema, { email: `${s.email} ${s.anthropicKey}` }],
      [manualSectionInputSchemas.transactions, { accountId: `${s.userId}zz`, amount: { amountMinor: s.amountText, currency: s.resendKey }, category: s.merchant,
        date: s.email, merchant: s.merchant.repeat(10), notes: s.hebrewNote.repeat(30), recurring: s.sessionToken, type: s.householdId }],
    ];
    for (const [schema, input] of attempts) {
      let error: unknown;
      try { parseUntrusted(schema, input); } catch (caught) { error = caught; }
      const response = errorResponse(error); expect(response.status).toBe(400);
      const body = await response.text();
      expect(JSON.parse(body).error.issues.length).toBeGreaterThan(0);
      expectNoSentinel(body, s, "validation response");
    }
    expect(calls).toEqual([]);
  });

  it("[log-report-summary-path] the report-summary flow emits AI telemetry without report text, amounts, ids or provider errors", async () => {
    const s = sentinels(); const calls = captureOutput();
    const amount = { amountMinor: BigInt(s.amountMinor), currency: "ILS" };
    report.value = { id: s.resourceId, reportVersion: 1, report: { engineVersion: "engine", policyVersion: "policy", sourceFingerprint: s.userId,
      sections: { cashFlow: [{ key: "cash_flow.net", amount, label: s.merchant }], budget: [{ key: "budget.item", amount, label: s.hebrewNote }], debt: [], savings: [], netWorth: [], goals: [] } } };
    const repository = { listForReportActor: async () => [], createForActor: async (_actor: unknown, value: unknown) => value, deleteForActor: async () => undefined };
    const actor = { kind: "user" as const, userId: s.userId };
    await generateReportAiSummary(actor, { expectedSummaryVersion: null, idempotencyKey: s.sessionToken, reportId: s.resourceId }, { repository: repository as never,
      provider: { generate: async () => ({ model: s.merchant, provider: "anthropic" as const, usage: { inputTokens: 40, outputTokens: 20 },
        response: { fact: [{ evidenceRefs: ["report.fact.1"], text: s.hebrewNote }], insight: [], recommendation: [] } }) } as never });
    await expect(generateReportAiSummary(actor, { expectedSummaryVersion: null, idempotencyKey: s.sessionToken, reportId: s.resourceId }, { repository: repository as never,
      provider: { generate: async () => { throw Object.assign(hostile(s).error as Error, { providerCategory: `RATE_LIMIT ${s.email}`, name: s.anthropicKey }); } } as never })).rejects.toBeDefined();
    expect(calls.map(([level, message]) => [level, message])).toEqual([["info", "AI provider telemetry"], ["warn", "AI provider telemetry"]]);
    expect(calls[0]![2]).toMatchObject({ status: "success", inputTokens: 40, outputTokens: 20, errorCategory: null });
    expect(calls[1]![2]).toMatchObject({ status: "failure", errorCategory: "UNKNOWN_FAILURE" });
    expectNoSentinel(outputOf(calls), s, "report-summary telemetry");
  });
});
