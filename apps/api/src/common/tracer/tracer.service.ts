import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../services/prisma.service";
import { getRequestContext } from "./correlation.storage";
import { sanitizeHeaders, capJson } from "../events/redaction.util";
import type { EventLogInput } from "../events/event-log.types";
import {
  maskPiiDeep,
  maskPiiText,
  type MaskLimits,
} from "../../modules/pii/mask-pii";

/**
 * Same caps as redact() applies right after (2000 chars per string, 50 items
 * per array, depth 6), so masking never spends work on text that is then cut.
 */
const LOG_MASK_LIMITS: MaskLimits = {
  maxStringLength: 2000,
  maxArrayLength: 50,
  maxDepth: 8,
};

/** Agents whose organization is cached. Cleared, not grown, past this. */
const AGENT_ORG_CACHE_MAX = 10_000;

@Injectable()
export class TracerService {
  private readonly logger = new Logger(TracerService.name);
  /** agentId → organizationId. An agent never moves to another organization. */
  private readonly agentOrg = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The organization a row belongs to: the caller's, else the agent's own
   * organization, else the acting user's. Public traffic (widget, voice,
   * WhatsApp) has an agent but no signed-in user, so without the agent lookup
   * those rows had no organization. Looked up once per agent, then cached.
   */
  private async resolveOrganizationId(
    explicit: string | undefined,
    agentId: string | undefined,
    contextOrg: string | undefined,
  ): Promise<string | null> {
    if (explicit) return explicit;
    if (agentId) {
      const cached = this.agentOrg.get(agentId);
      if (cached) return cached;
      let agent: { organizationId: string } | null = null;
      try {
        agent = await this.prisma.agent.findUnique({
          where: { id: agentId },
          select: { organizationId: true },
        });
      } catch {
        // A failed lookup must not drop the row; fall back below.
      }
      if (agent) {
        if (this.agentOrg.size >= AGENT_ORG_CACHE_MAX) this.agentOrg.clear();
        this.agentOrg.set(agentId, agent.organizationId);
        return agent.organizationId;
      }
    }
    return contextOrg ?? null;
  }

  private get eventLogEnabled(): boolean {
    return process.env.EVENT_LOG_ENABLED !== "false";
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
      //
      // PII is masked BEFORE capping (ADR-0005): capping first could cut a card
      // number in half and leave a partial the recognizers no longer match.
      // This is the single writer of every event_logs row, so every channel
      // and every route is covered, including ones added later.
      const requestHeaders = sanitizeHeaders(input.requestHeaders);
      const requestPayload = capJson(
        maskPiiDeep(input.requestPayload, LOG_MASK_LIMITS),
      );
      const responsePayload = capJson(
        maskPiiDeep(input.responsePayload, LOG_MASK_LIMITS),
      );
      const metadata = input.metadata
        ? capJson(maskPiiDeep(input.metadata, LOG_MASK_LIMITS))
        : undefined;

      await this.prisma.eventLog.create({
        data: {
          channel: input.channel,
          eventName: input.eventName,
          direction: input.direction ?? "INTERNAL",
          provider: input.provider ?? null,
          actorUserId: input.actorUserId ?? ctx?.userId ?? null,
          clerkId: input.clerkId ?? ctx?.clerkId ?? null,
          visitorId: input.visitorId ?? null,
          agentId: input.agentId ?? null,
          organizationId: await this.resolveOrganizationId(
            input.organizationId,
            input.agentId,
            ctx?.organizationId,
          ),
          sessionId: input.sessionId ?? null,
          correlationId: input.correlationId ?? ctx?.correlationId ?? null,
          requestUrl: input.requestUrl ?? null,
          responseStatus: input.responseStatus ?? null,
          latencyMs: input.latencyMs ?? null,
          success: input.success ?? true,
          errorMessage: input.errorMessage
            ? maskPiiText(input.errorMessage)
            : null,
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
    scope?: { organizationId?: string; agentId?: string },
  ): Promise<void> {
    const context = getRequestContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          correlationId: context?.correlationId,
          userId: context?.userId,
          clerkId: context?.clerkId,
          contextId,
          // Typed tenancy scope, resolved the same way as logEvent: the
          // caller's org, else the agent's org, else the acting user's org.
          // agentId is caller-supplied only (the request context lacks it).
          organizationId: await this.resolveOrganizationId(
            scope?.organizationId,
            scope?.agentId,
            context?.organizationId,
          ),
          agentId: scope?.agentId ?? null,
          event,
          data: data as Prisma.InputJsonValue,
        },
      });
      this.logger.log(
        `[${context?.correlationId?.slice(0, 8) ?? "no-ctx"}] ${event} → ${contextId}`,
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
