/**
 * useChat hook — core chat state management (Story 5-18, Task 1).
 *
 * Manages messages, loading state, error state, and rate-limit cooldown.
 * Wires together API client, session manager, and device ID services.
 */

import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import type { ChatMessage } from '../types';
import { sendMessage as apiSendMessage } from '../services/api-client';
import { WidgetApiError } from '../services/api-errors';

export interface UseChatOptions {
  agentId: string;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isRateLimited: boolean;
  error: string | null;
  sendMessage: (text: string) => void;
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
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against concurrent sends (ref stays current across renders)
  const loadingRef = useRef(false);
  const rateLimitedRef = useRef(false);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
      if (rateLimitTimerRef.current !== null) clearTimeout(rateLimitTimerRef.current);
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      // Use refs for guards — immune to stale closures
      if (!trimmed || loadingRef.current || rateLimitedRef.current) return;

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

      // API call — session ID and device ID are auto-resolved by api-client
      apiSendMessage(agentId, trimmed)
        .then((response) => {
          const botMsg: ChatMessage = {
            id: response.assistantMessageId || generateId('bot'),
            role: 'assistant',
            content: response.reply,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, botMsg]);
        })
        .catch((err: unknown) => {
          if (err instanceof WidgetApiError && err.status === 429) {
            // Rate limit — show error and start cooldown
            setError(err.userMessage);
            const cooldownSeconds = err.retryAfterSeconds ?? 5;
            setIsRateLimited(true);
            rateLimitedRef.current = true;
            rateLimitTimerRef.current = setTimeout(() => {
              setIsRateLimited(false);
              rateLimitedRef.current = false;
              rateLimitTimerRef.current = null;
            }, cooldownSeconds * 1000);
          } else if (err instanceof WidgetApiError) {
            setError(err.userMessage);
          } else {
            setError('Something went wrong. Please try again.');
          }

          // Auto-dismiss error after 5 seconds
          errorTimerRef.current = setTimeout(() => {
            setError(null);
            errorTimerRef.current = null;
          }, 5000);
        })
        .finally(() => {
          setIsLoading(false);
          loadingRef.current = false;
        });
    },
    [agentId, clearError],
  );

  // Called when TypingIndicator fires its 30s timeout with no API response
  const handleTimeout = useCallback(() => {
    if (!loadingRef.current) return;
    setIsLoading(false);
    loadingRef.current = false;
    setError('Response took too long. Please try again.');
    errorTimerRef.current = setTimeout(() => {
      setError(null);
      errorTimerRef.current = null;
    }, 5000);
  }, []);

  return { messages, isLoading, isRateLimited, error, sendMessage, clearError, handleTimeout };
}
