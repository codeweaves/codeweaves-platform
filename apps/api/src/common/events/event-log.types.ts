import { EventChannel, EventDirection } from "@prisma/client";

import type { PayloadLimits } from "./redaction.util";

/**
 * Input to `TracerService.logEvent()`. Everything except `channel` + `eventName`
 * is optional; actor/org/correlation are auto-filled from the request context
 * (AsyncLocalStorage) when omitted. See docs/plans/observability-everywhere-plan.md §6.
 */
export interface EventLogInput {
  channel: EventChannel;
  /** SCREAMING_SNAKE_CASE, e.g. WIDGET_MESSAGE_RECEIVED, ELEVENLABS_STT_COMPLETED */
  eventName: string;
  /** Defaults to INTERNAL. */
  direction?: EventDirection;
  /** ANTHROPIC | OPENAI | ELEVENLABS | SARVAM | DEEPGRAM | META_WHATSAPP | RESEND | CLERK | SUPABASE … */
  provider?: string;

  // WHO (auto-filled from context when omitted)
  actorUserId?: string;
  clerkId?: string;
  /** Widget IP / WhatsApp phone — mask the phone before passing. */
  visitorId?: string;

  // WHAT IT CONCERNS
  agentId?: string;
  organizationId?: string;
  sessionId?: string;
  correlationId?: string;

  // REQUEST (redacted + size-capped inside logEvent)
  requestUrl?: string;
  requestHeaders?: Record<string, unknown> | Headers | null;
  requestPayload?: unknown;

  // RESPONSE (redacted + size-capped inside logEvent)
  responseStatus?: number;
  responsePayload?: unknown;

  // OUTCOME
  latencyMs?: number;
  success?: boolean;
  errorMessage?: string;

  metadata?: Record<string, unknown>;

  /**
   * Size limits for the request/response payloads. Defaults to
   * DEFAULT_PAYLOAD_LIMITS; AI model calls pass LLM_PAYLOAD_LIMITS so the
   * whole prompt and reply are kept.
   */
  payloadLimits?: PayloadLimits;
}
