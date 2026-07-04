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
  handoverState,
  agentTyping,
  upsertStreamStep,
  clearStreamSteps,
} from '../state/chat-store';
import type { Message, Citation } from '../types/message';
import { startStream } from '../services/stream-handler';
import type { StreamHandle, StreamErrorOptions } from '../services/stream-handler';
import type { SSEStepEvent, SSEDoneEvent } from '../utils/sse-parser';
import type { ChatHistoryItem, PollResponse } from '../services/api-client';
import { requestHuman as requestHumanApi } from '../services/api-client';
import { startHandoverPoll, type HandoverPollHandle } from '../services/handover-poller';
import {
  connectHandoverSocket,
  disconnectHandoverSocket,
  emitVisitorTyping,
  isHandoverSocketConnected,
} from '../services/handover-socket';
import {
  getSessionId,
  updateSession,
  persistHandoverSession,
  clearHandoverSession,
  getPersistedHandoverSession,
} from '../services/session-manager';

/** Cap on history sent to the backend; server enforces agent's maxContextMessages further. */
const MAX_HISTORY_TO_SEND = 20;
const GREETING_ID = '__greeting__';
/**
 * Prefix for a human teammate's replies in the history sent to the backend, so
 * the model can distinguish them from its own turns (both go as `assistant`).
 * Keep in sync with the API (context-assembly.service.ts HUMAN_AGENT_LABEL).
 */
const HUMAN_AGENT_LABEL = '[Human teammate]: ';
/**
 * Prefix for handover status lines (took over / resolved / …) in the history
 * sent to the backend, so the model reads them as events. Keep in sync with the
 * API (context-assembly.service.ts SYSTEM_LABEL).
 */
const SYSTEM_LABEL = '[System]: ';

// Handover receive cadence. The socket is primary; the poll is a reconcile
// safety-net — slow while the socket is up, fast when it's down.
const HANDOVER_POLL_SLOW_MS = 12_000;
const HANDOVER_POLL_FAST_MS = 2_500;
/** How long an "agent is typing" indicator lingers after the last typing ping. */
const AGENT_TYPING_CLEAR_MS = 4_000;

export interface UseChatOptions {
  agentId: string;
}

export interface UseChatReturn {
  sendMessage: (text: string) => void;
  requestHuman: () => void;
  notifyTyping: () => void;
  notifyHandover: (state: 'NONE' | 'REQUESTED' | 'ACTIVE_HUMAN') => void;
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
  /** Active handover poller (only runs while a chat is escalated). */
  const pollHandleRef = useRef<HandoverPollHandle | null>(null);
  /** Backend message ids already added to the store (dedupe across polls). */
  const handoverSeenIds = useRef<Set<string>>(new Set());
  /** Auto-clear timer for the "agent is typing" indicator. */
  const agentTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup all timers, active stream, handover poller + socket on unmount
  useEffect(() => {
    const errorTimer = errorTimerRef;
    const rateLimitTimer = rateLimitTimerRef;
    const streamHandle = streamHandleRef;
    const pollHandle = pollHandleRef;
    const agentTypingTimer = agentTypingTimerRef;
    return () => {
      if (errorTimer.current !== null) clearTimeout(errorTimer.current);
      if (rateLimitTimer.current !== null) clearTimeout(rateLimitTimer.current);
      if (agentTypingTimer.current !== null) clearTimeout(agentTypingTimer.current);
      streamHandle.current?.abort();
      pollHandle.current?.stop();
      disconnectHandoverSocket();
    };
  }, []);

  /** Clear the "agent is typing" indicator and its idle timer. */
  const clearAgentTyping = useCallback(() => {
    agentTyping.value = false;
    if (agentTypingTimerRef.current !== null) {
      clearTimeout(agentTypingTimerRef.current);
      agentTypingTimerRef.current = null;
    }
  }, []);

  // ── Human handover: receive loop (poll-while-escalated) ──────────────

  /** Apply one poll response: append the human's new messages + track state. */
  const handlePollUpdate = useCallback(
    (data: PollResponse) => {
      // Empty store = a reload mid-handover → rebuild the prior thread too.
      const isReconnectRebuild = messages.value.length === 0;
      for (const m of data.messages) {
        if (handoverSeenIds.current.has(m.id)) continue;
        if (m.role === 'HUMAN_AGENT') {
          handoverSeenIds.current.add(m.id);
          addMessage({ id: m.id, role: 'human', content: m.content, timestamp: new Date(m.createdAt) });
          // Their reply landed → they're no longer "typing".
          clearAgentTyping();
        } else if (m.role === 'SYSTEM') {
          // Handover status lines are NOT shown to the visitor (internal
          // wording), but we keep them (hidden) so they ride along in
          // recentHistory — the bot then knows a human joined + when it was
          // handed back, instead of re-offering a human that already came.
          handoverSeenIds.current.add(m.id);
          addMessage({ id: m.id, role: 'system', content: m.content, timestamp: new Date(m.createdAt) });
        } else if (isReconnectRebuild && (m.role === 'USER' || m.role === 'ASSISTANT')) {
          handoverSeenIds.current.add(m.id);
          addMessage({
            id: m.id,
            role: m.role === 'USER' ? 'user' : 'assistant',
            content: m.content,
            timestamp: new Date(m.createdAt),
          });
        }
        // SYSTEM messages are dashboard-internal — never shown to the visitor.
      }
      handoverState.value = data.handoverState;
      if (data.handoverState === 'NONE') {
        clearHandoverSession(agentId);
        pollHandleRef.current = null; // the poller stops itself once state is NONE
        disconnectHandoverSocket();
        clearAgentTyping();
      }
    },
    [agentId, clearAgentTyping],
  );

  /**
   * Start receiving the human's replies (no-op if already active). Opens the
   * realtime socket (instant agent-typing + message pings) AND the poll loop
   * (reconcile fallback — slow while the socket is up, fast when it's down).
   */
  const startHandoverPolling = useCallback(() => {
    if (pollHandleRef.current) return;
    const sid = getSessionId();
    if (!sid) return;
    connectHandoverSocket(sid, {
      onAgentTyping: () => {
        agentTyping.value = true;
        if (agentTypingTimerRef.current !== null) clearTimeout(agentTypingTimerRef.current);
        agentTypingTimerRef.current = setTimeout(() => {
          agentTyping.value = false;
          agentTypingTimerRef.current = null;
        }, AGENT_TYPING_CLEAR_MS);
      },
      onPing: () => pollHandleRef.current?.poke(),
    });
    pollHandleRef.current = startHandoverPoll(agentId, sid, {
      getIntervalMs: () =>
        isHandoverSocketConnected() ? HANDOVER_POLL_SLOW_MS : HANDOVER_POLL_FAST_MS,
      onUpdate: handlePollUpdate,
      onError: () => {
        /* transient — the next tick retries; a 404/410 clears the session */
      },
    });
  }, [agentId, handlePollUpdate]);

  /**
   * Apply a handover-state signal (from the text stream OR a voice turn):
   * NONE → tear down; REQUESTED/ACTIVE_HUMAN → persist the session + start
   * receiving the teammate's replies. Shared so voice reaches parity with text.
   */
  const handleHandover = useCallback(
    (state: 'NONE' | 'REQUESTED' | 'ACTIVE_HUMAN') => {
      handoverState.value = state;
      if (state === 'NONE') {
        clearHandoverSession(agentId);
        pollHandleRef.current?.stop();
        pollHandleRef.current = null;
        disconnectHandoverSocket();
        clearAgentTyping();
      } else {
        const sid = getSessionId();
        if (sid) persistHandoverSession(agentId, sid);
        startHandoverPolling();
      }
    },
    [agentId, clearAgentTyping, startHandoverPolling],
  );

  // Reconnect: if this tab was reloaded mid-handover, session-manager restored
  // the session — resume polling so the human's chat continues seamlessly.
  useEffect(() => {
    if (getPersistedHandoverSession(agentId)) {
      startHandoverPolling();
    }
  }, [agentId, startHandoverPolling]);

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
      clearStreamSteps();
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
            (m.role === 'user' ||
              m.role === 'assistant' ||
              m.role === 'human' ||
              m.role === 'system') &&
            typeof m.content === 'string' &&
            m.content.length > 0,
        )
        .slice(-MAX_HISTORY_TO_SEND)
        .map((m) => ({
          // Everything that isn't the visitor rides the `assistant` role, but a
          // human teammate's reply and handover status lines are LABELLED so the
          // bot can tell them apart from its own turns — giving it full context
          // when it resumes (who joined, what they said, when it was handed
          // back) instead of mis-reading a repeat frustration as new.
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content:
            m.role === 'human'
              ? `${HUMAN_AGENT_LABEL}${m.content}`
              : m.role === 'system'
                ? `${SYSTEM_LABEL}${m.content}`
                : m.content,
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
        clearStreamSteps();
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

        onStep: (step: SSEStepEvent) => {
          if (streamAbortedRef.current) return;
          upsertStreamStep(step);
        },

        onDone: (_sessionId: string, _messageId: string, metadata: SSEDoneEvent['metadata']) => {
          if (streamAbortedRef.current) return;
          // Attach knowledge-base citations (if any) so the bubble can render
          // its sources footer. The text keeps its inline [n] markers as-is.
          const citations = Array.isArray(metadata.citations)
            ? (metadata.citations as Citation[])
            : [];
          updateMessage(botMsgId, {
            isStreaming: false,
            status: 'sent',
            ...(citations.length > 0 ? { citations } : {}),
          });
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

        onHandover: (state: string) =>
          handleHandover(state as 'NONE' | 'REQUESTED' | 'ACTIVE_HUMAN'),
        },
        recentHistory,
      );

      streamHandleRef.current = handle;
    },
    [agentId, clearError, finishStream, showError, handleHandover],
  );

  // Explicit "talk to a human" button. Unlike a typed message, this escalates
  // DETERMINISTICALLY server-side with NO LLM call — so we show the request +
  // an instant canned acknowledgment ourselves rather than waiting on a stream.
  const requestHuman = useCallback(() => {
    if (loadingRef.current || rateLimitedRef.current) return;

    // Optimistically show their request immediately.
    addMessage({
      id: generateMessageId('user'),
      role: 'user',
      content: "I'd like to talk to a human.",
      timestamp: new Date(),
    });

    void (async () => {
      try {
        const sid = getSessionId() ?? undefined;
        const res = await requestHumanApi(agentId, sid);
        updateSession(agentId, res.sessionId);
        // Setting the state shows the handover-state-driven "connecting you…"
        // status line in the widget (survives reload — no fragile message).
        handoverState.value = res.handoverState;
        if (res.handoverState !== 'NONE') {
          persistHandoverSession(agentId, res.sessionId);
          startHandoverPolling();
        }
      } catch {
        showError('Could not connect you to a human right now. Please try again.');
      }
    })();
  }, [agentId, showError, startHandoverPolling]);

  // Visitor typing → tell the connected agent (throttled, no-op unless a
  // handover socket is open). Safe to call on every keystroke.
  const notifyTyping = useCallback(() => {
    emitVisitorTyping();
  }, []);

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
    requestHuman,
    notifyTyping,
    notifyHandover: handleHandover,
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
