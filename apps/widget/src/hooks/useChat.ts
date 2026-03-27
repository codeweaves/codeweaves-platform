/**
 * useChat hook — core chat state management (Story 5-18 + 5-19).
 *
 * Manages messages, streaming state, error state, and rate-limit cooldown.
 * Uses SSE streaming by default for progressive message rendering.
 */

import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import type { ChatMessage } from '../types';
import { startStream } from '../services/stream-handler';
import type { StreamHandle, StreamErrorOptions } from '../services/stream-handler';

export interface UseChatOptions {
  agentId: string;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  isRateLimited: boolean;
  error: string | null;
  sendMessage: (text: string) => void;
  stopStream: () => void;
  clearError: () => void;
  /** Reset loading state on typing indicator timeout (30s with no API response) */
  handleTimeout: () => void;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useChat({ agentId }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against concurrent sends (ref stays current across renders)
  const loadingRef = useRef(false);
  const rateLimitedRef = useRef(false);
  const streamHandleRef = useRef<StreamHandle | null>(null);
  // Track accumulated content for streaming message (avoids stale closure on setMessages)
  const streamContentRef = useRef('');

  // Cleanup all timers and active stream on unmount
  useEffect(() => {
    const errorTimer = errorTimerRef;
    const rateLimitTimer = rateLimitTimerRef;
    const streamHandle = streamHandleRef;
    return () => {
      if (errorTimer.current !== null) clearTimeout(errorTimer.current);
      if (rateLimitTimer.current !== null) clearTimeout(rateLimitTimer.current);
      streamHandle.current?.abort();
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      setError(null);
      errorTimerRef.current = null;
    }, 5000);
  }, []);

  const finishStream = useCallback(() => {
    setIsLoading(false);
    setIsStreaming(false);
    loadingRef.current = false;
    streamHandleRef.current = null;
    streamContentRef.current = '';
  }, []);

  const stopStream = useCallback(() => {
    if (!streamHandleRef.current) return;
    streamHandleRef.current.abort();

    // Finalize partial message as-is (AC #5 — preserve partial on cancel)
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m,
      ),
    );
    finishStream();
  }, [finishStream]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      // Use refs for guards — immune to stale closures
      if (!trimmed || loadingRef.current || rateLimitedRef.current) return;

      // P2: Abort any existing stream before starting a new one
      if (streamHandleRef.current) {
        streamHandleRef.current.abort();
        streamHandleRef.current = null;
      }

      // Set loading guard immediately (sync) to prevent double-click races
      loadingRef.current = true;

      // Clear any existing error on new send
      clearError();

      // Optimistic UI — add user message immediately
      const userMsg: ChatMessage = {
        id: generateId('user'),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      // Placeholder bot message ID — created on first chunk
      const botMsgId = generateId('bot');
      streamContentRef.current = '';

      const handle = startStream(agentId, trimmed, {
        onFirstChunk: (content: string) => {
          // AC #2: Hide typing indicator by setting isStreaming (loading stays true for other UI)
          streamContentRef.current = content;
          const botMsg: ChatMessage = {
            id: botMsgId,
            role: 'assistant',
            content,
            timestamp: new Date(),
            isStreaming: true,
          };
          setMessages((prev) => [...prev, botMsg]);
          setIsStreaming(true);
          // isLoading stays true but typing indicator hides because isStreaming is now true
        },

        onChunk: (content: string) => {
          streamContentRef.current += content;
          const accumulated = streamContentRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMsgId ? { ...m, content: accumulated } : m,
            ),
          );
        },

        // P6: Accept metadata parameter (P3: keep client-side ID stable)
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMsgId
                ? { ...m, isStreaming: false }
                : m,
            ),
          );
          finishStream();
        },

        // P4: Use structured rate limit flag from stream-handler
        onError: (errorMessage: string, options?: StreamErrorOptions) => {
          // AC #5: Preserve partial message on error
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMsgId && m.isStreaming
                ? { ...m, isStreaming: false }
                : m,
            ),
          );

          if (options?.rateLimited) {
            const cooldownSeconds = options.retryAfterSeconds ?? 5;
            setIsRateLimited(true);
            rateLimitedRef.current = true;
            rateLimitTimerRef.current = setTimeout(() => {
              setIsRateLimited(false);
              rateLimitedRef.current = false;
              rateLimitTimerRef.current = null;
            }, cooldownSeconds * 1000);
          }

          showError(errorMessage);
          finishStream();
        },
      });

      streamHandleRef.current = handle;
    },
    [agentId, clearError, finishStream, showError],
  );

  // Called when TypingIndicator fires its 30s timeout with no API response
  const handleTimeout = useCallback(() => {
    if (!loadingRef.current) return;
    // If we're streaming (first chunk arrived), don't treat typing timeout as error
    if (streamHandleRef.current && streamContentRef.current) return;
    // No chunks arrived within 30s — abort and show error
    streamHandleRef.current?.abort();
    finishStream();
    showError('Response took too long. Please try again.');
  }, [finishStream, showError]);

  return {
    messages,
    isLoading,
    isStreaming,
    isRateLimited,
    error,
    sendMessage,
    stopStream,
    clearError,
    handleTimeout,
  };
}
