import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

/**
 * WHATSAPP-channel events. Inbound webhook + our outbound replies. The Graph API
 * calls themselves are logged via tracedCall / ProviderEventLogger (META_WHATSAPP).
 * `visitorId` must be a MASKED phone number. Fire-and-forget.
 */
@Injectable()
export class WhatsappEventLogger {
  constructor(private readonly tracer: TracerService) {}

  logWebhookVerified(): void {
    void this.tracer.logEvent({
      channel: 'WHATSAPP',
      eventName: 'WHATSAPP_WEBHOOK_VERIFIED',
      direction: 'INBOUND',
    });
  }

  logMessageReceived(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string; // masked phone
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: 'WHATSAPP',
      eventName: 'WHATSAPP_MESSAGE_RECEIVED',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      metadata: d.metadata,
    });
  }

  logReplySent(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string; // masked phone
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: 'WHATSAPP',
      eventName: 'WHATSAPP_REPLY_SENT',
      direction: 'OUTBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      latencyMs: d.latencyMs,
      metadata: d.metadata,
    });
  }

  logInboundException(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
    error: unknown;
  }): void {
    void this.tracer.logEvent({
      channel: 'WHATSAPP',
      eventName: 'WHATSAPP_INBOUND_EXCEPTION',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
      errorMessage: d.error instanceof Error ? d.error.message : String(d.error),
    });
  }
}
