import type { ModelMessage } from 'ai';

/**
 * Input for assembling LLM context from a chat session's history plus the
 * incoming user message.
 */
export interface AssembleContextParams {
  /**
   * The ChatSession's primary key (DB UUID), NOT the external `sessionId`
   * field. History lookup uses this as the foreign key on ChatMessage.
   */
  chatSessionId: string;

  /**
   * System prompt with template variables already resolved. If you need to
   * layer additional context (RAG retrieval, persona sheets), append it to
   * `systemPrompt` BEFORE calling assemble() — this service won't touch it.
   */
  systemPrompt: string;

  /**
   * The user message being sent right now. NOT yet persisted; the orchestrator
   * appends it to the history as the final `user` message. Pass empty string
   * to assemble context without adding a new turn (rare — e.g. regenerating
   * the last assistant response).
   */
  newUserMessage: string;

  /**
   * Max number of PRIOR messages to include. The new user message is always
   * included regardless of this cap. Defaults to 20. Acts as a hard ceiling;
   * `maxInputTokens` (if set) may tighten further.
   */
  maxContextMessages?: number;

  /**
   * Max TOTAL input tokens the assembled context may consume (system prompt +
   * all history + new user message). If the natural message budget exceeds
   * this, older messages are dropped (sliding window) until it fits.
   *
   * If absent, defaults to 8000 tokens — a conservative budget that fits in
   * virtually every model's context window while leaving ~2-4K headroom for
   * the model's response.
   *
   * Supply a higher value for models with huge context windows (Gemini 2.5
   * supports 1M) when you know the full conversation matters.
   */
  maxInputTokens?: number;

  /**
   * Model ID used for token counting (so the tokenizer matches what the LLM
   * will see). If absent, falls back to cl100k_base (GPT-3.5/4 family) which
   * slightly over-estimates for non-OpenAI models — safe for budgeting.
   */
  model?: string;

  /**
   * Client-supplied recent conversation history. When present, we use it
   * directly and SKIP the DB lookup — saves one Supabase round-trip (~150-400ms
   * depending on region) on the hot path. The frontend already has these
   * messages in memory (it just rendered them), so resending them is free.
   *
   * Shape: chronological order (oldest → newest), `role` as 'user' | 'assistant',
   * `content` as plain string. Do NOT include the new user message being sent —
   * that's `newUserMessage` above.
   *
   * Security: this is client-supplied and unverifiable. Worst case: the user
   * hands the LLM a partial/reordered history and gets a worse answer — they
   * can only hurt themselves. Audit / analytics still reads from our own
   * persisted ChatMessage records, never from this field.
   */
  recentHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Result of context assembly. `messages` is ready to hand directly to
 * LlmService.
 */
export interface AssembledContext {
  /** System prompt, unchanged from the caller (kept for symmetry / debugging). */
  systemPrompt: string;

  /** User + assistant messages in chronological order, ending with the new user turn. */
  messages: ModelMessage[];

  /**
   * Number of PRIOR messages actually included in the output (excludes the
   * new user turn). Used for trace metadata: "context.load: 8 prior messages, 1240 tokens".
   */
  historyCount: number;

  /**
   * Precise token count of system prompt + all messages, computed via
   * tiktoken (cl100k_base or model-specific where available). Overestimates
   * by ~10-15% for non-OpenAI models — authoritative count is in the LLM
   * response's `usage` field after generation.
   */
  estimatedTokens: number;

  /** True if any prior messages were dropped (by token budget OR message cap). */
  truncated: boolean;

  /**
   * Exact number of prior messages NOT included in the output. Sum of:
   *   - Messages that existed in the DB but were older than the row limit
   *   - Messages we loaded but dropped to fit the token budget
   * Used by the hybrid strategy (Story 15-4) to decide whether to summarise.
   */
  droppedCount: number;

  /**
   * True if the DB has messages older than what we loaded. Distinct from
   * `truncated` — older messages could exist that we never even saw.
   */
  olderMessagesExist: boolean;
}
