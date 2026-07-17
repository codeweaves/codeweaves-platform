import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

/**
 * WIDGET-channel events (public embeddable chat widget). Thin, named wrappers over
 * TracerService.logEvent so call sites stay readable and event names stay consistent.
 * All writes are fire-and-forget (see observability plan §2.1).
 */
@Injectable()
export class WidgetEventLogger {
  constructor(private readonly tracer: TracerService) {}

  logSessionStarted(d: {
    agentId: string;
    sessionId?: string;
    visitorId?: string;
  }): void {
    void this.tracer.logEvent({
      channel: 'WIDGET',
      eventName: 'WIDGET_SESSION_STARTED',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
    });
  }

  logMessageReceived(d: {
    agentId: string;
    sessionId?: string;
    visitorId?: string;
    payload?: unknown;
  }): void {
    void this.tracer.logEvent({
      channel: 'WIDGET',
      eventName: 'WIDGET_MESSAGE_RECEIVED',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      requestPayload: d.payload,
    });
  }

  logReplySent(d: {
    agentId: string;
    sessionId?: string;
    visitorId?: string;
    response?: unknown;
    latencyMs?: number;
  }): void {
    void this.tracer.logEvent({
      channel: 'WIDGET',
      eventName: 'WIDGET_REPLY_SENT',
      direction: 'OUTBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      responsePayload: d.response,
      latencyMs: d.latencyMs,
    });
  }

  logRateLimited(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
  }): void {
    void this.tracer.logEvent({
      channel: 'WIDGET',
      eventName: 'WIDGET_MESSAGE_RATE_LIMITED',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
    });
  }

  logException(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
    error: unknown;
  }): void {
    void this.tracer.logEvent({
      channel: 'WIDGET',
      eventName: 'WIDGET_MESSAGE_EXCEPTION',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
      errorMessage: d.error instanceof Error ? d.error.message : String(d.error),
    });
  }
}
