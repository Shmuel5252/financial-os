import "server-only";

export type NotificationTelemetryEvent = Readonly<{
  adapterVersion: string;
  durationMs: number;
  errorCategory: string | null;
  operation: "status" | "submit";
  provider: "resend";
  requestId: string;
  retryCount: number;
  status: "failure" | "success";
}>;

export interface NotificationTelemetrySink {
  emit(event: NotificationTelemetryEvent): void;
}

export class ConsoleNotificationTelemetrySink implements NotificationTelemetrySink {
  emit(event: NotificationTelemetryEvent): void {
    const method = event.status === "success" ? console.info : console.warn;
    method("Notification provider telemetry", event);
  }
}
