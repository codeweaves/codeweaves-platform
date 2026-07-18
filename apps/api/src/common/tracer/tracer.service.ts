import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../services/prisma.service';
import { getRequestContext } from './correlation.storage';
import { sanitizeHeaders, capJson } from '../events/redaction.util';
import type { EventLogInput } from '../events/event-log.types';

@Injectable()
export class TracerService {
  private readonly logger = new Logger(TracerService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get eventLogEnabled(): boolean {
    return process.env.EVENT_LOG_ENABLED !== 'false';
  }

  /**
   * Write one row to `event_logs` — the unified channel + third-party call log.
   *
   * FIRE-AND-FORGET: callers do `void tracer.logEvent(...)`. This method NEVER
   * throws — a Prisma outage, a serialization error, an oversized payload all
   * degrade silently to a stderr line. Observability must never break a service.
   * (See docs/plans/observability-everywhere-plan.md §2.1.)
   *
   * Actor / org / correlation are auto-filled from AsyncLocalStorage when omitted.
   * Headers + payloads are sanitized/redacted/size-capped here at write time.
   */
  async logEvent(input: EventLogInput): Promise<void> {
    if (!this.eventLogEnabled) return;
    const ctx = getRequestContext();
    try {
      // Redact/cap up front. capJson returns `undefined` for null/undefined so we
      // OMIT the Json column rather than pass raw null (Prisma rejects null on Json).
      const requestHeaders = sanitizeHeaders(input.requestHeaders);
      const requestPayload = capJson(input.requestPayload);
      const responsePayload = capJson(input.responsePayload);
      const metadata = input.metadata ? capJson(input.metadata) : undefined;

      await this.prisma.eventLog.create({
        data: {
          channel: input.channel,
          eventName: input.eventName,
          direction: input.direction ?? 'INTERNAL',
          provider: input.provider ?? null,
          actorUserId: input.actorUserId ?? ctx?.userId ?? null,
          clerkId: input.clerkId ?? ctx?.clerkId ?? null,
          visitorId: input.visitorId ?? null,
          agentId: input.agentId ?? null,
          organizationId: input.organizationId ?? ctx?.organizationId ?? null,
          sessionId: input.sessionId ?? null,
          correlationId: input.correlationId ?? ctx?.correlationId ?? null,
          requestUrl: input.requestUrl ?? null,
          responseStatus: input.responseStatus ?? null,
          latencyMs: input.latencyMs ?? null,
          success: input.success ?? true,
          errorMessage: input.errorMessage ?? null,
          ...(requestHeaders !== undefined
            ? { requestHeaders: requestHeaders as Prisma.InputJsonValue }
            : {}),
          ...(requestPayload !== undefined
            ? { requestPayload: requestPayload as Prisma.InputJsonValue }
            : {}),
          ...(responsePayload !== undefined
            ? { responsePayload: responsePayload as Prisma.InputJsonValue }
            : {}),
          ...(metadata !== undefined
            ? { metadata: metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (error) {
      // Never rethrow — observability must not break business logic.
      this.logger.error(
        `Failed to write event ${input.eventName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async logAuditEvent(
    contextId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const context = getRequestContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          correlationId: context?.correlationId,
          userId: context?.userId,
          clerkId: context?.clerkId,
          contextId,
          event,
          data: data as Prisma.InputJsonValue,
        },
      });
      this.logger.log(
        `[${context?.correlationId?.slice(0, 8) ?? 'no-ctx'}] ${event} → ${contextId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to write audit event ${event}: ${error}`);
    }
  }

  mergeJsonResponse(
    ...objects: Record<string, unknown>[]
  ): Record<string, unknown> {
    return Object.assign({}, ...objects);
  }
}
