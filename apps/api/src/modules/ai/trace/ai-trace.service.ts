import { EventEmitter } from 'node:events';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import type pino from 'pino';

import { getRequestContext } from '../../../common/tracer/correlation.storage';
import { PrismaService } from '../../../services/prisma.service';

import { aiTraceLogger } from './ai-trace.logger';
import type {
  EndTraceParams,
  StartTraceParams,
  TraceContext,
  TraceEvent,
  TraceStep,
} from './ai-trace.interfaces';

/**
 * Internal state we hold for each in-flight trace. Kept in memory only;
 * persisted to DB at `endTrace()`. Crashes mid-trace lose the trace (acceptable —
 * pino file logs still have every step even if DB persist is skipped).
 */
interface ActiveTrace {
  traceId: string;
  correlationId: string | undefined;
  agentId: string;
  sessionId: string | undefined;
  userMessage: string | undefined;
  steps: TraceStep[];
  startedAt: Date;
  ended: boolean;
  /** Per-trace pino child logger with traceId + agentId bound. */
  log: pino.Logger;
  /** Event bus for SSE subscribers. `step` events fire per step, `end` fires on finalise. */
  emitter: EventEmitter;
}

/**
 * AiTraceService: records every meaningful step of an AI orchestration turn
 * (context assembly → RAG retrieval → reranking → LLM call → finish) and emits
 * them to THREE sinks simultaneously:
 *
 *   1. Pino terminal + `logs/ai-trace.log`  — real-time visibility for developers
 *   2. In-memory EventEmitter              — streaming trace events out via SSE
 *   3. ChatTrace Prisma table              — permanent replay store ('what happened
 *                                              on conversation X yesterday?')
 *
 * Usage pattern:
 *
 *   const trace = aiTraceService.startTrace({ agentId, sessionId, userMessage });
 *
 *   const context = await trace.measure('context.load',
 *     () => contextService.assemble(...),
 *     (ctx) => ({ messages: ctx.messages.length, tokens: ctx.estimatedTokens }),
 *   );
 *
 *   try {
 *     const result = await trace.measure('llm.complete', () => llm.generate(...));
 *     await trace.end({ success: true, response: result.text, model: result.model });
 *   } catch (err) {
 *     trace.error('llm.complete', err);
 *     await trace.end({ success: false, error: err.message });
 *     throw err;
 *   }
 *
 * Design notes:
 *   - EventEmitter is used for SSE fan-out. Nothing else in the codebase uses
 *     RxJS, so sticking with node built-ins keeps the module dep-light.
 *   - DB writes are best-effort and never throw; if the DB is unreachable,
 *     the trace lives on only in the log files and that's fine for visibility.
 */
@Injectable()
export class AiTraceService {
  private readonly logger = new Logger(AiTraceService.name);
  private readonly activeTraces = new Map<string, ActiveTrace>();

  constructor(private readonly prisma: PrismaService) {}

  startTrace(params: StartTraceParams): TraceContext {
    const traceId = params.traceId ?? `t_${nanoid(10)}`;
    const correlationId = getRequestContext()?.correlationId;
    const startedAt = new Date();

    // Per-trace child logger: every log line from this trace auto-includes
    // traceId + agentId + correlationId, so grepping is trivial.
    const log = aiTraceLogger.child({
      traceId,
      correlationId,
      agentId: params.agentId,
      sessionId: params.sessionId,
    });

    const emitter = new EventEmitter();
    // Bump listener cap: one listener per SSE subscriber is expected and
    // trace steps are rapid — the default cap of 10 triggers spurious warnings.
    emitter.setMaxListeners(50);

    const active: ActiveTrace = {
      traceId,
      correlationId,
      agentId: params.agentId,
      sessionId: params.sessionId,
      userMessage: params.userMessage,
      steps: [],
      startedAt,
      ended: false,
      log,
      emitter,
    };
    this.activeTraces.set(traceId, active);

    log.info(
      {
        userMessagePreview: params.userMessage?.slice(0, 200),
      },
      'trace.start',
    );

    return new TraceContextImpl(active, this);
  }

  /** @internal Called by TraceContext.step() / measure() / error(). */
  logStep(traceId: string, step: TraceStep): void {
    const active = this.activeTraces.get(traceId);
    if (!active || active.ended) return;

    active.steps.push(step);

    // Pretty pino output: include all step.data fields at the top level so
    // they're each filterable in log queries (jq / Loki / etc.).
    active.log.info(
      {
        step: step.step,
        durationMs: step.durationMs,
        ...(step.data ?? {}),
        ...(step.error ? { error: step.error.message } : {}),
      },
      step.step,
    );

    active.emitter.emit('step', { type: 'step', step } satisfies TraceEvent);
  }

  /** @internal Called by TraceContext.end(). Idempotent. */
  async endTrace(traceId: string, result: EndTraceParams): Promise<void> {
    const active = this.activeTraces.get(traceId);
    if (!active || active.ended) return;
    active.ended = true;

    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - active.startedAt.getTime();

    active.log.info(
      {
        totalDurationMs,
        success: result.success,
        stepCount: active.steps.length,
        model: result.model,
        responseLength: result.response?.length,
        ...(result.error ? { error: result.error } : {}),
      },
      'trace.end',
    );

    // Emit end event so SSE subscribers can close the stream cleanly.
    active.emitter.emit('end', {
      type: 'end',
      totalDurationMs,
      success: result.success,
    } satisfies TraceEvent);

    // Fire-and-forget DB persistence. If this fails, the trace still exists
    // in pino log files — we never want trace persistence to block or fail
    // the chat response itself.
    try {
      await this.prisma.chatTrace.create({
        data: {
          traceId: active.traceId,
          correlationId: active.correlationId,
          agentId: active.agentId,
          sessionId: active.sessionId,
          messageId: result.messageId,
          userMessage: active.userMessage,
          response: result.response,
          model: result.model,
          steps: active.steps as unknown as Prisma.InputJsonValue,
          startedAt: active.startedAt,
          completedAt,
          totalDurationMs,
          success: result.success,
          errorMessage: result.error,
        },
      });
    } catch (err) {
      // Never throw. Never log at error level via NestJS Logger (which might
      // re-enter). Stick to pino.
      active.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'trace.persist_failed',
      );
    } finally {
      // Allow GC of EventEmitter + steps array now that persistence is done
      // and subscribers have seen 'end'.
      active.emitter.removeAllListeners();
      this.activeTraces.delete(traceId);
    }
  }

  /** @internal Called by TraceContext.subscribe(). */
  subscribe(traceId: string): AsyncIterable<TraceEvent> {
    const active = this.activeTraces.get(traceId);

    // If the trace is already ended or unknown, return an empty async iterable.
    // Safer than throwing — SSE controllers may subscribe after a race.
    if (!active) {
      return (async function* empty() {
        // no-op
      })();
    }

    return emitterToAsyncIterable(active.emitter);
  }

  /** Look up a stored trace by its short ID (for GET /admin/traces/:traceId). */
  async findByTraceId(traceId: string) {
    return this.prisma.chatTrace.findUnique({ where: { traceId } });
  }

  /** Recent traces for an agent (for admin listing). */
  async listRecent(agentId: string, limit = 50) {
    return this.prisma.chatTrace.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}

/**
 * Fluent trace context. Holds a reference to the ActiveTrace state and the
 * parent service (for forwarding logStep/endTrace calls). Instantiated per
 * trace by AiTraceService.startTrace().
 */
class TraceContextImpl implements TraceContext {
  constructor(
    private readonly active: ActiveTrace,
    private readonly service: AiTraceService,
  ) {}

  get traceId() {
    return this.active.traceId;
  }

  get correlationId() {
    return this.active.correlationId;
  }

  get agentId() {
    return this.active.agentId;
  }

  get sessionId() {
    return this.active.sessionId;
  }

  step(name: string, data?: Record<string, unknown>, durationMs = 0): void {
    this.service.logStep(this.active.traceId, {
      step: name,
      timestamp: new Date().toISOString(),
      durationMs,
      data,
    });
  }

  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    extractData?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      this.step(name, extractData?.(result), durationMs);
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      this.error(name, err as Error);
      // Still log a step with duration so timing is captured even on failure.
      this.service.logStep(this.active.traceId, {
        step: name,
        timestamp: new Date().toISOString(),
        durationMs,
        error: { message: (err as Error).message },
      });
      throw err;
    }
  }

  error(name: string, err: Error, data?: Record<string, unknown>): void {
    this.service.logStep(this.active.traceId, {
      step: name,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      data,
      error: { message: err.message, stack: err.stack },
    });
  }

  async end(params: EndTraceParams): Promise<void> {
    return this.service.endTrace(this.active.traceId, params);
  }

  subscribe(): AsyncIterable<TraceEvent> {
    return this.service.subscribe(this.active.traceId);
  }
}

/**
 * Convert a Node EventEmitter into an async iterable for SSE streaming.
 * Emits `step` events until an `end` event arrives, then completes.
 *
 * We use a ring buffer of pending events rather than Promise queues so a slow
 * consumer can't lose events — events queue up and are drained on demand.
 */
function emitterToAsyncIterable(
  emitter: EventEmitter,
): AsyncIterable<TraceEvent> {
  return {
    [Symbol.asyncIterator]() {
      const queue: TraceEvent[] = [];
      let ended = false;
      let resolveNext: ((value: IteratorResult<TraceEvent>) => void) | null =
        null;

      const onStep = (event: TraceEvent) => {
        if (resolveNext) {
          resolveNext({ value: event, done: false });
          resolveNext = null;
        } else {
          queue.push(event);
        }
      };

      const onEnd = (event: TraceEvent) => {
        // Flush the end event, then mark ended so the next .next() returns done.
        if (resolveNext) {
          resolveNext({ value: event, done: false });
          resolveNext = null;
        } else {
          queue.push(event);
        }
        ended = true;
        cleanup();
      };

      const cleanup = () => {
        emitter.off('step', onStep);
        emitter.off('end', onEnd);
      };

      emitter.on('step', onStep);
      emitter.on('end', onEnd);

      return {
        next(): Promise<IteratorResult<TraceEvent>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },
        return(): Promise<IteratorResult<TraceEvent>> {
          cleanup();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}
