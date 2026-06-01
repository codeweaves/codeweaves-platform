/**
 * useChat hook — streaming orchestration and chat actions (Story 5-18, 5-19, 5-21).
 *
 * State lives in the centralized chat store (signals). This hook handles
 * streaming lifecycle, error timers, rate-limit cooldown, and voice helpers.
 */

import { useCallback, useRef, useEffect } from 'preact/hooks';
import { batch } from '@preact/signals';
import {
  isLoading,
  isStreaming,
  isRateLimited,
  error,
  streamingMessageId,
  messages,
  addMessage,
  updateMessage,
  appendMessageContent,
  generateMessageId,
} from '../state/chat-store';
import type { Message } from '../types/message';
import { startStream } from '../services/stream-handler';
import type { StreamHandle, StreamErrorOptions } from '../services/stream-handler';
import type { ChatHistoryItem } from '../services/api-client';

/** Cap on history sent to the backend; server enforces agent's maxContextMessages further. */
const MAX_HISTORY_TO_SEND = 20;
const GREETING_ID = '__greeting__';

export interface UseChatOptions {
  agentId: string;
}

export interface UseChatReturn {
  sendMessage: (text: string) => void;
  stopStream: () => void;
  clearError: () => void;
  handleTimeout: () => void;
  addUserMessage: (text: string) => void;
  createBotMessage: () => string;
  appendBotMessageText: (botMsgId: string, text: string) => void;
  finalizeBotMessage: (botMsgId: string, fullText?: string) => void;
  setVoiceLoading: (loading: boolean) => void;
}

export function useChat({ agentId }: UseChatOptions): UseChatReturn {
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const rateLimitedRef = useRef(false);
  const streamHandleRef = useRef<StreamHandle | null>(null);
  const streamContentRef = useRef('');
  /** Guard against store mutations from late async callbacks after abort/unmount */
  const streamAbortedRef = useRef(false);

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
    error.value = null;
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const showError = useCallback((message: string) => {
    error.value = message;
    if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      error.value = null;
      errorTimerRef.current = null;
    }, 5000);
  }, []);

  const finishStream = useCallback(() => {
    streamAbortedRef.current = true;
    batch(() => {
      isLoading.value = false;
      isStreaming.value = false;
      streamingMessageId.value = null;
    });
    loadingRef.current = false;
    streamHandleRef.current = null;
    streamContentRef.current = '';
  }, []);

  const stopStream = useCallback(() => {
    if (!streamHandleRef.current) return;
    streamHandleRef.current.abort();

    // Finalize partial message as-is (preserve partial on cancel)
    const currentStreamId = streamingMessageId.value;
    if (currentStreamId) {
      updateMessage(currentStreamId, { isStreaming: false });
    }
    finishStream();
  }, [finishStream]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loadingRef.current || rateLimitedRef.current) return;

      // Abort any existing stream before starting a new one
      if (streamHandleRef.current) {
        streamHandleRef.current.abort();
        streamHandleRef.current = null;
      }

      loadingRef.current = true;
      streamAbortedRef.current = false;
      clearError();

      // Snapshot prior history BEFORE adding the new user message — backend
      // treats `chatInput` as the current turn, `recentHistory` as prior turns.
      // Drop the greeting bubble (it's a UI-only welcome, not an LLM turn) and
      // drop empty / streaming bot messages. Capped client-side; server caps
      // further via `aiConfig.maxContextMessages`.
      const recentHistory: ChatHistoryItem[] = messages.value
        .filter(
          (m) =>
            m.id !== GREETING_ID &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.length > 0,
        )
        .slice(-MAX_HISTORY_TO_SEND)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Optimistic UI — add user message immediately
      const userMsg: Message = {
        id: generateMessageId('user'),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };

      batch(() => {
        addMessage(userMsg);
        isLoading.value = true;
      });

      const botMsgId = generateMessageId('bot');
      streamContentRef.current = '';

      const handle = startStream(
        agentId,
        trimmed,
        {
        onFirstChunk: (content: string) => {
          if (streamAbortedRef.current) return;
          streamContentRef.current = content;
          const botMsg: Message = {
            id: botMsgId,
            role: 'assistant',
            content,
            timestamp: new Date(),
            isStreaming: true,
          };
          batch(() => {
            addMessage(botMsg);
            isStreaming.value = true;
            streamingMessageId.value = botMsgId;
          });
        },

        onChunk: (content: string) => {
          if (streamAbortedRef.current) return;
          streamContentRef.current += content;
          updateMessage(botMsgId, { content: streamContentRef.current });
        },

        onDone: () => {
          if (streamAbortedRef.current) return;
          updateMessage(botMsgId, { isStreaming: false, status: 'sent' });
          finishStream();
        },

        onError: (errorMessage: string, options?: StreamErrorOptions) => {
          if (streamAbortedRef.current) return;
          // Preserve partial message on error
          updateMessage(botMsgId, { isStreaming: false });

          if (options?.rateLimited) {
            const cooldownSeconds = options.retryAfterSeconds ?? 5;
            isRateLimited.value = true;
            rateLimitedRef.current = true;
            rateLimitTimerRef.current = setTimeout(() => {
              isRateLimited.value = false;
              rateLimitedRef.current = false;
              rateLimitTimerRef.current = null;
            }, cooldownSeconds * 1000);
          }

          showError(errorMessage);
          finishStream();
        },
        },
        recentHistory,
      );

      streamHandleRef.current = handle;
    },
    [agentId, clearError, finishStream, showError],
  );

  const handleTimeout = useCallback(() => {
    if (!loadingRef.current) return;
    if (streamHandleRef.current && streamContentRef.current) return;
    streamHandleRef.current?.abort();
    finishStream();
    showError('Response took too long. Please try again.');
  }, [finishStream, showError]);

  // ── Voice message helpers (Story 5-20) ──────────────────────────────

  const addUserMessage = useCallback((text: string) => {
    const userMsg: Message = {
      id: generateMessageId('user'),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    addMessage(userMsg);
  }, []);

  const createBotMessage = useCallback((): string => {
    const botMsgId = generateMessageId('bot');
    const botMsg: Message = {
      id: botMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    addMessage(botMsg);
    return botMsgId;
  }, []);

  const appendBotMessageText = useCallback((botMsgId: string, text: string) => {
    appendMessageContent(botMsgId, text);
  }, []);

  const finalizeBotMessage = useCallback((botMsgId: string, fullText?: string) => {
    updateMessage(botMsgId, {
      isStreaming: false,
      ...(fullText !== undefined ? { content: fullText } : {}),
    });
  }, []);

  const setVoiceLoading = useCallback((loading: boolean) => {
    isLoading.value = loading;
    loadingRef.current = loading;
  }, []);

  return {
    sendMessage,
    stopStream,
    clearError,
    handleTimeout,
    addUserMessage,
    createBotMessage,
    appendBotMessageText,
    finalizeBotMessage,
    setVoiceLoading,
  };
}
