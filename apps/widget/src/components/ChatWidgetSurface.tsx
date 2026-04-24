/**
 * ChatWidgetSurface — renders the chat widget UI using Tailwind classes.
 *
 * This component mirrors the agent editor preview (chat-widget-surface.tsx in apps/web)
 * so they always look identical. Any visual change here should be made in the preview too.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import type { ChatMessage } from '../types';
import {
  XIcon,
  BotIcon,
  SettingsIcon,
  ZapIcon,
  HeadphonesIcon,
  UserIcon,
  UserCheckIcon,
  MicIcon,
  SquareIcon,
  Loader2Icon,
  Volume2Icon,
  MessageCircleIcon,
  ArrowUpIcon,
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
    shape === 'rounded' ? 'rounded-md' :
    shape === 'square' ? 'rounded-none' : 'rounded-full';
  return `w-8 h-8 ${shapeClass} shrink-0 flex items-center justify-center text-xs font-medium`;
}

function BotAvatarContent({ type, customImage }: { type: string; customImage?: string }) {
  const iconProps = { class: 'w-4 h-4' };
  switch (type) {
    case 'machine': return <SettingsIcon {...iconProps} />;
    case 'bot': return <ZapIcon {...iconProps} />;
    case 'support': return <HeadphonesIcon {...iconProps} />;
    case 'custom': return customImage
      ? <img src={customImage} alt="Bot" class="h-full w-full rounded-[inherit] object-cover" />
      : <span>B</span>;
    case 'robot': default: return <BotIcon {...iconProps} />;
  }
}

function UserAvatarContent({ type, customImage }: { type: string; customImage?: string }) {
  const iconProps = { class: 'w-4 h-4' };
  switch (type) {
    case 'female': return <UserCheckIcon {...iconProps} />;
    case 'custom': return customImage
      ? <img src={customImage} alt="User" class="h-full w-full rounded-[inherit] object-cover" />
      : <span>U</span>;
    case 'male': default: return <UserIcon {...iconProps} />;
  }
}

function formatTimestamp(ts: Date): string {
  const diff = Date.now() - ts.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type GroupPosition = 'standalone' | 'first' | 'middle' | 'last';

/** Compute iMessage-style grouping for consecutive same-sender messages */
function computeGroupPositions(msgs: ChatMessage[]): GroupPosition[] {
  return msgs.map((msg, i) => {
    const prev = i > 0 ? msgs[i - 1] : null;
    const next = i < msgs.length - 1 ? msgs[i + 1] : null;
    const isUser = msg.role === 'user';
    const samePrev = prev && isUser === (prev.role === 'user');
    const sameNext = next && isUser === (next.role === 'user');
    if (samePrev && sameNext) return 'middle';
    if (!samePrev && sameNext) return 'first';
    if (samePrev && !sameNext) return 'last';
    return 'standalone';
  });
}

/** iMessage-style asymmetric border-radius for grouped messages */
function getBubbleRadius(isUser: boolean, pos: GroupPosition, r: number): string {
  const s = `${r}px`;
  const t = '4px';
  if (pos === 'standalone') return s;
  if (isUser) {
    if (pos === 'first') return `${s} ${s} ${t} ${s}`;
    if (pos === 'middle') return `${s} ${t} ${t} ${s}`;
    return `${s} ${t} ${s} ${s}`;
  }
  if (pos === 'first') return `${s} ${s} ${s} ${t}`;
  if (pos === 'middle') return `${t} ${s} ${s} ${t}`;
  return `${t} ${s} ${s} ${s}`;
}

// ── Main component ──────────────────────────────────────────────────

export function ChatWidgetSurface({ agentId, agentConfig, theme, position }: ChatWidgetSurfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
  const voiceBotMsgIdRef = useRef<string | null>(null);

  // Voice hook
  const {
    voiceState,
    isSupported: voiceIsSupported,
    startRecording,
    stopRecording,
    stopPlayback,
    error: voiceError,
    clearError: clearVoiceError,
  } = useVoice({
    agentId,
    voiceEnabled,
    // Don't send language hint — let the backend route to Sarvam for auto-detect
    voiceLanguage: undefined,
    voiceAutoPlay: true,
    onTranscription: useCallback((text: string) => {
      addUserMessage(text);
      setVoiceLoading(true);
    }, [addUserMessage, setVoiceLoading]),
    onAudioSentence: useCallback((text: string, sentenceIndex: number) => {
      if (sentenceIndex === 0) {
        const id = createBotMessage();
        voiceBotMsgIdRef.current = id;
        // Show first sentence immediately — no typewriter delay
        appendBotMessageText(id, text);
        setVoiceLoading(false);
      } else if (voiceBotMsgIdRef.current) {
        // Append subsequent sentences with a space
        appendBotMessageText(voiceBotMsgIdRef.current, ' ' + text);
      }
    }, [createBotMessage, appendBotMessageText, setVoiceLoading]),
    onComplete: useCallback((fullText: string) => {
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current, fullText);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [finalizeBotMessage, setVoiceLoading]),
    onError: useCallback(() => {
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [finalizeBotMessage, setVoiceLoading]),
  });

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
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages, isTyping]);

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Auto-resize textarea based on content (max 144px ≈ 6 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [inputValue]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    sendMessage(text);
    setInputValue('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputValue, sendMessage]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleClose = () => {
    widgetState.value = 'closed';
  };

  const showTimestamp = bool(timestamps, 'show');
  const typingEnabled = bool(animations, 'showTypingIndicator', true);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div
      class="cw-surface-root pointer-events-none"
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
        class={`cw-window pointer-events-auto absolute ${iconOnRight ? 'bottom-5 right-5' : 'bottom-5 left-5'} z-30 flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300`}
        style={{
          width: 400,
          height: 'clamp(520px, 58vh, 800px)',
          borderRadius: `${num(header, 'borderRadius', 16)}px`,
          backgroundColor: '#ffffff',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        {/* Header */}
        <div
          class="cw-header flex items-center justify-between p-4"
          style={{
            backgroundColor: str(header, 'backgroundColor', '#3b82f6'),
            color: str(header, 'textColor', '#ffffff'),
            height: 64,
          }}
        >
          <div class="cw-header-info flex items-center gap-3">
            {bool(header, 'showLogo') && str(header, 'logoUrl') && isSafeUrl(str(header, 'logoUrl')) ? (
              <img src={str(header, 'logoUrl')} alt="Logo" class="cw-header-logo h-8 w-8 rounded-full object-cover" />
            ) : (
              <div
                class="cw-header-avatar relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
              >
                <MessageCircleIcon class="cw-header-avatar-icon h-4 w-4" />
                <span
                  class="cw-header-online-dot absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 bg-green-400"
                  style={{ borderColor: str(header, 'backgroundColor', '#3b82f6') }}
                />
              </div>
            )}
            <div class="cw-header-text">
              <h4 class="cw-header-title font-semibold leading-tight" style={{ fontSize: 15 }}>
                {str(header, 'title') || agentConfig.name}
              </h4>
              {str(header, 'subtitle') && (
                <p
                  class="cw-header-subtitle"
                  style={{
                    fontSize: 13,
                    color: str(header, 'subtitleColor', 'inherit'),
                    opacity: str(header, 'subtitleColor') ? 1 : 0.9,
                  }}
                >
                  {str(header, 'subtitle')}
                </p>
              )}
            </div>
          </div>
          <div class="cw-header-actions flex gap-2">
            <button
              aria-label="Close chat"
              class="cw-header-btn cw-header-btn--close flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-0 hover:opacity-80"
              style={{ color: str(header, 'textColor', '#ffffff') }}
              onClick={handleClose}
            >
              <XIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          class="cw-body flex-1 overflow-y-auto p-5"
          style={{
            backgroundColor: str(body, 'backgroundColor', '#F9FAFB'),
          }}
        >
            {(() => {
              const positions = computeGroupPositions(displayMessages);
              const botAvatarShow = bool(botAvatar, 'show', false);
              const userAvatarShow = bool(userAvatar, 'show', false);
              return displayMessages.map((message, i) => {
                const isUser = message.role === 'user';
                const pos = positions[i] ?? 'standalone';
                const isLastInGroup = pos === 'last' || pos === 'standalone';
                const avatarEnabled = isUser ? userAvatarShow : botAvatarShow;
                const showAvatar = avatarEnabled && isLastInGroup;
                const showTime = showTimestamp && isLastInGroup;
                const showBotMeta = !isUser && !botAvatarShow && isLastInGroup;
                const baseRadius = isUser ? num(userMessage, 'borderRadius', 14) : num(botMessage, 'borderRadius', 14);
                const marginTop = i === 0 ? 0 : pos === 'middle' || pos === 'last' ? 2 : 12;
                return (
                  <div
                    key={message.id}
                    class={`cw-message ${isUser ? 'cw-message--user flex-row-reverse' : 'cw-message--bot flex-row'} flex items-start gap-2`}
                    style={{ marginTop: `${marginTop}px` }}
                  >
                    {avatarEnabled && (
                      <div
                        class={`${isUser ? 'cw-avatar cw-avatar--user' : 'cw-avatar cw-avatar--bot'} ${!showAvatar ? 'invisible' : ''} ${getAvatarClass(isUser ? str(userAvatar, 'shape', 'circle') : str(botAvatar, 'shape', 'circle'))}`}
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
                    )}
                    <div class="cw-message-content max-w-[80%]">
                      <div
                        class="cw-message-bubble px-3.5 py-2"
                        style={{
                          backgroundColor: isUser ? str(userMessage, 'backgroundColor', '#3b82f6') : str(botMessage, 'backgroundColor', '#f3f4f6'),
                          color: isUser ? str(userMessage, 'textColor', '#ffffff') : str(botMessage, 'textColor', '#1f2937'),
                          borderRadius: getBubbleRadius(isUser, pos, baseRadius),
                        }}
                      >
                        {isUser ? (
                          <p class="cw-message-text text-sm leading-relaxed">{message.content}</p>
                        ) : message.isStreaming ? (
                          <p class="cw-message-text text-sm leading-relaxed">{message.content}</p>
                        ) : (
                          <div class="cw-message-text text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                        )}
                      </div>
                      {showBotMeta ? (
                        <p class="cw-message-meta mt-1 pl-3 text-xs" style={{ color: str(timestamps, 'color', '#9ca3af') }}>
                          AI Agent &middot; {formatTimestamp(message.timestamp)}
                        </p>
                      ) : showTime && (
                        <p class="cw-message-timestamp mt-1 px-2 text-xs" style={{ color: str(timestamps, 'color', '#9ca3af') }}>
                          {formatTimestamp(message.timestamp)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              });
            })()}

            {/* Conversation starters — inside scroll area, after greeting */}
            {displayMessages.length === 1 && starters.length > 0 && (
              <div class="cw-starters mt-4 flex flex-wrap gap-2">
                {starters.map((s, i) => (
                  <button
                    key={s + i}
                    onClick={() => { sendMessage(s); requestAnimationFrame(() => inputRef.current?.focus()); }}
                    class="cw-starter-btn cursor-pointer border border-gray-200 bg-white px-3 py-2 shadow-sm transition-colors hover:bg-gray-50"
                    style={{ borderRadius: `${num(botMessage, 'borderRadius', 14)}px`, fontSize: 14 }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Typing indicator */}
            {isTyping && typingEnabled && (
              <div class="cw-typing mt-3 flex items-start gap-2">
                {bool(botAvatar, 'show', false) && (
                  <div
                    class={`cw-typing-avatar cw-avatar cw-avatar--bot ${getAvatarClass(str(botAvatar, 'shape', 'circle'))}`}
                    style={{
                      backgroundColor: str(botAvatar, 'backgroundColor', '#e0e7ff'),
                      color: str(botAvatar, 'color', '#3b82f6'),
                    }}
                  >
                    <BotAvatarContent type={str(botAvatar, 'type', 'robot')} />
                  </div>
                )}
                <div
                  class="cw-typing-bubble flex items-center space-x-1 bg-white px-3.5 py-2"
                  style={{ borderRadius: `${num(botMessage, 'borderRadius', 14)}px` }}
                >
                  <div class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                  <div class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.1s' }} />
                  <div class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            )}

            <div ref={bottomRef} aria-hidden="true" />
          </div>

        {/* Voice error banner */}
        {voiceError && (
          <div class="cw-voice-error flex items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-2">
            <p class="cw-voice-error-text flex-1 text-xs" style={{ color: '#ef4444' }}>{voiceError}</p>
            <button
              onClick={clearVoiceError}
              class="cw-voice-error-dismiss cursor-pointer text-xs font-medium opacity-60 hover:opacity-100"
              style={{ color: '#ef4444' }}
              type="button"
            >
              ✕
            </button>
          </div>
        )}

        {/* Input area */}
        <div class="cw-input-area border-t border-gray-200 p-3" style={{ backgroundColor: str(input, 'backgroundColor', '#ffffff') }}>
          <div
            class="cw-input-wrapper flex flex-col border border-gray-300 px-3 py-2"
            style={{
              borderRadius: `${num(input, 'borderRadius', 16)}px`,
              boxShadow: isInputFocused
                ? `0 0 0 2px ${str(sendBtn, 'backgroundColor', '#3b82f6')}`
                : 'none',
            }}
          >
            <textarea
              ref={inputRef}
              value={inputValue}
              onInput={(e) => setInputValue((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder={str(input, 'placeholderText', 'Message...')}
              disabled={loading || streaming || rateLimited || isVoiceActive}
              rows={1}
              class="cw-input w-full resize-none border-0 bg-transparent p-0 leading-snug outline-none"
              style={{
                color: str(input, 'textColor', '#1f2937'),
                maxHeight: '144px',
              }}
            />
            <div class="cw-input-actions mt-2 flex items-center justify-between">
              <div class="cw-input-left-actions flex items-center gap-1">
                {showVoice && (
                  <button
                    onClick={() => {
                      if (voiceState === 'idle') startRecording();
                      else if (voiceState === 'listening') stopRecording();
                      else if (voiceState === 'playing') stopPlayback();
                    }}
                    aria-label={voiceState === 'idle' ? 'Start recording' : voiceState === 'listening' ? 'Stop recording' : 'Stop playback'}
                    class={`cw-voice-btn cw-voice-btn--${voiceState} relative flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-gray-500 hover:text-gray-800`}
                    style={{
                      color: voiceState === 'listening' ? '#EF4444' : voiceState === 'playing' ? '#F97316' : undefined,
                      opacity: voiceState === 'processing' ? 0.6 : 1,
                    }}
                  >
                    {voiceState === 'listening' && (
                      <span class="cw-voice-pulse absolute inset-0 animate-ping rounded-full bg-red-400 opacity-30" />
                    )}
                    {voiceState === 'idle' && <MicIcon class="h-4 w-4" />}
                    {voiceState === 'listening' && <SquareIcon class="relative h-3.5 w-3.5" />}
                    {voiceState === 'processing' && <Loader2Icon class="h-4 w-4" />}
                    {voiceState === 'playing' && <Volume2Icon class="h-4 w-4" />}
                  </button>
                )}
              </div>
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || loading || streaming || rateLimited || isVoiceActive}
                aria-label="Send message"
                class="cw-send-btn flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-opacity"
                style={{
                  backgroundColor: str(sendBtn, 'backgroundColor', '#3b82f6'),
                  color: str(sendBtn, 'iconColor', '#ffffff'),
                  opacity: (!inputValue.trim() || loading || streaming || rateLimited || isVoiceActive) ? 0.4 : 1,
                }}
              >
                <ArrowUpIcon class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Branding footer */}
        {bool(branding, 'enabled') && (
          <div class="cw-branding border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
            <p class="cw-branding-text text-xs" style={{ color: str(branding, 'textColor', '#9ca3af') }}>
              {str(branding, 'textPrefix', 'Powered by')}{' '}
              {bool(branding, 'useLogo') && str(branding, 'logo') ? (
                <img src={str(branding, 'logo')} alt="Brand" class="cw-branding-logo inline-block h-4 align-[-2px]" />
              ) : (
                <a
                  href={str(branding, 'linkUrl', '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cw-branding-link font-medium"
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
