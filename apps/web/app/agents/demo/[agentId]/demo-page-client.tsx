'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Bot, User } from 'lucide-react';
import Link from 'next/link';
import { apiUrl } from '@/config/api';
import { ChatMessageContent } from '@/components/features/chat/chat-message-content';
import { VoiceMicButton } from '@/components/features/chat/voice-mic-button';
import { VoiceErrorBanner } from '@/components/features/chat/voice-error-banner';
import { useVoice } from '@/hooks/use-voice';

interface Starter {
  message: string;
}

interface AgentVoiceConfig {
  sttEnabled: boolean;
  ttsEnabled: boolean;
  defaultLanguage: string;
  supportedLanguages: string[];
  autoDetectLanguage: boolean;
}

interface AgentDemoInfo {
  id: string;
  publicId: string;
  name: string;
  welcomeMessage: string | null;
  theme: {
    starters?: Starter[];
    [key: string]: unknown;
  } | null;
  voiceConfig: AgentVoiceConfig | null;
}

interface Message {
  id: string;
  role: 'user' | 'bot' | 'system';
  content: string;
  timestamp: Date;
}

interface DemoPageClientProps {
  agentId: string;
}

const STREAM_TIMEOUT_MS = 45_000;
const TYPEWRITER_MS = 12;
const TYPEWRITER_CHARS = 2;

export function DemoPageClient({ agentId }: DemoPageClientProps) {
  const [agent, setAgent] = useState<AgentDemoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [startersVisible, setStartersVisible] = useState(true);
  const [voiceSessionId, setVoiceSessionId] = useState<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const voiceBotMsgIdRef = useRef<string | null>(null);

  // Typewriter animation state (declared before useVoice so voice callbacks can reference them)
  const typewriterBufferRef = useRef('');
  const typewriterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTypewriter = useCallback(() => {
    if (typewriterIntervalRef.current) {
      clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
  }, []);

  const flushTypewriterBuffer = useCallback(
    (botId: string) => {
      const remaining = typewriterBufferRef.current;
      if (remaining) {
        typewriterBufferRef.current = '';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: m.content + remaining } : m,
          ),
        );
      }
      stopTypewriter();
    },
    [stopTypewriter],
  );

  const startTypewriter = useCallback(
    (botId: string) => {
      stopTypewriter();
      typewriterIntervalRef.current = setInterval(() => {
        const buf = typewriterBufferRef.current;
        if (!buf) return;
        const chars = buf.slice(0, TYPEWRITER_CHARS);
        typewriterBufferRef.current = buf.slice(TYPEWRITER_CHARS);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: m.content + chars } : m,
          ),
        );
      }, TYPEWRITER_MS);
    },
    [stopTypewriter],
  );

  // Voice
  const voiceEnabled = !!agent?.voiceConfig;
  const {
    voiceState,
    startRecording,
    stopRecording,
    stopPlayback,
    clearError: clearVoiceError,
    recordingDurationMs,
    error: voiceError,
    errorCode: voiceErrorCode,
    isSupported: voiceSupported,
  } = useVoice({
    agentId,
    sessionId: voiceSessionId,
    source: 'DEMO',
    onTranscription: useCallback((text: string) => {
      setStartersVisible(false);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: text, timestamp: new Date() },
      ]);
    }, []),
    onResponseTextChunk: useCallback((sentenceText: string) => {
      // Feed sentence text into typewriter buffer for smooth char-by-char display
      if (!voiceBotMsgIdRef.current) {
        const id = crypto.randomUUID();
        voiceBotMsgIdRef.current = id;
        streamingMsgIdRef.current = id;
        typewriterBufferRef.current = sentenceText;
        setIsStreaming(true);
        setMessages((prev) => [
          ...prev,
          { id, role: 'bot', content: '', timestamp: new Date() },
        ]);
        startTypewriter(id);
      } else {
        // Append space + next sentence to the typewriter buffer
        typewriterBufferRef.current += ' ' + sentenceText;
      }
    }, [startTypewriter]),
    onResponse: useCallback((reply: string, newSessionId: string) => {
      sessionIdRef.current = newSessionId;
      setVoiceSessionId(newSessionId);
      if (voiceBotMsgIdRef.current) {
        // Flush any remaining typewriter buffer
        flushTypewriterBuffer(voiceBotMsgIdRef.current);
        streamingMsgIdRef.current = null;
        setIsStreaming(false);
      } else if (reply) {
        // No text chunks arrived (TTS failed) — add full reply as fallback
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'bot', content: reply, timestamp: new Date() },
        ]);
      }
      voiceBotMsgIdRef.current = null;
    }, [flushTypewriterBuffer]),
  });

  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch(apiUrl(`/public/agents/${agentId}/demo`));
        if (!res.ok) {
          if (res.status === 404) {
            setError('Agent not found or inactive.');
          } else {
            setError('Failed to load agent information.');
          }
          return;
        }
        const data: AgentDemoInfo = await res.json();
        setAgent(data);
      } catch {
        setError('Failed to connect to the server.');
      } finally {
        setLoading(false);
      }
    }
    fetchAgent();
  }, [agentId]);

  // Abort in-flight stream on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      stopTypewriter();
    };
  }, [stopTypewriter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessageToBackend = useCallback(
    async (content: string, priorHistory: Message[] = []) => {
      if (!agent) return;

      // Abort any previous in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const botId = crypto.randomUUID();
      streamingMsgIdRef.current = botId;
      setIsTyping(true);

      let buffer = '';

      // Shape the history into the backend's accepted format. 'bot' → 'assistant',
      // 'system' entries (welcome banner etc.) are dropped — the agent's system
      // prompt owns its own greeting, so those aren't real LLM-visible turns.
      // Send up to last 20; server enforces the agent's `maxContextMessages` cap.
      const recentHistory = priorHistory
        .filter((m) => m.role === 'user' || m.role === 'bot')
        .map((m) => ({
          role: m.role === 'bot' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        }))
        .slice(-20);

      try {
        const res = await fetch(apiUrl('/public/chat/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: agent.id,
            chatInput: content,
            source: 'DEMO',
            ...(sessionIdRef.current && { sessionId: sessionIdRef.current }),
            // Send client-held history so the backend can skip its DB
            // lookup for prior messages — saves ~150-450ms per turn.
            ...(recentHistory.length > 0 && { recentHistory }),
          }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(STREAM_TIMEOUT_MS),
          ]),
        });

        if (!res.ok) {
          throw new Error(`Server error: ${res.status}`);
        }

        if (!res.body) {
          throw new Error('No response body');
        }

        // Transition from typing to streaming: create empty bot message
        setIsTyping(false);
        setIsStreaming(true);
        typewriterBufferRef.current = '';
        setMessages((prev) => [
          ...prev,
          { id: botId, role: 'bot', content: '', timestamp: new Date() },
        ]);
        startTypewriter(botId);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const events = buffer.split('\n\n');
            // Keep the last piece as it may be incomplete
            buffer = events.pop() ?? '';

            for (const event of events) {
              const dataLine = event
                .split('\n')
                .find((line) => line.startsWith('data: '));
              if (!dataLine) continue;

              const jsonStr = dataLine.slice(6);
              let parsed: {
                type: string;
                content?: string;
                sessionId?: string;
                message?: string;
              };
              try {
                parsed = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              if (parsed.type === 'chunk' && parsed.content) {
                typewriterBufferRef.current += parsed.content;
              } else if (parsed.type === 'done') {
                if (parsed.sessionId) {
                  sessionIdRef.current = parsed.sessionId;
                  if (parsed.sessionId) setVoiceSessionId(parsed.sessionId);
                }
              } else if (parsed.type === 'error') {
                // Remove empty bot message on error, keep partial content
                setMessages((prev) => {
                  const cleaned = prev.filter(
                    (m) => !(m.id === botId && m.content === ''),
                  );
                  return [
                    ...cleaned,
                    {
                      id: crypto.randomUUID(),
                      role: 'system' as const,
                      content:
                        parsed.message ??
                        'An error occurred while processing your message.',
                      timestamp: new Date(),
                    },
                  ];
                });
              }
            }
          }
        } finally {
          reader.releaseLock();
          flushTypewriterBuffer(botId);
        }
      } catch (err) {
        // Ignore abort errors from unmount/cancellation
        if (err instanceof DOMException && err.name === 'AbortError') {
          stopTypewriter();
          return;
        }

        setIsTyping(false);
        setMessages((prev) => {
          // Remove empty bot message if streaming hadn't started with content
          const filtered = prev.filter(
            (m) => !(m.id === botId && m.content === ''),
          );
          return [
            ...filtered,
            {
              id: crypto.randomUUID(),
              role: 'system',
              content:
                err instanceof DOMException && err.name === 'TimeoutError'
                  ? 'Request timed out. Please try again.'
                  : 'Unable to connect. Please check your connection and try again.',
              timestamp: new Date(),
            },
          ];
        });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        streamingMsgIdRef.current = null;
        setIsStreaming(false);
        setIsTyping(false);
        inputRef.current?.focus();
      }
    },
    [agent, startTypewriter, flushTypewriterBuffer, stopTypewriter],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || !agent || isTyping || isStreaming) return;

      setStartersVisible(false);

      // Snapshot history BEFORE appending the new user message. The backend
      // treats `chatInput` as the current turn; `recentHistory` is prior turns
      // only. Passed explicitly because the `setMessages` below is async and
      // a closure capture of `messages` would show stale data inside
      // sendMessageToBackend on the next render.
      const historySnapshot = messages;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      await sendMessageToBackend(content.trim(), historySnapshot);
    },
    [agent, isTyping, isStreaming, messages, sendMessageToBackend],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input).catch(() => {});
  };

  const handleStarterClick = (starter: Starter) => {
    sendMessage(starter.message).catch(() => {});
  };

  const isVoiceActive = voiceState !== 'idle';
  const isBusy = isTyping || isStreaming || isVoiceActive;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Bot className="mx-auto h-16 w-16 text-gray-300" />
          <h2 className="mt-4 text-xl font-semibold text-gray-700">
            {error ?? 'Agent not available'}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            This agent may be inactive or does not exist.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm text-blue-600 hover:underline"
          >
            Go to homepage
          </Link>
        </div>
      </div>
    );
  }

  const starters = agent.theme?.starters ?? [];
  const welcomeMessage =
    agent.welcomeMessage ?? `Hi! I'm ${agent.name}. How can I help you today?`;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center gap-3 border-b bg-white px-4 py-3 shadow-sm">
        <Link
          href="/dashboard/agents"
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-900">{agent.name}</h1>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-gray-500">Online</span>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {/* Welcome Message */}
            <div className="mb-6 flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-gray-800 shadow-sm">
                {welcomeMessage}
              </div>
            </div>

            {/* Conversation Starters */}
            {startersVisible && starters.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-2 pl-11">
                {starters.map((starter, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleStarterClick(starter)}
                    disabled={isBusy}
                    className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {starter.message}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) =>
              msg.role === 'system' ? (
                <div key={msg.id} className="mb-4 flex justify-center">
                  <div className="max-w-[80%] rounded-lg bg-gray-200 px-4 py-2 text-sm italic text-gray-600">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div
                  key={msg.id}
                  className={`mb-4 flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                      msg.role === 'user' ? 'bg-gray-500' : 'bg-blue-600'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <User className="h-4 w-4" />
                    ) : (
                      agent.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                      msg.role === 'user'
                        ? 'rounded-tr-sm bg-blue-600 text-white'
                        : 'rounded-tl-sm bg-white text-gray-800'
                    }`}
                  >
                    {msg.role === 'bot' ? (
                      <ChatMessageContent
                        content={msg.content}
                        isStreaming={isStreaming && msg.id === streamingMsgIdRef.current}
                      />
                    ) : (
                      msg.content || '\u00A0'
                    )}
                  </div>
                </div>
              ),
            )}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="mb-4 flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {agent.name.charAt(0).toUpperCase()}
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t bg-white px-4 py-3">
            {voiceError && (
              <VoiceErrorBanner
                error={voiceError}
                errorCode={voiceErrorCode}
                onDismiss={clearVoiceError}
              />
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={voiceState === 'listening' ? 'Recording...' : 'Type a message...'}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                disabled={isBusy}
              />
              {voiceEnabled && voiceSupported && (
                <VoiceMicButton
                  voiceState={voiceState}
                  recordingDurationMs={recordingDurationMs}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  onStopPlayback={stopPlayback}
                  disabled={isTyping || isStreaming}
                />
              )}
              <button
                type="submit"
                disabled={!input.trim() || isBusy}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <p className="mt-2 text-center text-xs text-gray-400">
              Powered by Klivo
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
