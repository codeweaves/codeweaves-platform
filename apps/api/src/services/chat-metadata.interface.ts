/**
 * Unified metadata stored on every assistant ChatMessage, regardless of which
 * routing mode (n8n / direct) produced the reply. One shape everywhere means
 * analytics queries stay simple — no `CASE WHEN streamingMode = 'direct' THEN`
 * branching — and the eventual removal of n8n won't require schema surgery.
 *
 * Field-level rules:
 *   - Fields populated in BOTH modes (baseline): streamingMode, responseLatencyMs,
 *     backendReceivedAt, backendRespondedAt.
 *   - Fields populated in REAL/DIRECT streaming: timeToFirstToken, timeToLastToken,
 *     streamDurationMs, totalChunks. Always `null` on the simulated-sync path.
 *   - Fields populated ONLY in n8n modes: n8nReceivedAt, agentRepliedAt. Marked
 *     deprecated — populated while n8n exists, will be removed after n8n goes away.
 *   - Fields populated ONLY in direct mode: traceId, model, cost, inputTokens,
 *     outputTokens, totalTokens, cachedInputTokens, reasoningTokens, finishReason,
 *     historyCount, historyTruncated. These will become the baseline once n8n
 *     is retired — they're the richer, native observability surface.
 *
 * Index signature: Prisma's `InputJsonValue` is strict about what types can sit
 * in a JSON column. Allowing `string | number | boolean | null` on any key keeps
 * object literals of this shape assignable without casts. Nested objects aren't
 * permitted today (flat shape by design — easier to query with `->>`).
 */
export interface ChatMessageMetadata {
  [key: string]: string | number | boolean | null | undefined;

  // ---- Baseline (required in all modes) ----------------------------------
  streamingMode: 'direct' | 'simulated' | 'real';
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
  /** Milliseconds between upstream begin and end markers (n8n path only). */
  streamDurationMs?: number | null;

  // ---- n8n-only (deprecated; populated while n8n routing mode exists) -----
  /** @deprecated Set only in n8n routing modes. Remove once n8n is retired. */
  n8nReceivedAt?: string | null;
  /** @deprecated Set only in n8n routing modes. Remove once n8n is retired. */
  agentRepliedAt?: string | null;

  // ---- Direct-mode native observability (future baseline) -----------------
  /** Trace ID linking to ChatTrace + log files. Populated only in direct mode. */
  traceId?: string | null;
  /** Actual model that served this reply (e.g. 'openai:gpt-4.1-mini'). */
  model?: string | null;
  /** USD cost reported by provider (OpenRouter; null for others). */
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
