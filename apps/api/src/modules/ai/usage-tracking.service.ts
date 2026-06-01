import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../services/prisma.service';

import type { LlmFeature, LlmTokenUsage } from './interfaces/llm.interfaces';

/**
 * A single usage record waiting to be flushed to the `llm_usage` table.
 * Shape mirrors the Prisma model; we keep it in memory as a plain object
 * because Prisma's generated input types are heavy to instantiate and we
 * want the queue data structure to stay cheap.
 */
interface QueuedUsage {
  organizationId: string;
  agentId: string;
  sessionId?: string;
  messageId?: string;
  traceId?: string;
  model: string;
  requestedModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens served from the provider's prompt cache (OpenAI / Gemini). null = unknown / not supported. */
  cachedInputTokens: number | null;
  /** Reasoning tokens consumed (Gemini thinking / OpenAI o1). null = none / N/A. */
  reasoningTokens: number | null;
  cost: number | null;
  feature: LlmFeature;
  latencyMs: number;
  cached: boolean;
  retryCount: number;
  finishReason: string | null;
}

/**
 * Flush policy constants. Batching reduces DB round-trips under high load
 * while ensuring no usage is ever lost for more than `FLUSH_INTERVAL_MS`
 * in the absence of new activity (idle queue).
 *
 * Values tuned for our expected load (low 4-5 digit req/min):
 *   - 50 records/batch  ≈ 1 DB write per 50 LLM calls
 *   - 5s idle flush     ≈ cap on "how long until this row is queryable"
 *   - 500 max buffer    — if we can't flush (DB down), drop instead of OOM
 */
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 500;

/**
 * UsageTrackingService: records every LLM/embedding/rerank call into the
 * `llm_usage` table for cost analytics, quota enforcement, and cache
 * effectiveness analysis.
 *
 * Design: FIRE-AND-FORGET. Callers invoke `record()` synchronously and move
 * on — the actual DB write happens in the background, batched. Chat requests
 * must NEVER wait on usage persistence.
 *
 * Trade-offs accepted:
 *   - If the process crashes between record() and the next flush, up to 5s
 *     of usage data is lost. This is acceptable for analytics; for billing
 *     we'd need synchronous writes (separate service, future work).
 *   - If the DB is unreachable for sustained periods, the buffer caps at
 *     MAX_BUFFER_SIZE and further records are DROPPED with a warning log.
 *     Better than unbounded memory growth.
 *
 * Alternative we didn't pick:
 *   - BullMQ job per usage record: too heavyweight for the volume, adds a
 *     Redis dependency on the hot path. Reserved for Phase 3 document
 *     ingestion where job durability actually matters.
 */
@Injectable()
export class UsageTrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageTrackingService.name);
  private readonly buffer: QueuedUsage[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  /** Set to true in onModuleDestroy to suppress the next-flush timer. */
  private shuttingDown = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.scheduleFlush();
  }

  /**
   * Drain the buffer before the process exits. NestJS gives each destroy
   * hook up to the shutdown timeout (default 5s) to complete — ample for
   * one Prisma createMany.
   */
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush().catch((err) => {
      this.logger.error('Final usage flush failed on shutdown', err);
    });
  }

  /**
   * Record a usage event. Synchronous from the caller's perspective — never
   * blocks, never throws. Invoke directly from LLM orchestrator services.
   */
  record(event: UsageEventInput): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      // Shouldn't happen under normal load. Log-once-per-incident semantics
      // would be nice but for now a simple warn is enough to catch DB outages.
      this.logger.warn(
        `Usage buffer full (${MAX_BUFFER_SIZE} records) — dropping record. DB persistence likely degraded.`,
      );
      return;
    }

    this.buffer.push({
      organizationId: event.organizationId,
      agentId: event.agentId,
      sessionId: event.sessionId,
      messageId: event.messageId,
      traceId: event.traceId,
      model: event.model,
      requestedModel: event.requestedModel,
      promptTokens: event.usage.inputTokens,
      completionTokens: event.usage.outputTokens,
      totalTokens: event.usage.totalTokens,
      cachedInputTokens: event.usage.cachedInputTokens ?? null,
      reasoningTokens: event.usage.reasoningTokens ?? null,
      cost: event.cost ?? null,
      feature: event.feature,
      latencyMs: event.latencyMs,
      cached: event.cached ?? false,
      retryCount: event.retryCount ?? 0,
      finishReason: event.finishReason ?? null,
    });

    // Short-circuit the idle timer if we've hit the batch threshold — the
    // 5s wait would be wasted latency for data that's ready to go.
    if (this.buffer.length >= BATCH_SIZE) {
      void this.flush();
    }
  }

  /**
   * Force an immediate flush. Primarily used by tests; production callers
   * rely on the timer + batch-size triggers.
   */
  async flushNow(): Promise<void> {
    return this.flush();
  }

  private scheduleFlush(): void {
    if (this.shuttingDown) return;
    this.flushTimer = setTimeout(() => {
      void this.flush().finally(() => this.scheduleFlush());
    }, FLUSH_INTERVAL_MS);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Drain the buffer in one shot so new records don't get mixed in with
    // the batch we're persisting. If the INSERT fails the batch is dropped
    // rather than replayed — avoids duplicate records and unbounded retry
    // loops. Analytics tolerates gaps; billing-critical writes use a
    // different path (future).
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      await this.prisma.llmUsage.createMany({
        data: batch.map(
          (r): Prisma.LlmUsageCreateManyInput => ({
            organizationId: r.organizationId,
            agentId: r.agentId,
            sessionId: r.sessionId,
            messageId: r.messageId,
            traceId: r.traceId,
            model: r.model,
            requestedModel: r.requestedModel,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            totalTokens: r.totalTokens,
            cachedInputTokens: r.cachedInputTokens,
            reasoningTokens: r.reasoningTokens,
            cost: r.cost,
            feature: r.feature,
            latencyMs: r.latencyMs,
            cached: r.cached,
            retryCount: r.retryCount,
            finishReason: r.finishReason,
          }),
        ),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to flush ${batch.length} usage records: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Input shape for `UsageTrackingService.record()`. Matches what LlmService
 * and DirectChatService have on hand after a completion, so no extra
 * bookkeeping is required at the call site.
 */
export interface UsageEventInput {
  organizationId: string;
  agentId: string;
  sessionId?: string;
  messageId?: string;
  traceId?: string;

  /** Model that actually served the request (may be a fallback). */
  model: string;
  /** Model requested by the agent config (may differ from `model`). */
  requestedModel: string;

  usage: LlmTokenUsage;
  cost: number | null;

  feature: LlmFeature;
  latencyMs: number;

  /** True if the response came from semantic cache (Phase 5). */
  cached?: boolean;
  /** Retry attempts consumed by the resilience layer (Phase 5). */
  retryCount?: number;
  finishReason?: string | null;
}
