import { Injectable } from "@nestjs/common";
import { TracerService } from "../tracer/tracer.service";

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
      channel: "WIDGET",
      eventName: "WIDGET_SESSION_STARTED",
      direction: "INBOUND",
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
      channel: "WIDGET",
      eventName: "WIDGET_MESSAGE_RECEIVED",
      direction: "INBOUND",
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
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: "WIDGET",
      eventName: "WIDGET_REPLY_SENT",
      direction: "OUTBOUND",
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      responsePayload: d.response,
      latencyMs: d.latencyMs,
      metadata: d.metadata,
    });
  }

  logRateLimited(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: "WIDGET",
      eventName: "WIDGET_MESSAGE_RATE_LIMITED",
      direction: "INBOUND",
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      metadata: d.metadata,
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
      channel: "WIDGET",
      eventName: "WIDGET_MESSAGE_EXCEPTION",
      direction: "INBOUND",
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
      errorMessage:
        d.error instanceof Error ? d.error.message : String(d.error),
    });
  }

  /** A visitor granted or withdrew consent from the chat-start notice. */
  logConsentDecision(d: {
    agentId: string;
    organizationId: string;
    visitorId: string;
    action: "GRANTED" | "WITHDRAWN";
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: "WIDGET",
      eventName:
        d.action === "GRANTED"
          ? "WIDGET_CONSENT_GRANTED"
          : "WIDGET_CONSENT_WITHDRAWN",
      direction: "INBOUND",
      agentId: d.agentId,
      organizationId: d.organizationId,
      visitorId: d.visitorId,
      metadata: d.metadata,
    });
  }

  /** The server refused to open a chat because consent mode has no grant. */
  logConsentRequired(d: {
    agentId: string;
    // Set so visitor erasure finds these rows even when no session exists.
    organizationId?: string;
    visitorId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: "WIDGET",
      eventName: "WIDGET_CONSENT_REQUIRED",
      direction: "INBOUND",
      agentId: d.agentId,
      organizationId: d.organizationId,
      visitorId: d.visitorId,
      metadata: d.metadata,
      success: false,
    });
  }
}
