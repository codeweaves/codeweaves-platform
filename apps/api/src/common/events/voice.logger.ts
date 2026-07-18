import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

/**
 * VOICE-channel events (public voice conversation endpoint). STT/TTS provider
 * calls are logged separately via tracedCall / ProviderEventLogger. Fire-and-forget.
 */
@Injectable()
export class VoiceEventLogger {
  constructor(private readonly tracer: TracerService) {}

  logConversationReceived(d: {
    agentId: string;
    sessionId?: string;
    visitorId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: 'VOICE',
      eventName: 'VOICE_CONVERSATION_RECEIVED',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      metadata: d.metadata,
    });
  }

  logReplySent(d: {
    agentId: string;
    sessionId?: string;
    visitorId?: string;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }): void {
    void this.tracer.logEvent({
      channel: 'VOICE',
      eventName: 'VOICE_REPLY_SENT',
      direction: 'OUTBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      latencyMs: d.latencyMs,
      metadata: d.metadata,
    });
  }

  logException(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
    error: unknown;
  }): void {
    void this.tracer.logEvent({
      channel: 'VOICE',
      eventName: 'VOICE_CONVERSATION_EXCEPTION',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
      errorMessage: d.error instanceof Error ? d.error.message : String(d.error),
    });
  }
}
