import "server-only";

export type AiTelemetryEvent = Readonly<{
  durationMs: number;
  errorCategory: string | null;
  inputTokens: number | null;
  minimizationVersion: string;
  model: string;
  outputTokens: number | null;
  provider: "anthropic";
  requestId: string;
  retryCount: number;
  status: "failure" | "success";
}>;

export interface AiTelemetrySink {
  emit(event: AiTelemetryEvent): void;
}

export class ConsoleAiTelemetrySink implements AiTelemetrySink {
  emit(event: AiTelemetryEvent): void {
    const method = event.status === "success" ? console.info : console.warn;
    method("AI provider telemetry", event);
  }
}
