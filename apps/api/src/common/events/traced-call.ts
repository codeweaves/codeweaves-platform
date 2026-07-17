import { EventChannel } from '@prisma/client';
import type { TracerService } from '../tracer/tracer.service';

export interface TracedCallOptions<T> {
  channel: EventChannel;
  provider: string;
  /** Base event in CAPS; helper appends _COMPLETED / _FAILED. e.g. 'ELEVENLABS_STT' */
  eventBase: string;
  agentId?: string;
  sessionId?: string;
  organizationId?: string;
  visitorId?: string;
  requestUrl?: string;
  requestHeaders?: Record<string, unknown> | Headers | null;
  requestPayload?: unknown;
  /** Pull responseStatus / responsePayload / metadata out of the success result. */
  extract?: (result: T) => {
    responseStatus?: number;
    responsePayload?: unknown;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Run `fn`, timing it, and emit exactly one event_logs row:
 *   `${eventBase}_COMPLETED` on success, `${eventBase}_FAILED` on throw.
 *
 * FIRE-AND-FORGET LOGGING: the event write is `void`-ed and self-swallowing, so a
 * logging failure can never surface here. But the ORIGINAL business error is
 * ALWAYS re-thrown — the wrapped call behaves identically to calling `fn()`
 * directly, so control flow is unchanged. (See observability plan §2.1 / §6.3.)
 */
export async function tracedCall<T>(
  tracer: TracerService,
  opts: TracedCallOptions<T>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const extra = opts.extract?.(result) ?? {};
    void tracer.logEvent({
      channel: opts.channel,
      eventName: `${opts.eventBase}_COMPLETED`,
      direction: 'OUTBOUND',
      provider: opts.provider,
      agentId: opts.agentId,
      sessionId: opts.sessionId,
      organizationId: opts.organizationId,
      visitorId: opts.visitorId,
      requestUrl: opts.requestUrl,
      requestHeaders: opts.requestHeaders,
      requestPayload: opts.requestPayload,
      latencyMs: Math.round(performance.now() - start),
      success: true,
      ...extra,
    });
    return result;
  } catch (err) {
    void tracer.logEvent({
      channel: opts.channel,
      eventName: `${opts.eventBase}_FAILED`,
      direction: 'OUTBOUND',
      provider: opts.provider,
      agentId: opts.agentId,
      sessionId: opts.sessionId,
      organizationId: opts.organizationId,
      visitorId: opts.visitorId,
      requestUrl: opts.requestUrl,
      requestHeaders: opts.requestHeaders,
      requestPayload: opts.requestPayload,
      latencyMs: Math.round(performance.now() - start),
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
