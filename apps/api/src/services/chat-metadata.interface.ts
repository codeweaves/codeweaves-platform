/**
 * Unified metadata stored on every assistant ChatMessage. One shape everywhere
 * means analytics queries stay simple.
 *
 * Field-level rules:
 *   - Baseline, always set: streamingMode, responseLatencyMs, backendReceivedAt,
 *     backendRespondedAt.
 *   - Streaming timings: timeToFirstToken, timeToLastToken, streamDurationMs,
 *     totalChunks. `null` on the non-streaming sync path.
 *   - Native observability: traceId, model, cost, inputTokens, outputTokens,
 *     totalTokens, cachedInputTokens, reasoningTokens, finishReason,
 *     historyCount, historyTruncated.
 *   - Older rows written by the retired n8n path (ADR-0014) may also carry
 *     n8nReceivedAt and agentRepliedAt. Nothing writes or reads them now.
 *
 * Index signature: Prisma's `InputJsonValue` is strict about what types can sit
 * in a JSON column. Allowing `string | number | boolean | null` on any key keeps
 * object literals of this shape assignable without casts. Nested objects aren't
 * permitted today (flat shape by design — easier to query with `->>`).
 */
export interface ChatMessageMetadata {
  [key: string]: string | number | boolean | null | undefined;

  // ---- Baseline (required in all modes) ----------------------------------
  streamingMode: "direct" | "simulated" | "real";
  backendReceivedAt: string; // ISO 8601
  backendRespondedAt: string; // ISO 8601
  responseLatencyMs: number; // wall-clock: backendRespondedAt - backendReceivedAt

  // ---- Streaming-specific (null for non-streaming sync path) --------------
  /** Milliseconds from backend request to FIRST content byte/token arrival. */
  timeToFirstToken?: number | null;
  /** Milliseconds from backend request to the LAST content byte/token. */
  timeToLastToken?: number | null;
  /** Count of chunks received during streaming (for UI + debugging). */
  totalChunks?: number | null;
  /** Milliseconds between the stream's first and last token. */
  streamDurationMs?: number | null;

  // ---- Native observability ------------------------------------------------
  /** Trace ID linking to ChatTrace + log files. */
  traceId?: string | null;
  /** Actual model that served this reply (e.g. 'openai:gpt-4.1-mini'). */
  model?: string | null;
  /** USD cost. Null until the usage meter prices the call (ADR-0012). */
  cost?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  /** Tokens served from the provider's prompt cache (OpenAI / Gemini). */
  cachedInputTokens?: number | null;
  /** Reasoning tokens consumed (Gemini thinking / OpenAI o1 family). */
  reasoningTokens?: number | null;
  /** Why the model stopped generating: 'stop', 'length', 'content-filter', etc. */
  finishReason?: string | null;
  /** Number of prior messages included in the context window. */
  historyCount?: number | null;
  /** True if older messages were dropped to fit the token budget. */
  historyTruncated?: boolean | null;
}

/**
 * @deprecated Use `ChatMessageMetadata` directly. This alias exists only so
 * existing import sites stay compiling while we migrate callers. Remove after
 * the last import of `SimulatedStreamingMetadata` / `RealStreamingMetadata` is
 * gone.
 */
export type SimulatedStreamingMetadata = ChatMessageMetadata;
/** @deprecated See `SimulatedStreamingMetadata`. */
export type RealStreamingMetadata = ChatMessageMetadata;
/** @deprecated See `SimulatedStreamingMetadata`. */
export type BaseChatMetadata = ChatMessageMetadata;
/** @deprecated See `SimulatedStreamingMetadata`. */
export type DirectMetadata = ChatMessageMetadata;
