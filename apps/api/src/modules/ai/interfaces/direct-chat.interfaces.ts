import type { ToolSet } from 'ai';
import type { Agent } from '@prisma/client';
import type { ChatCitation } from '@repo/validation';

import type { LlmFeature, LlmTokenUsage } from './llm.interfaces';

/**
 * A user-visible progress step ("✓ Read policies.pdf", "Checking your CRM…").
 * Forwarded to widgets over SSE — unlike 'trace' chunks, which stay internal.
 * The same `id` is emitted twice: once with status 'active' when the work
 * starts, once with 'done'/'error' when it settles; clients upsert by id.
 */
export interface ChatStep {
  id: string;
  kind: 'rag' | 'tool';
  label: string;
  status: 'active' | 'done' | 'error';
}

/**
 * Input for a direct-mode chat turn. The caller (ChatService.streamMessage)
 * supplies a fully-resolved Agent entity and the DB UUID of the active
 * ChatSession — session management, rate limiting, and permissions were all
 * done before we got here.
 */
export interface DirectChatRequest {
  /** Resolved agent with aiConfig populated. */
  agent: Agent;

  /** Primary key (UUID) of the ChatSession. */
  chatSessionId: string;

  /** The session's external ID — propagated through trace + usage for correlation. */
  externalSessionId?: string;

  /** The user's message. Not yet persisted to ChatMessage. */
  newUserMessage: string;

  /** Feature tag for usage analytics. Default: 'chat-stream' for stream(), 'chat' for send(). */
  feature?: LlmFeature;

  /** Signals client disconnect or request timeout. */
  abortSignal?: AbortSignal;

  /**
   * Optional client-supplied recent conversation history. When present,
   * ContextAssemblyService skips its DB query and uses this instead — saves
   * one Supabase round-trip (~150-400ms) on the hot path. The frontend has
   * these in memory already (they're rendered on screen), so resending is free.
   *
   * Do NOT include the new user message — that's `newUserMessage`.
   * Order: oldest → newest.
   */
  recentHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;

  /**
   * Extra instruction appended to the system prompt for THIS turn only.
   * Used by human-handover to make the bot "stall" politely while a teammate
   * is being connected (handoverState = REQUESTED). Null/absent = no-op.
   */
  extraSystemInstruction?: string;

  /**
   * Optional tools the model may call this turn (e.g. human-handover's
   * `connect_to_human`). Forwarded verbatim to the LLM; the AI SDK runs each
   * tool's `execute` server-side. Absent = a plain text completion.
   */
  tools?: ToolSet;

  /** Max agent-loop steps when `tools` is set (call + reply). */
  maxSteps?: number;
}

/**
 * Result of a direct-mode chat turn. Covers both streaming and non-streaming
 * flows — for streaming, this is what `completion` promise resolves to after
 * the stream finishes.
 */
export interface DirectChatResult {
  /** Full response text. */
  text: string;

  /** Trace ID for cross-referencing logs / DB. */
  traceId: string;

  /** Token usage + cost from the LLM provider. */
  usage: LlmTokenUsage;
  cost: number | null;

  /** Actual model that served the request (may differ from requested on fallback). */
  model: string;
  finishReason: string;

  /** Wall-clock from request start to response finish. */
  latencyMs: number;

  /** Time-to-first-token. Null on non-streaming calls. */
  ttftMs: number | null;

  // ----- Context metadata -----
  /** Number of prior messages loaded into context (excludes current user message). */
  historyCount: number;
  /** Char-based token estimate of the prompt. Real count comes from usage. */
  estimatedInputTokens: number;
  /** True if older messages were dropped to fit the context cap. */
  historyTruncated: boolean;

  // ----- RAG metadata -----
  /**
   * Resolved source citations for this reply ([N] markers mapped back to
   * knowledge-base documents). Empty when RAG didn't run or nothing was cited.
   */
  citations: ChatCitation[];
  /** Wall-clock of the retrieval phase (embed + search). Null when RAG skipped. */
  ragLatencyMs: number | null;
}

/**
 * Chunk shape emitted by `DirectChatService.stream()`. This is the direct
 * input to the SSE controller: one event per chunk, serialised to SSE.
 *
 *   'trace'      — an intermediate orchestration step (context load, LLM
 *                   start). INTERNAL — the public controller does not forward
 *                   these to widgets.
 *   'step'       — a USER-VISIBLE progress step (knowledge search, tool call).
 *                   The public controller forwards these to widgets, which
 *                   render them as live indicators.
 *   'text-delta' — a token (or token group) from the LLM. Append to the
 *                   assistant message in the UI.
 *   'finish'     — stream is done; full result + metadata ready.
 *   'error'      — orchestration failed; message + optional code. No further
 *                   chunks follow.
 */
export type DirectChatStreamChunk =
  | {
      type: 'trace';
      step: string;
      durationMs: number;
      data?: Record<string, unknown>;
    }
  | { type: 'step'; step: ChatStep }
  | { type: 'text-delta'; content: string }
  | { type: 'finish'; result: DirectChatResult }
  | { type: 'error'; error: string; code?: string };
