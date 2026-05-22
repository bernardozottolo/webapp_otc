export interface FrontendTelemetryEnvelope {
  event: string;
  occurred_at?: string;
  step?: string;
  user_context?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

const FRONTEND_TELEMETRY_URL = "/api/telemetry/frontend-event";

export async function sendFrontendTelemetryEvent(input: FrontendTelemetryEnvelope): Promise<void> {
  if (!input.event.trim()) {
    return;
  }

  try {
    await fetch(FRONTEND_TELEMETRY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        event: input.event,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
        step: input.step,
        user_context: input.user_context ?? {},
        payload: input.payload ?? {}
      }),
      keepalive: true
    });
  } catch {
    // Telemetry must never interrupt the user flow.
  }
}
