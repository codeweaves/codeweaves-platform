/**
 * Stream handler service (Story 5-19, Task 1).
 *
 * Orchestrates SSE streaming: connects to the streaming endpoint,
 * parses SSE events, handles timeout/cancellation, and invokes
 * callbacks for progressive message rendering.
 */

import { streamMessage, type ChatHistoryItem } from './api-client';
import { WidgetApiError } from './api-errors';
import { updateSession } from './session-manager';
import { parseSSEStream } from '../utils/sse-parser';
import type { SSEEvent, SSEStepEvent, SSEDoneEvent } from '../utils/sse-parser';

/** Inactivity timeout: 60 seconds with no data = assume dead connection */
const STREAM_INACTIVITY_TIMEOUT_MS = 60_000;

export interface StreamErrorOptions {
  rateLimited?: boolean;
  retryAfterSeconds?: number;
}

export interface StreamCallbacks {
  /** Called on the first chunk — create bot message bubble */
  onFirstChunk: (content: string) => void;
  /** Called on subsequent chunks — append content to message */
  onChunk: (content: string) => void;
  /** Called on live progress steps (RAG lookup / tool call) — upsert by step.id */
  onStep?: (step: SSEStepEvent) => void;
  /** Called when stream completes successfully */
  onDone: (sessionId: string, messageId: string, metadata: SSEDoneEvent['metadata']) => void;
  /** Called on error (backend error event, timeout, or network failure) */
  onError: (message: string, options?: StreamErrorOptions) => void;
  /** Called when the backend reports a handover state (on `paused` or `done`). */
  onHandover?: (state: string) => void;
}

export interface StreamHandle {
  /** Abort the active stream */
  abort: () => void;
}

/**
 * Start a streaming message request.
 *
 * Returns a StreamHandle for cancellation. Callbacks are invoked as
 * SSE events arrive. The caller is responsible for updating UI state.
 */
export function startStream(
  agentId: string,
  chatInput: string,
  callbacks: StreamCallbacks,
  recentHistory?: ChatHistoryItem[],
): StreamHandle {
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let receivedFirstChunk = false;
  let receivedDone = false;
  let aborted = false;

  function clearInactivityTimeout(): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function resetInactivityTimeout(): void {
    clearInactivityTimeout();
    timeoutId = setTimeout(() => {
      if (!aborted) {
        aborted = true;
        abortController.abort();
        callbacks.onError('Response timed out');
      }
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  }

  // Run the stream consumption in background (fire-and-forget from caller's perspective)
  (async () => {
    try {
      const reader = await streamMessage(
        agentId,
        chatInput,
        undefined,
        undefined,
        abortController.signal,
        recentHistory,
      );

      resetInactivityTimeout();

      for await (const event of parseSSEStream(reader)) {
        if (aborted) break;

        resetInactivityTimeout();
        handleEvent(event);
      }

      clearInactivityTimeout();

      // P1: If stream ended naturally without a done/error event, notify caller
      if (!aborted && !receivedDone) {
        aborted = true;
        callbacks.onError('Stream ended unexpectedly');
      }
    } catch (err: unknown) {
      clearInactivityTimeout();
      if (aborted) return; // Already handled by abort/timeout
      aborted = true;

      // P4: Detect structured rate limit errors from the fetch layer
      if (err instanceof WidgetApiError && err.status === 429) {
        callbacks.onError(err.userMessage, {
          rateLimited: true,
          retryAfterSeconds: err.retryAfterSeconds,
        });
        return;
      }

      const message = err instanceof Error ? err.message : 'Connection error';
      callbacks.onError(message);
    }
  })();

  function handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'session':
        // Early session event arrives BEFORE the LLM responds (server flushes
        // headers + writes this after resolving the session). Persist the
        // session ID right away so the next turn's recentHistory and sessionId
        // round-trips already know it. This is also what the dev test page
        // uses for its "Session: …" badge — clean acknowledge before content.
        updateSession(agentId, event.sessionId);
        break;
      case 'chunk':
        // P7: Skip empty content chunks to avoid creating empty bubbles
        if (!event.content) break;

        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          callbacks.onFirstChunk(event.content);
        } else {
          callbacks.onChunk(event.content);
        }
        break;

      case 'step':
        // Live progress (RAG lookup / tool call). The read loop already reset
        // the inactivity timeout for this event — steps are proof of life
        // during long tool calls, even when no text chunks are flowing.
        callbacks.onStep?.(event);
        break;

      case 'paused':
        // A human has taken over — no AI reply this turn. Inform the caller so
        // it can start polling for the human's messages. The `done` event that
        // follows ends the turn normally (no bot bubble was created).
        callbacks.onHandover?.(event.handoverState);
        break;

      case 'done':
        aborted = true; // Prevent timeout from firing after done
        receivedDone = true;
        clearInactivityTimeout();
        updateSession(agentId, event.sessionId);
        if (event.handoverState) callbacks.onHandover?.(event.handoverState);
        callbacks.onDone(event.sessionId, event.messageId, event.metadata);
        break;

      case 'error':
        aborted = true;
        clearInactivityTimeout();
        callbacks.onError(event.message);
        break;
    }
  }

  return {
    abort: () => {
      if (aborted) return;
      aborted = true;
      clearInactivityTimeout();
      abortController.abort();
    },
  };
}
