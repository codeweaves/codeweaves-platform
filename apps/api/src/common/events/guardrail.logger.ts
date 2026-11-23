import { Injectable } from "@nestjs/common";
import type { EventChannel } from "@prisma/client";

import { TracerService } from "../tracer/tracer.service";

export type GuardrailEventName =
  | "AI_GUARDRAIL_INPUT_BLOCKED"
  | "AI_GUARDRAIL_INPUT_NEUTRALIZED"
  | "AI_GUARDRAIL_HISTORY_NEUTRALIZED"
  | "AI_GUARDRAIL_OUTPUT_BLOCKED";

export interface GuardrailEvent {
  channel: EventChannel;
  eventName: GuardrailEventName;
  agentId: string;
  organizationId: string;
  /** ChatSession primary key, so visitor erasure finds the row. */
  sessionId?: string;
  /** Rule ids, score, mode, feature. Never any visitor or model text. */
  metadata: Record<string, unknown>;
}

/**
 * Guardrail triggers (ADR-0018). System events, so `event_logs` only, never
 * `audit_logs`. TracerService masks PII in metadata before the write
 * (ADR-0005). Fire-and-forget: this never throws and never awaits.
 */
@Injectable()
export class GuardrailEventLogger {
  constructor(private readonly tracer: TracerService) {}

  log(event: GuardrailEvent): void {
    try {
      void this.tracer
        .logEvent({
          channel: event.channel,
          eventName: event.eventName,
          direction: "INTERNAL",
          agentId: event.agentId,
          organizationId: event.organizationId,
          sessionId: event.sessionId,
          // A trigger is the guardrail working, not a failed request.
          success: true,
          metadata: event.metadata,
        })
        .catch(() => undefined);
    } catch {
      // Observability must never break the reply.
    }
  }
}
