import type { ModelMessage, ToolSet } from "ai";
import type { EventChannel } from "@prisma/client";

/**
 * Token usage as returned by the provider (and normalised by the Vercel AI SDK).
 * `totalTokens` is NOT always `inputTokens + outputTokens` on models that
 * charge for reasoning / cached tokens separately, so trust the field
 * directly rather than recomputing.
 */
export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Cached input tokens (Anthropic prompt caching). Populated when available. */
  cachedInputTokens?: number;
  /** Reasoning tokens (o1 / Gemini thinking models). Populated when available. */
  reasoningTokens?: number;
}

/**
 * The LLM feature tag is used to slice cost analytics ("how much of our spend
 * is on chat vs summarisation vs embedding?"). Keep this enum stable — it's
 * written into `LlmUsage.feature` on every call.
 */
export type LlmFeature =
  | "chat"
  | "chat-stream"
  | "voice"
  | "summarization"
  | "title-generation"
  | "rag-query"
  | "rag-contextual"
  | "rag-evaluation"
  | "embedding";

/**
 * Input shape for LLM completions. Shared between `generateCompletion()`
 * (non-streaming) and `streamCompletion()` (streaming).
 *
 * Design note: we accept a resolved system prompt + messages rather than a
 * raw user prompt. This keeps LlmService pure — it doesn't know anything
 * about agents, sessions, or RAG. Those concerns live in
 * DirectChatService / ContextAssemblyService.
 */
export interface LlmCompletionRequest {
  /** Prefixed model ID, e.g. 'openai:gpt-4.1-mini' (see parseModelId). */
  modelId: string;

  /** Already-resolved system prompt (template variables replaced, RAG context injected). */
  systemPrompt: string;

  /**
   * Conversation messages in AI SDK `ModelMessage` format. Does NOT include the
   * system message — pass that as `systemPrompt` above so it can be tagged for
   * prompt caching separately.
   */
  messages: ModelMessage[];

  // Sampling parameters (all optional, per-agent config supplies defaults)
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;

  /** Tool definitions the model may call this turn. */
  tools?: ToolSet;
  /** Max agent loop iterations when tools are used. */
  maxSteps?: number;

  /** Abort mid-flight (on client disconnect, timeout, etc.). */
  abortSignal?: AbortSignal;

  // --- Bookkeeping (plumbed through to LlmUsage for analytics) ---
  /** Organisation owning the agent — required for per-tenant cost tracking. */
  organizationId: string;
  /** Agent making this call. */
  agentId: string;
  /** Public session id (event logs only). */
  sessionId?: string;
  /** Internal ChatSession id, for the usage ledger (ADR-0012). */
  chatSessionId?: string;
  /** Assistant ChatMessage ID, set after message is persisted. */
  messageId?: string;
  /** Trace ID for cross-referencing with ChatTrace. */
  traceId?: string;
  /** Which part of the product triggered this call (for cost slicing). */
  feature: LlmFeature;
  /**
   * Product channel this call serves (WIDGET/WHATSAPP/VOICE/INTERNAL), for
   * event_logs channel attribution. When omitted, it's inferred from `feature`
   * (which can't distinguish widget vs whatsapp buffered chat — pass it explicitly).
   */
  channel?: EventChannel;
}

/**
 * Result of a non-streaming generation.
 */
export interface LlmCompletionResult {
  text: string;
  usage: LlmTokenUsage;
  /** USD cost. Null until the usage meter prices the call (ADR-0012). */
  cost: number | null;
  /** The model that served the call. */
  model: string;
  /** Why the model stopped generating. */
  finishReason: string;
  /** Wall-clock latency from request sent to completion received. */
  latencyMs: number;
  /** Retry attempts consumed before success. 0 = first try. */
  retryCount: number;
}

/**
 * A single chunk emitted while streaming. `text-delta` fires on every token,
 * `finish` fires once at the end with final usage + cost.
 */
export type LlmStreamChunk =
  | { type: "text-delta"; content: string }
  | {
      type: "finish";
      usage: LlmTokenUsage;
      cost: number | null;
      model: string;
      finishReason: string;
      ttftMs: number | null;
      totalMs: number;
    }
  | { type: "error"; error: string };

/**
 * Handle returned by `streamCompletion()`. The `stream` yields chunks as they
 * arrive; the `completion` promise resolves once the stream ends and gives
 * you a fully-populated `LlmCompletionResult` (same shape as non-streaming).
 *
 * Typical usage in a controller:
 *
 *   const handle = await llmService.streamCompletion(req);
 *   for await (const chunk of handle.stream) {
 *     if (chunk.type === 'text-delta') res.write(sse('chunk', chunk.content));
 *   }
 *   const final = await handle.completion;
 *   usageTracker.record({ ...final, traceId, feature });
 */
export interface LlmStreamHandle {
  stream: AsyncIterable<LlmStreamChunk>;
  completion: Promise<LlmCompletionResult>;
}
