import { Logger } from '@nestjs/common';
import { getRequestContext } from '../tracer/correlation.storage';
import { safeMeta } from '../events/redaction.util';

/**
 * House logger. Wraps NestJS Logger so every line reads:
 *
 *   [ServiceName] [functionName] - message            (corr:1a2b3c4d)
 *
 * - ServiceName  = the NestJS Logger context (the [..] Nest prints).
 * - functionName = passed per call, so each line says which method emitted it.
 * - corr         = short correlation id from AsyncLocalStorage (when in a request).
 *
 * Use exactly one per class:
 *   private readonly log = new AppLogger(MyService.name);
 * Then:
 *   this.log.info('sendMessage', 'routing to direct mode', { agentId });
 *   this.log.error('sendMessage', 'llm call failed', err, { agentId });
 *
 * See docs/plans/observability-everywhere-plan.md §3.
 */
export class AppLogger {
  private readonly nest: Logger;

  constructor(service: string) {
    this.nest = new Logger(service);
  }

  private fmt(fn: string, msg: string, meta?: Record<string, unknown>): string {
    const corr = getRequestContext()?.correlationId?.slice(0, 8);
    const tail = corr ? ` (corr:${corr})` : '';
    const metaStr = meta ? ` ${safeMeta(meta)}` : '';
    return `[${fn}] - ${msg}${metaStr}${tail}`;
  }

  /** Normal step / decision / success. */
  info(fn: string, msg: string, meta?: Record<string, unknown>): void {
    this.nest.log(this.fmt(fn, msg, meta));
  }

  /** Degraded but handled (fallback taken, retry, soft-miss). */
  warn(fn: string, msg: string, meta?: Record<string, unknown>): void {
    this.nest.warn(this.fmt(fn, msg, meta));
  }

  /** Failure. Pass the caught error as `err` to capture its message + stack. */
  error(
    fn: string,
    msg: string,
    err?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    const detail =
      err instanceof Error ? err.message : err != null ? String(err) : '';
    const full = detail ? `${msg} — ${detail}` : msg;
    this.nest.error(
      this.fmt(fn, full, meta),
      err instanceof Error ? err.stack : undefined,
    );
  }

  /** Verbose tracing — entry points, payload shapes. Hidden in prod by default. */
  debug(fn: string, msg: string, meta?: Record<string, unknown>): void {
    this.nest.debug(this.fmt(fn, msg, meta));
  }
}
