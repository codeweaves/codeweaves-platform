import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

/**
 * INTERNAL-channel events for cron / background jobs (classifier, data extraction,
 * handover sweep). No request context, so actor/org are usually null. Fire-and-forget.
 */
@Injectable()
export class InternalEventLogger {
  constructor(private readonly tracer: TracerService) {}

  /** Job started. eventName e.g. 'CLASSIFIER_RUN_STARTED'. */
  logStarted(eventName: string, metadata?: Record<string, unknown>): void {
    void this.tracer.logEvent({
      channel: 'INTERNAL',
      eventName,
      direction: 'INTERNAL',
      metadata,
    });
  }

  /** Job / item completed. eventName e.g. 'CLASSIFIER_RUN_COMPLETED'. */
  logCompleted(
    eventName: string,
    d?: {
      agentId?: string;
      sessionId?: string;
      organizationId?: string;
      latencyMs?: number;
      metadata?: Record<string, unknown>;
    },
  ): void {
    void this.tracer.logEvent({
      channel: 'INTERNAL',
      eventName,
      direction: 'INTERNAL',
      agentId: d?.agentId,
      sessionId: d?.sessionId,
      organizationId: d?.organizationId,
      latencyMs: d?.latencyMs,
      metadata: d?.metadata,
    });
  }

  /** Job / item failed. eventName e.g. 'CLASSIFIER_RUN_FAILED'. */
  logFailed(
    eventName: string,
    error: unknown,
    d?: {
      agentId?: string;
      sessionId?: string;
      organizationId?: string;
      metadata?: Record<string, unknown>;
    },
  ): void {
    void this.tracer.logEvent({
      channel: 'INTERNAL',
      eventName,
      direction: 'INTERNAL',
      agentId: d?.agentId,
      sessionId: d?.sessionId,
      organizationId: d?.organizationId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      metadata: d?.metadata,
    });
  }
}
