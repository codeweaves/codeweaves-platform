/**
 * ChatWidgetSurface — renders the chat widget UI using Tailwind classes.
 *
 * This component mirrors the agent editor preview (chat-widget-surface.tsx in apps/web)
 * so they always look identical. Any visual change here should be made in the preview too.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import type { ChatMessage } from '../types';
import {
  Minimize2Icon,
  XIcon,
  BotIcon,
  SettingsIcon,
  ZapIcon,
  HeadphonesIcon,
  UserIcon,
  UserCheckIcon,
  SendIcon,
  MicIcon,
  SquareIcon,
  Loader2Icon,
  Volume2Icon,
} from './icons';
import { messages as messagesSignal, showTyping, widgetState, isLoading, isStreaming, isRateLimited } from '../state/chat-store';
import { useChat } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import { isSafeUrl } from '../utils/url';
import { renderMarkdown } from '../utils/simple-markdown';
import type { AgentConfig } from '../types';

export interface ChatWidgetSurfaceProps {
  agentId: string;
  agentConfig: AgentConfig;
  theme: Record<string, unknown> | null;
  position: 'left' | 'right';
}

// ── Theme field extraction helpers ──────────────────────────────────

function str(obj: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const v = obj?.[key];
  return typeof v === 'string' ? v : fallback;
}

function num(obj: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = obj?.[key];
  return typeof v === 'number' ? v : fallback;
}

function bool(obj: Record<string, unknown> | undefined, key: string, fallback = false): boolean {
  const v = obj?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

function section(theme: Record<string, unknown> | null, key: string): Record<string, unknown> | undefined {
  if (!theme) return undefined;
  const v = theme[key];
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
}

// ── Avatar helpers (exact copy from preview) ────────────────────────

function getAvatarClass(shape: string): string {
  const shapeClass =
    shape === 'circle' ? 'rounded-full' :
    shape === 'rounded' ? 'rounded-lg' :
    shape === 'square' ? 'rounded-none' : 'rounded-full';
  return `w-10 h-10 ${shapeClass} flex items-center justify-center text-sm font-medium`;
}

function BotAvatarContent({ type, customImage }: { type: string; customImage?: string }) {
  const iconProps = { class: 'w-6 h-6' };
  switch (type) {
    case 'machine': return <SettingsIcon {...iconProps} />;
    case 'bot': return <ZapIcon {...iconProps} />;
    case 'support': return <HeadphonesIcon {...iconProps} />;
    case 'custom': return customImage
      ? <img src={customImage} alt="Bot" class="w-8 h-8 rounded-full object-cover" />
      : <span>B</span>;
    case 'robot': default: return <BotIcon {...iconProps} />;
  }
}

function UserAvatarContent({ type, customImage }: { type: string; customImage?: string }) {
  const iconProps = { class: 'w-6 h-6' };
  switch (type) {
    case 'female': return <UserCheckIcon {...iconProps} />;
    case 'custom': return customImage
      ? <img src={customImage} alt="User" class="w-8 h-8 rounded-full object-cover" />
      : <span>U</span>;
    case 'male': default: return <UserIcon {...iconProps} />;
  }
}

function formatTimestamp(ts: Date): string {
  return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Main component ──────────────────────────────────────────────────

export function ChatWidgetSurface({ agentId, agentConfig, theme, position }: ChatWidgetSurfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Store signals
  const msgs = messagesSignal.value;
  const isTyping = showTyping.value;
  const loading = isLoading.value;
  const streaming = isStreaming.value;
  const rateLimited = isRateLimited.value;

  // Chat actions
  const {
    sendMessage, addUserMessage, createBotMessage,
    appendBotMessageText, finalizeBotMessage, setVoiceLoading,
  } = useChat({ agentId });

  // ── Theme extraction ────────────────────────────────────────────
  const header = section(theme, 'header');
  const botAvatar = section(theme, 'botAvatar');
  const userAvatar = section(theme, 'userAvatar');
  const userMessage = section(theme, 'userMessage');
  const botMessage = section(theme, 'botMessage');
  const body = section(theme, 'body');
  const timestamps = section(theme, 'timestamps');
  const input = section(theme, 'input');
  const sendBtn = section(theme, 'sendButton');
  const branding = section(theme, 'branding');
  const typo = section(theme, 'typography');
  const animations = section(theme, 'animations');

  const iconOnRight = position === 'right';

  // Starters from theme
  const starters = useMemo(() => {
    const raw = theme?.starters;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s: unknown) => {
        if (typeof s === 'string') return s;
        if (typeof s === 'object' && s !== null && 'message' in s) return String((s as Record<string, unknown>).message);
        return '';
      })
      .filter((s: string) => s.trim().length > 0)
      .slice(0, 4);
  }, [theme]);

  // Voice config from agentConfig
  const voiceEnabled = agentConfig.voiceEnabled === true;

  // Typewriter state for voice
  const typewriterBufferRef = useRef('');
  const typewriterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceBotMsgIdRef = useRef<string | null>(null);
  const TYPEWRITER_MS = 12;
  const TYPEWRITER_CHARS = 2;

  const stopTypewriter = useCallback(() => {
    if (typewriterIntervalRef.current) {
      clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
  }, []);

  const flushTypewriter = useCallback(() => {
    stopTypewriter();
    if (voiceBotMsgIdRef.current && typewriterBufferRef.current) {
      appendBotMessageText(voiceBotMsgIdRef.current, typewriterBufferRef.current);
      typewriterBufferRef.current = '';
    }
  }, [stopTypewriter, appendBotMessageText]);

  const startTypewriter = useCallback(() => {
    if (typewriterIntervalRef.current) return;
    typewriterIntervalRef.current = setInterval(() => {
      if (!typewriterBufferRef.current || !voiceBotMsgIdRef.current) return;
      const chars = typewriterBufferRef.current.slice(0, TYPEWRITER_CHARS);
      typewriterBufferRef.current = typewriterBufferRef.current.slice(TYPEWRITER_CHARS);
      if (chars) appendBotMessageText(voiceBotMsgIdRef.current, chars);
      if (!typewriterBufferRef.current) stopTypewriter();
    }, TYPEWRITER_MS);
  }, [appendBotMessageText, stopTypewriter]);

  // Voice hook
  const {
    voiceState,
    isSupported: voiceIsSupported,
    startRecording,
    stopRecording,
    stopPlayback,
  } = useVoice({
    agentId,
    voiceEnabled,
    voiceLanguage: agentConfig.voiceConfig?.defaultLanguage,
    voiceAutoPlay: true,
    onTranscription: useCallback((text: string) => {
      addUserMessage(text);
      setVoiceLoading(true);
    }, [addUserMessage, setVoiceLoading]),
    onAudioSentence: useCallback((text: string, sentenceIndex: number) => {
      if (sentenceIndex === 0) {
        const id = createBotMessage();
        voiceBotMsgIdRef.current = id;
        typewriterBufferRef.current = text;
        startTypewriter();
        setVoiceLoading(false);
      } else {
        typewriterBufferRef.current += ' ' + text;
        startTypewriter();
      }
    }, [createBotMessage, startTypewriter, setVoiceLoading]),
    onComplete: useCallback((fullText: string) => {
      flushTypewriter();
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current, fullText);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [flushTypewriter, finalizeBotMessage, setVoiceLoading]),
    onError: useCallback(() => {
      flushTypewriter();
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [flushTypewriter, finalizeBotMessage, setVoiceLoading]),
  });

  useEffect(() => () => stopTypewriter(), [stopTypewriter]);

  const showVoice = voiceEnabled && voiceIsSupported;
  const isVoiceActive = voiceState !== 'idle';

  // Build display messages: prepend greeting
  const greeting = agentConfig.greeting?.trim() ?? '';
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (!greeting) return msgs;
    return [
      { id: '__greeting__', role: 'assistant' as const, content: greeting, timestamp: new Date() },
      ...msgs,
    ];
  }, [greeting, msgs]);

  // Auto-scroll
  useEffect(() => {
    if (isWindowMinimized) return;
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages, isTyping, isWindowMinimized]);

  // Focus input on expand
  useEffect(() => {
    if (!isWindowMinimized) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isWindowMinimized]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    sendMessage(text);
    setInputValue('');
  }, [inputValue, sendMessage]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleClose = () => {
    widgetState.value = 'closed';
    setIsWindowMinimized(false);
  };

  const showTimestamp = bool(timestamps, 'show');
  const typingEnabled = bool(animations, 'showTypingIndicator', true);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div
      class="pointer-events-none"
      style={{
        fontFamily: str(typo, 'fontFamily', 'Inter, system-ui, sans-serif'),
        fontSize: `${num(typo, 'baseFontSize', 14)}px`,
        lineHeight: '1.5',
        color: '#1f2937',
        textTransform: 'none',
        textDecoration: 'none',
        fontWeight: '400',
        fontStyle: 'normal',
        letterSpacing: 'normal',
        wordSpacing: 'normal',
        textShadow: 'none',
      }}
    >
      {/* Chat window */}
      <div
        class={`pointer-events-auto absolute ${iconOnRight ? 'bottom-6 right-6' : 'bottom-6 left-6'} z-30 flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300`}
        style={{
          width: 380,
          height: isWindowMinimized ? 80 : 520,
          borderRadius: `${num(header, 'borderRadius', 14)}px`,
          backgroundColor: '#ffffff',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        {/* Header */}
        <div
          class="flex cursor-pointer items-center justify-between p-4"
          style={{
            backgroundColor: str(header, 'backgroundColor', '#3b82f6'),
            color: str(header, 'textColor', '#ffffff'),
            height: 80,
          }}
          onClick={() => isWindowMinimized && setIsWindowMinimized(false)}
        >
          <div class="flex items-center gap-3">
            {bool(header, 'showLogo') && str(header, 'logoUrl') && isSafeUrl(str(header, 'logoUrl')) && (
              <img src={str(header, 'logoUrl')} alt="Logo" class="h-12 w-12 rounded-full object-cover" />
            )}
            <div>
              <h4 class="font-semibold leading-tight" style={{ fontSize: 18 }}>
                {str(header, 'title') || agentConfig.name}
              </h4>
              {str(header, 'subtitle') && (
                <p
                  class="text-xs"
                  style={{
                    color: str(header, 'subtitleColor', 'inherit'),
                    opacity: str(header, 'subtitleColor') ? 1 : 0.9,
                  }}
                >
                  {str(header, 'subtitle')}
                </p>
              )}
            </div>
          </div>
          <div class="flex gap-2">
            <button
              aria-label="Minimize chat"
              class="flex h-8 w-8 items-center justify-center rounded-full p-0 hover:bg-white/20"
              style={{ color: str(header, 'textColor', '#ffffff') }}
              onClick={(e) => { e.stopPropagation(); setIsWindowMinimized(true); }}
            >
              <Minimize2Icon class="h-4 w-4" />
            </button>
            <button
              aria-label="Close chat"
              class="flex h-8 w-8 items-center justify-center rounded-full p-0 hover:bg-white/20"
              style={{ color: str(header, 'textColor', '#ffffff') }}
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
            >
              <XIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages area */}
        {!isWindowMinimized && (
          <div
            ref={scrollRef}
            class="flex-1 space-y-4 overflow-y-auto p-5"
            style={{
              scrollbarColor: '#E5E7EB transparent',
              scrollbarWidth: 'thin',
              backgroundColor: str(body, 'backgroundColor', '#F9FAFB'),
            }}
          >
            {displayMessages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <div key={message.id} class={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div
                    class={getAvatarClass(isUser ? str(userAvatar, 'shape', 'circle') : str(botAvatar, 'shape', 'circle'))}
                    style={{
                      backgroundColor: isUser ? str(userAvatar, 'backgroundColor', '#dbeafe') : str(botAvatar, 'backgroundColor', '#e0e7ff'),
                      color: isUser ? str(userAvatar, 'color', '#3b82f6') : str(botAvatar, 'color', '#3b82f6'),
                    }}
                  >
                    {isUser
                      ? <UserAvatarContent type={str(userAvatar, 'type', 'user')} customImage={str(userAvatar, 'customImageUrl')} />
                      : <BotAvatarContent type={str(botAvatar, 'type', 'robot')} customImage={str(botAvatar, 'customImageUrl')} />
                    }
                  </div>
                  <div class={`max-w-[70%] ${isUser ? 'text-right' : 'text-left'}`}>
                    <div
                      class="px-4 py-3"
                      style={{
                        backgroundColor: isUser ? str(userMessage, 'backgroundColor', '#3b82f6') : str(botMessage, 'backgroundColor', '#f3f4f6'),
                        color: isUser ? str(userMessage, 'textColor', '#ffffff') : str(botMessage, 'textColor', '#1f2937'),
                        borderRadius: `${isUser ? num(userMessage, 'borderRadius', 14) : num(botMessage, 'borderRadius', 14)}px`,
                      }}
                    >
                      {isUser ? (
                        <p class="text-sm leading-relaxed">{message.content}</p>
                      ) : (
                        <div class="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                      )}
                    </div>
                    {showTimestamp && (
                      <p class="mt-1 px-2 text-xs" style={{ color: str(timestamps, 'color', '#9ca3af') }}>
                        {formatTimestamp(message.timestamp)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Conversation starters — inside scroll area, after greeting */}
            {displayMessages.length === 1 && starters.length > 0 && (
              <div class="mt-4 flex flex-wrap gap-2">
                {starters.map((s, i) => (
                  <button
                    key={s + i}
                    onClick={() => sendMessage(s)}
                    class="border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors hover:bg-gray-50"
                    style={{ borderRadius: `${num(botMessage, 'borderRadius', 14)}px` }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Typing indicator */}
            {isTyping && typingEnabled && (
              <div class="flex gap-3">
                <div
                  class={getAvatarClass(str(botAvatar, 'shape', 'circle'))}
                  style={{
                    backgroundColor: str(botAvatar, 'backgroundColor', '#e0e7ff'),
                    color: str(botAvatar, 'color', '#3b82f6'),
                  }}
                >
                  <BotAvatarContent type={str(botAvatar, 'type', 'robot')} />
                </div>
                <div
                  class="flex items-center space-x-1 bg-white px-4 py-2"
                  style={{ borderRadius: `${num(botMessage, 'borderRadius', 14)}px` }}
                >
                  <div class="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                  <div class="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.1s' }} />
                  <div class="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            )}

            <div ref={bottomRef} aria-hidden="true" />
          </div>
        )}

        {/* Input area */}
        {!isWindowMinimized && (
          <div class="border-t border-gray-200 p-4" style={{ backgroundColor: str(input, 'backgroundColor', '#ffffff') }}>
            <div class="flex gap-3">
              <input
                ref={inputRef}
                value={inputValue}
                onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
                onKeyDown={handleKeyDown}
                placeholder={str(input, 'placeholderText', 'Type your message...')}
                disabled={loading || streaming || rateLimited || isVoiceActive}
                class="flex-1 border border-gray-200 px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                style={{
                  color: str(input, 'textColor', '#1f2937'),
                  borderRadius: `${num(input, 'borderRadius', 14)}px`,
                }}
              />
              {showVoice && (
                <button
                  onClick={() => {
                    if (voiceState === 'idle') startRecording();
                    else if (voiceState === 'listening') stopRecording();
                    else if (voiceState === 'playing') stopPlayback();
                  }}
                  aria-label={voiceState === 'idle' ? 'Start recording' : voiceState === 'listening' ? 'Stop recording' : 'Stop playback'}
                  class="relative flex h-10 w-10 items-center justify-center p-0"
                  style={{
                    backgroundColor: voiceState === 'listening' ? '#EF4444' : voiceState === 'playing' ? '#F97316' : str(sendBtn, 'backgroundColor', '#3b82f6'),
                    borderRadius: `${num(sendBtn, 'borderRadius', 14)}px`,
                    color: str(sendBtn, 'iconColor', '#ffffff'),
                    opacity: voiceState === 'processing' ? 0.6 : 1,
                  }}
                >
                  {voiceState === 'listening' && (
                    <span class="absolute inset-0 animate-ping rounded-lg bg-red-400 opacity-30" style={{ borderRadius: `${num(sendBtn, 'borderRadius', 14)}px` }} />
                  )}
                  {voiceState === 'idle' && <MicIcon class="h-4 w-4" />}
                  {voiceState === 'listening' && <SquareIcon class="relative h-3.5 w-3.5" />}
                  {voiceState === 'processing' && <Loader2Icon class="h-4 w-4" />}
                  {voiceState === 'playing' && <Volume2Icon class="h-4 w-4" />}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={loading || streaming || rateLimited || isVoiceActive}
                aria-label="Send message"
                class="flex h-10 w-10 items-center justify-center p-0"
                style={{
                  backgroundColor: str(sendBtn, 'backgroundColor', '#3b82f6'),
                  borderRadius: `${num(sendBtn, 'borderRadius', 14)}px`,
                  color: str(sendBtn, 'iconColor', '#ffffff'),
                  opacity: (loading || streaming || rateLimited || isVoiceActive) ? 0.5 : 1,
                }}
              >
                <SendIcon class="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Branding footer */}
        {bool(branding, 'enabled') && (
          <div class="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
            <p class="text-xs" style={{ color: str(branding, 'textColor', '#9ca3af') }}>
              {str(branding, 'textPrefix', 'Powered by')}{' '}
              {bool(branding, 'useLogo') && str(branding, 'logo') ? (
                <img src={str(branding, 'logo')} alt="Brand" class="inline-block h-4 align-[-2px]" />
              ) : (
                <a
                  href={str(branding, 'linkUrl', '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium"
                  style={{ color: str(branding, 'linkColor', '#3b82f6'), textDecoration: 'none' }}
                >
                  {str(branding, 'linkText', 'CodeWeaves')}
                </a>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
