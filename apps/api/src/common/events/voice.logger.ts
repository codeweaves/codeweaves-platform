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

  /**
   * Speech-to-text failed for the turn (provider error, unsupported/too-long
   * audio, etc.). Dedicated + queryable, vs the generic
   * VOICE_CONVERSATION_EXCEPTION. The provider-level SARVAM_STT_FAILED row with
   * the same correlationId carries the raw provider reason. `provider`/`errorCode`
   * live in metadata.
   */
  logSttFailed(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
    provider?: string;
    errorCode?: string;
    error: unknown;
  }): void {
    void this.tracer.logEvent({
      channel: 'VOICE',
      eventName: 'VOICE_STT_FAILED',
      direction: 'INBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
      errorMessage: d.error instanceof Error ? d.error.message : String(d.error),
      metadata: { provider: d.provider, errorCode: d.errorCode },
    });
  }

  /**
   * A single sentence failed TTS on every provider (e.g. provider outage) and
   * was surfaced to the client as an error chunk. Distinct from the provider-
   * level SARVAM_TTS_FAILED rows — this is the pipeline-level failure the user
   * actually sees ("voice synthesis unavailable for this sentence"), made
   * queryable. The underlying reason is on the provider row with the same
   * correlationId. `sentenceIndex`/`errorCode` live in metadata.
   */
  logTtsSentenceFailed(d: {
    agentId?: string;
    sessionId?: string;
    visitorId?: string;
    sentenceIndex?: number;
    errorCode?: string;
    message?: string;
  }): void {
    void this.tracer.logEvent({
      channel: 'VOICE',
      eventName: 'VOICE_TTS_SENTENCE_FAILED',
      direction: 'OUTBOUND',
      agentId: d.agentId,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      success: false,
      errorMessage: d.message,
      metadata: { sentenceIndex: d.sentenceIndex, errorCode: d.errorCode },
    });
  }
}
