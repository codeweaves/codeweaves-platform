/**
 * A single step within a chat trace. Steps are emitted as they happen
 * (context load → RAG embed → vector search → rerank → LLM call etc.)
 * and persisted as a JSON array on `ChatTrace.steps`.
 */
export interface TraceStep {
  /** Hierarchical step name, e.g. 'context.load', 'rag.vector_search', 'llm.complete'. */
  step: string;
  /** ISO timestamp when the step completed. */
  timestamp: string;
  /** Wall-clock milliseconds the step took. `0` for instant events. */
  durationMs: number;
  /** Step-specific details (chunk previews, model IDs, token counts, etc.). */
  data?: Record<string, unknown>;
  /** Populated if the step failed; the trace still continues with success=false on the outer context. */
  error?: { message: string; stack?: string };
}

/**
 * Parameters for starting a new trace.
 */
export interface StartTraceParams {
  agentId: string;
  sessionId?: string;
  userMessage?: string;
  /** Override the generated trace ID (useful for tests / cross-service trace propagation). */
  traceId?: string;
  /**
   * Suppress the raw `userMessagePreview` in the pino file log (PII log
   * redaction). The DB row's userMessage can still be overridden at end().
   */
  redactPreview?: boolean;
}

/**
 * Parameters for finalising a trace.
 */
export interface EndTraceParams {
  success: boolean;
  messageId?: string;
  response?: string;
  model?: string;
  error?: string;
  /**
   * Override the persisted `userMessage` (set at startTrace). Used by PII log
   * redaction: the tokenized form only exists after the token map loads, which
   * happens later than startTrace.
   */
  userMessage?: string;
}

/**
 * Events emitted by an active trace's event bus. Consumed by SSE controllers
 * to stream trace steps to the client in real time before LLM tokens start.
 */
export type TraceEvent =
  | { type: 'step'; step: TraceStep }
  | { type: 'end'; totalDurationMs: number; success: boolean };

/**
 * A fluent trace context returned by `AiTraceService.startTrace()`. Callers
 * add steps via `step()` or `measure()` and finalise with `end()`.
 */
export interface TraceContext {
  readonly traceId: string;
  readonly correlationId: string | undefined;
  readonly agentId: string;
  readonly sessionId: string | undefined;

  /**
   * Log a single step. For timing, prefer `measure()` which auto-times the
   * callback. Use `step()` when the duration is computed elsewhere or the
   * event is instantaneous (e.g. chunk counts).
   */
  step(name: string, data?: Record<string, unknown>, durationMs?: number): void;

  /**
   * Run an async function and log a step with its duration. If the function
   * throws, the error is logged onto the step and re-thrown (caller decides
   * whether to end the trace with success=false).
   *
   * @param extractData Optional mapper that pulls interesting fields off the
   *   result (e.g. `(chunks) => ({ count: chunks.length })`). Falls back to no
   *   data on the step if omitted.
   */
  measure<T>(
    name: string,
    fn: () => Promise<T>,
    extractData?: (result: T) => Record<string, unknown>,
  ): Promise<T>;

  /**
   * Log an error step without throwing. Does NOT end the trace; the caller
   * still must call `end()` with `success: false`.
   */
  error(name: string, err: Error, data?: Record<string, unknown>): void;

  /**
   * Flush the trace to the database (best-effort) and emit a final 'end'
   * event to subscribers. Safe to call multiple times; subsequent calls are
   * no-ops.
   */
  end(params: EndTraceParams): Promise<void>;

  /**
   * Async iterable of trace events for SSE streaming. Emits one event per
   * step, then a final 'end' event. Completes when the trace ends.
   */
  subscribe(): AsyncIterable<TraceEvent>;
}
