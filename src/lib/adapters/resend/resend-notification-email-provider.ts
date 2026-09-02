import "server-only";

import { z } from "zod";

import { requireResendEnv } from "@/lib/config/server-env";
import { DependencyUnavailableError } from "@/lib/errors/application-error";
import type {
  NotificationEmailAcceptance,
  NotificationEmailCommand,
  NotificationEmailDeliveryStatus,
  NotificationEmailProvider,
} from "@/lib/notifications/notification-email-provider";
import { assertMinimizedNotificationEmailCommand } from "@/lib/notifications/notification-email-content";
import {
  ConsoleNotificationTelemetrySink,
  type NotificationTelemetrySink,
} from "@/lib/notifications/notification-telemetry";

const RESEND_API_URL = "https://api.resend.com";
const RESEND_TIMEOUT_MS = 20_000;
export const RESEND_ADAPTER_VERSION = "resend-notification-v1" as const;

const acceptanceSchema = z.object({ id: z.string().min(1).max(200) }).strict();
const statusSchema = z.object({ last_event: z.string().min(1).optional() }).passthrough();

type ResendNotificationEmailProviderOptions = Readonly<{
  apiKey: string;
  fetchImplementation?: typeof fetch;
  fromEmail: string;
  telemetry?: NotificationTelemetrySink;
}>;

export class ResendProviderError extends DependencyUnavailableError {
  constructor(readonly providerCategory: "AUTHENTICATION" | "CONFIGURATION" | "PROVIDER" | "RATE_LIMIT" | "RESPONSE") {
    super("The notification provider request failed safely.");
    this.name = "ResendProviderError";
  }
}

function category(status: number): ResendProviderError["providerCategory"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 422) return "CONFIGURATION";
  if (status === 429) return "RATE_LIMIT";
  return "PROVIDER";
}

export class ResendNotificationEmailProvider implements NotificationEmailProvider {
  private readonly fetchImplementation: typeof fetch;
  private readonly telemetry: NotificationTelemetrySink;

  constructor(private readonly options: ResendNotificationEmailProviderOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.telemetry = options.telemetry ?? new ConsoleNotificationTelemetrySink();
  }

  async send(command: NotificationEmailCommand): Promise<NotificationEmailAcceptance> {
    assertMinimizedNotificationEmailCommand(command);
    const started = Date.now();
    try {
      const response = await this.fetchImplementation(`${RESEND_API_URL}/emails`, {
        body: JSON.stringify({
          from: this.options.fromEmail,
          html: command.html,
          subject: command.subject,
          text: command.text,
          to: [command.recipient],
        }),
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": command.idempotencyKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      if (!response.ok) throw new ResendProviderError(category(response.status));
      const parsed = acceptanceSchema.safeParse(await response.json());
      if (!parsed.success) throw new ResendProviderError("RESPONSE");
      this.telemetry.emit({
        adapterVersion: RESEND_ADAPTER_VERSION,
        durationMs: Date.now() - started,
        errorCategory: null,
        operation: "submit",
        provider: "resend",
        requestId: command.requestId,
        retryCount: 0,
        status: "success",
      });
      return { providerMessageId: parsed.data.id };
    } catch (error) {
      const safeError = error instanceof ResendProviderError ? error : new ResendProviderError("PROVIDER");
      this.telemetry.emit({
        adapterVersion: RESEND_ADAPTER_VERSION,
        durationMs: Date.now() - started,
        errorCategory: safeError.providerCategory,
        operation: "submit",
        provider: "resend",
        requestId: command.requestId,
        retryCount: 0,
        status: "failure",
      });
      throw safeError;
    }
  }

  async getDeliveryStatus(providerMessageId: string): Promise<NotificationEmailDeliveryStatus> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    try {
      const response = await this.fetchImplementation(
        `${RESEND_API_URL}/emails/${encodeURIComponent(providerMessageId)}`,
        {
          headers: { authorization: `Bearer ${this.options.apiKey}` },
          method: "GET",
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new ResendProviderError(category(response.status));
      const parsed = statusSchema.safeParse(await response.json());
      if (!parsed.success) throw new ResendProviderError("RESPONSE");
      const event = parsed.data.last_event;
      const status: NotificationEmailDeliveryStatus = event === "delivered"
        ? "delivered"
        : event === "bounced" || event === "complained" || event === "failed"
          ? "failed"
          : event === undefined ? "unknown" : "accepted";
      this.telemetry.emit({ adapterVersion: RESEND_ADAPTER_VERSION, durationMs: Date.now() - started, errorCategory: null, operation: "status", provider: "resend", requestId, retryCount: 0, status: "success" });
      return status;
    } catch (error) {
      const safeError = error instanceof ResendProviderError ? error : new ResendProviderError("PROVIDER");
      this.telemetry.emit({ adapterVersion: RESEND_ADAPTER_VERSION, durationMs: Date.now() - started, errorCategory: safeError.providerCategory, operation: "status", provider: "resend", requestId, retryCount: 0, status: "failure" });
      throw safeError;
    }
  }
}

export function createConfiguredResendProvider(): ResendNotificationEmailProvider {
  const env = requireResendEnv();
  return new ResendNotificationEmailProvider({ apiKey: env.apiKey, fromEmail: env.fromEmail });
}
