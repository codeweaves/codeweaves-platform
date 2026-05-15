/* eslint-disable @next/next/no-img-element -- Preview widget uses data URLs and external image sources for avatars/logos */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  MessageCircle,
  X,
  Bot,
  Settings as SettingsIcon,
  Zap,
  Headphones,
  User as UserIcon,
  UserCheck,
  ArrowUp,
  Mic,
  Volume2,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { PreviewFormData } from './agent-editor-context';

export type ChatWidgetMessage = {
  id: string;
  role: 'user' | 'system' | 'ai';
  text: string;
  timestamp: Date;
};

type GroupPosition = 'standalone' | 'first' | 'middle' | 'last';

/** Compute iMessage-style grouping for consecutive same-sender messages */
function computeGroupPositions(msgs: ChatWidgetMessage[]): GroupPosition[] {
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

interface ChatWidgetSurfaceProps {
  formData: PreviewFormData;
  messages: ChatWidgetMessage[];
  isMinimized: boolean;
  onMinimizedChange: (value: boolean) => void;
  showBubble: boolean;
  onBubbleChange: (value: boolean) => void;
  onSendMessage: (value: string) => void;
  typingIndicator: boolean;
}

export function ChatWidgetSurface({
  formData,
  messages,
  isMinimized,
  onMinimizedChange,
  showBubble,
  onBubbleChange,
  onSendMessage,
  typingIndicator,
}: ChatWidgetSurfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [previewVoiceState, setPreviewVoiceState] = useState<'idle' | 'listening' | 'processing' | 'playing'>('idle');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const cycleVoiceState = () => {
    setPreviewVoiceState((prev) => {
      const order = ['idle', 'listening', 'processing', 'playing'] as const;
      const idx = order.indexOf(prev);
      return order[(idx + 1) % order.length]!;
    });
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const getAvatarClass = (isUser: boolean) => {
    const shape = isUser ? formData.userAvatarShape : formData.botAvatarShape;
    const shapeClass =
      shape === 'circle'
        ? 'rounded-full'
        : shape === 'rounded'
          ? 'rounded-md'
          : shape === 'square'
            ? 'rounded-none'
            : 'rounded-full';
    return `w-8 h-8 ${shapeClass} shrink-0 flex items-center justify-center text-xs font-medium`;
  };

  const getBotAvatarContent = () => {
    const iconProps = { className: 'w-4 h-4' } as const;
    switch (formData.botAvatarType) {
      case 'machine':
        return <SettingsIcon {...iconProps} />;
      case 'bot':
        return <Zap {...iconProps} />;
      case 'support':
        return <Headphones {...iconProps} />;
      case 'custom':
        return formData.botCustomImage ? (
          <img
            src={formData.botCustomImage}
            alt="Bot"
            className="h-full w-full rounded-[inherit] object-cover"
          />
        ) : (
          'B'
        );
      case 'robot':
      default:
        return <Bot {...iconProps} />;
    }
  };

  const getUserAvatarContent = () => {
    const iconProps = { className: 'w-4 h-4' } as const;
    switch (formData.userAvatarType) {
      case 'female':
        return <UserCheck {...iconProps} />;
      case 'custom':
        return formData.userCustomImage ? (
          <img
            src={formData.userCustomImage}
            alt="User"
            className="h-full w-full rounded-[inherit] object-cover"
          />
        ) : (
          'U'
        );
      case 'male':
      default:
        return <UserIcon {...iconProps} />;
    }
  };

  const getMessageStyle = (isUser: boolean) =>
    isUser
      ? {
          backgroundColor: formData.userMessageBg,
          color: formData.userMessageTextColor,
        }
      : {
          backgroundColor: formData.systemMessageBg,
          color: formData.systemMessageTextColor,
        };

  const formatTimestamp = (timestamp: Date) => {
    const diff = Date.now() - timestamp.getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const iconOnRight = formData.iconPosition === 'right';

  const handleOpen = () => {
    onMinimizedChange(false);
  };

  const handleClose = () => {
    onMinimizedChange(true);
  };

  // Auto-resize textarea based on content (max 144px ≈ 6 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [inputValue]);

  // Auto-scroll: prefer AI reply after last user message, then user message, then bottom
  useEffect(() => {
    const lastUserIdx = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') return i;
      }
      return -1;
    })();
    if (lastUserIdx >= 0) {
      const userMsg = messages[lastUserIdx];
      if (userMsg) {
        // Prefer scrolling to the AI reply that follows the last user message
        const aiMsg =
          messages.slice(lastUserIdx + 1).find((m) => m.role === 'ai' || m.role === 'system') ?? null;
        if (aiMsg) {
          const aiEl = msgRefs.current.get(aiMsg.id);
          if (aiEl) {
            aiEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
        // Otherwise scroll to the user message itself
        const targetEl = msgRefs.current.get(userMsg.id);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
    }
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return;
    }
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      className="cw-widget-root pointer-events-none"
      style={{
        fontFamily: formData.fontFamily,
        fontSize: `${formData.defaultFontSize}px`,
      }}
    >
      {/* Bubble prompt */}
      {showBubble && isMinimized && formData.bubbleEnabled && formData.bubbleText.trim().length > 0 && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open chat"
          className={`cw-bubble pointer-events-auto absolute ${iconOnRight ? 'bottom-22 right-5' : 'bottom-22 left-5'} z-10 max-w-xs cursor-pointer rounded-2xl px-4 py-3 shadow-lg transition-all duration-300 hover:scale-105`}
          style={{
            backgroundColor: formData.bubbleBg,
            color: formData.bubbleTextColor,
          }}
          onClick={handleOpen}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
        >
          <div className="cw-bubble-content">
            <span className="cw-bubble-text text-sm font-medium leading-snug">
              {formData.bubbleText}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBubbleChange(false);
            }}
            className="cw-bubble-close absolute -right-1 -top-1 flex h-5 w-5 cursor-pointer items-center justify-center"
            aria-label="Dismiss"
            style={{
              borderRadius: '50%',
              backgroundColor: formData.bubbleBg,
              border: 'none',
              color: formData.bubbleTextColor,
              padding: 0,
            }}
          >
            <X className="block h-3 w-3" />
          </button>
          <div
            className={`cw-bubble-arrow absolute -bottom-1.5 h-0 w-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent ${iconOnRight ? 'right-6' : 'left-6'}`}
            style={{ borderTopColor: formData.bubbleBg }}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Minimized icon */}
      {isMinimized && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open chat widget"
          className={`cw-launcher pointer-events-auto absolute ${iconOnRight ? 'bottom-5 right-5' : 'bottom-5 left-5'} z-20 flex cursor-pointer items-center justify-center transition-all duration-300`}
          style={{
            backgroundColor: formData.iconBg,
            borderRadius: `${formData.iconBorderRadius}%`,
            width: `${formData.iconSize ?? 60}px`,
            height: `${formData.iconSize ?? 60}px`,
            boxShadow: formData.iconShadow || '0 4px 12px rgba(0,0,0,0.15)',
          }}
          onClick={handleOpen}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
        >
          {formData.iconCustomImage ? (
            <img
              src={formData.iconCustomImage}
              alt="Chat"
              className="cw-launcher-image h-3/5 w-3/5 rounded-full object-cover"
            />
          ) : (
            <MessageCircle className="cw-launcher-icon h-7 w-7 text-white" />
          )}
        </div>
      )}

      {/* Expanded chat window */}
      {!isMinimized && (
        <div
          className={`cw-window pointer-events-auto absolute ${iconOnRight ? 'bottom-5 right-5' : 'bottom-5 left-5'} z-30 flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300`}
          style={{
            width: 400,
            height: 'clamp(520px, 58vh, 800px)',
            borderRadius: `${formData.headerBorderRadius ?? 16}px`,
            fontFamily: formData.fontFamily,
            fontSize: `${formData.defaultFontSize}px`,
          }}
        >
          {/* Header */}
          <div
            className="cw-header flex items-center justify-between p-4"
            style={{
              backgroundColor: formData.headerBg,
              color: formData.headerTextColor,
              height: 64,
            }}
          >
            <div className="cw-header-info flex items-center gap-3">
              {formData.headerShowLogo && formData.companyLogo ? (
                <img
                  src={formData.companyLogo}
                  alt="Logo"
                  className="cw-header-logo h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div
                  className="cw-header-avatar relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  <MessageCircle className="cw-header-avatar-icon h-4 w-4" />
                  <span
                    className="cw-header-online-dot absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 bg-green-400"
                    style={{ borderColor: formData.headerBg }}
                  />
                </div>
              )}
              <div className="cw-header-text">
                <h4
                  className="cw-header-title font-semibold leading-tight"
                  style={{ fontSize: '1.07em' }}
                >
                  {formData.headerTitle}
                </h4>
                {formData.headerSubtitle && (
                  <p
                    className="cw-header-subtitle"
                    style={{ fontSize: '0.93em', color: formData.headerSubtitleColor || 'inherit', opacity: formData.headerSubtitleColor ? 1 : 0.9 }}
                  >
                    {formData.headerSubtitle}
                  </p>
                )}
              </div>
            </div>
            <div className="cw-header-actions flex gap-2">
              <button
                aria-label="Close chat"
                className="cw-header-btn cw-header-btn--close flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-0 hover:opacity-80"
                style={{ color: formData.headerTextColor }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose();
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div
            ref={scrollRef}
            className="cw-body flex-1 overflow-y-auto p-5"
            style={{
              backgroundColor: formData.chatBodyBg || '#F9FAFB',
            }}
          >
              {(() => {
                const positions = computeGroupPositions(messages);
                const botAvatarShow = formData.botAvatarShow;
                const userAvatarShow = formData.userAvatarShow;
                return messages.map((message, i) => {
                  const isUser = message.role === 'user';
                  const pos = positions[i] ?? 'standalone';
                  const isLastInGroup = pos === 'last' || pos === 'standalone';
                  const avatarEnabled = isUser ? userAvatarShow : botAvatarShow;
                  const showAvatar = avatarEnabled && isLastInGroup;
                  const showTime = formData.showTimestamp && isLastInGroup;
                  const showBotMeta = !isUser && !botAvatarShow && isLastInGroup;
                  const baseRadius = isUser
                    ? formData.userMessageBorderRadius || 14
                    : formData.systemMessageBorderRadius || 14;
                  const marginTop = i === 0 ? 0 : pos === 'middle' || pos === 'last' ? 2 : 12;
                  return (
                    <div
                      key={message.id}
                      ref={(el) => {
                        const map = msgRefs.current;
                        if (el) map.set(message.id, el);
                        else map.delete(message.id);
                      }}
                      className={`cw-message ${isUser ? 'cw-message--user flex-row-reverse' : 'cw-message--bot flex-row'} flex items-start gap-2`}
                      style={{ marginTop }}
                    >
                      {avatarEnabled && (
                        <div
                          className={`${isUser ? 'cw-avatar cw-avatar--user' : 'cw-avatar cw-avatar--bot'} ${!showAvatar ? 'invisible' : ''} ${getAvatarClass(isUser)}`}
                          style={{
                            backgroundColor: isUser
                              ? formData.userAvatarBg
                              : formData.botAvatarBg,
                            color: isUser
                              ? formData.userAvatarColor || '#FFFFFF'
                              : formData.botAvatarColor || '#FFFFFF',
                          }}
                        >
                          {isUser ? getUserAvatarContent() : getBotAvatarContent()}
                        </div>
                      )}
                      <div className="cw-message-content max-w-[80%]">
                        <div
                          className="cw-message-bubble px-3.5 py-2"
                          style={{
                            ...getMessageStyle(isUser),
                            borderRadius: getBubbleRadius(isUser, pos, baseRadius),
                          }}
                        >
                          <p className="cw-message-text leading-relaxed" style={{ fontSize: '1em' }}>{message.text}</p>
                        </div>
                        {showBotMeta ? (
                          <p
                            className="cw-message-meta mt-1 pl-3"
                            style={{
                              fontSize: '0.86em',
                              color: formData.timestampColor || '#6B7280',
                            }}
                          >
                            AI Agent &middot; {formatTimestamp(message.timestamp)}
                          </p>
                        ) : showTime && (
                          <p
                            className="cw-message-timestamp mt-1 px-2"
                            style={{
                              fontSize: '0.86em',
                              color: formData.timestampColor || '#6B7280',
                            }}
                          >
                            {formatTimestamp(message.timestamp)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Conversation starters */}
              {messages.length === 1 &&
                formData.conversationalStarters.length > 0 && (
                  <div className="cw-starters mt-4 flex flex-wrap gap-2">
                    {formData.conversationalStarters
                      .slice(0, 4)
                      .map((starter, index) => (
                        <button
                          key={starter + index}
                          onClick={() => { onSendMessage(starter); requestAnimationFrame(() => inputRef.current?.focus()); }}
                          className="cw-starter-btn cursor-pointer border border-gray-200 bg-white px-3 py-2 shadow-sm transition-colors hover:bg-gray-50"
                          style={{
                            borderRadius: `${formData.systemMessageBorderRadius || 14}px`,
                            fontSize: '1em',
                          }}
                        >
                          {starter}
                        </button>
                      ))}
                  </div>
                )}

              {/* Typing indicator */}
              {typingIndicator && (
                <div className="cw-typing mt-3 flex items-start gap-2">
                  {formData.botAvatarShow && (
                    <div
                      className={`cw-typing-avatar cw-avatar cw-avatar--bot ${getAvatarClass(false)}`}
                      style={{
                        backgroundColor: formData.botAvatarBg,
                        color: formData.botAvatarColor || '#FFFFFF',
                      }}
                    >
                      {getBotAvatarContent()}
                    </div>
                  )}
                  <div
                    className="cw-typing-bubble flex items-center space-x-1 bg-white px-3.5 py-2"
                    style={{
                      borderRadius: `${formData.systemMessageBorderRadius || 14}px`,
                    }}
                  >
                    <div className="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                    <div
                      className="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: '0.1s' }}
                    />
                    <div
                      className="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                </div>
              )}

              {/* Scroll sentinel */}
              <div ref={bottomRef} aria-hidden="true" />
            </div>

          {/* Input area */}
          <div
            className="cw-input-area border-t border-gray-200 p-3"
            style={{ backgroundColor: formData.inputBg }}
          >
            <div
              className="cw-input-wrapper flex flex-col border border-gray-300 px-3 py-2"
              style={{
                borderRadius: `${formData.inputBorderRadius || 16}px`,
                boxShadow: isInputFocused
                  ? `0 0 0 2px ${formData.sendButtonBg}`
                  : 'none',
              }}
            >
              {(previewVoiceState === 'listening' || previewVoiceState === 'processing') ? (
                <div className="cw-voice-bar flex items-center gap-2 py-1">
                  <button
                    onClick={() => setPreviewVoiceState('idle')}
                    aria-label="Cancel recording"
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="flex flex-1 items-center justify-start gap-3 rounded-full bg-gray-50 px-3 py-1.5">
                    {previewVoiceState === 'listening' ? (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                        </span>
                        <span className="text-sm font-medium tabular-nums text-gray-700">0:03</span>
                        <div className="flex h-4 items-end gap-0.75">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className="inline-block w-0.75 rounded-full bg-red-500"
                              style={{
                                height: '4px',
                                animation: `cw-preview-wave 0.9s ease-in-out ${i * 0.1}s infinite`,
                              }}
                            />
                          ))}
                        </div>
                        <style>{`@keyframes cw-preview-wave { 0%,100% { height: 4px; } 50% { height: 14px; } }`}</style>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                        <span className="text-sm text-gray-600">Transcribing…</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      // Preview-only cycle: listening → processing → playing → idle.
                      // Lets the editor user walk through all states without the mic
                      // button (which hides while the bar is shown).
                      setPreviewVoiceState((prev) =>
                        prev === 'listening' ? 'processing' : prev === 'processing' ? 'playing' : 'idle',
                      );
                    }}
                    aria-label={previewVoiceState === 'listening' ? 'Send voice message' : 'Advance preview'}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-opacity"
                    style={{ backgroundColor: formData.sendButtonBg, color: formData.sendButtonIconColor || '#FFFFFF' }}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              ) : (
              <>
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                placeholder={formData.inputPlaceholder}
                rows={1}
                className="cw-input w-full resize-none border-0 bg-transparent p-0 leading-snug outline-none"
                style={{
                  color: formData.inputTextColor,
                  maxHeight: '144px',
                }}
              />
              <div className="cw-input-actions mt-2 flex items-center justify-between">
                <div className="cw-input-left-actions flex items-center gap-1">
                  {/* Mic button shows only in idle/playing — listening/processing render the
                   *  WhatsApp-style recording bar above (replacing the entire textarea row). */}
                  {formData.voiceEnabled && (
                    <button
                      onClick={cycleVoiceState}
                      aria-label={previewVoiceState === 'idle' ? 'Start recording' : 'Stop playback'}
                      className={`cw-voice-btn cw-voice-btn--${previewVoiceState} relative flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-gray-500 hover:text-gray-800`}
                      style={{
                        color: previewVoiceState === 'playing' ? '#F97316' : undefined,
                      }}
                    >
                      {previewVoiceState === 'idle' && <Mic className="h-4 w-4" />}
                      {previewVoiceState === 'playing' && <Volume2 className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  aria-label="Send message"
                  className="cw-send-btn flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-opacity"
                  style={{
                    backgroundColor: formData.sendButtonBg,
                    color: formData.sendButtonIconColor || '#FFFFFF',
                    opacity: !inputValue.trim() ? 0.4 : 1,
                  }}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              </>
              )}
            </div>
          </div>

          {/* Branding footer */}
          {formData.brandingEnabled && (
            <div className="cw-branding border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
              <p
                className="cw-branding-text"
                style={{ fontSize: '0.86em', color: formData.brandingTextColor || '#6B7280' }}
              >
                {formData.brandingTextPrefix}{' '}
                {formData.brandingUseLogo && formData.brandingLogo ? (
                  <img
                    src={formData.brandingLogo}
                    alt="Brand"
                    className="cw-branding-logo inline-block h-4 align-[-2px]"
                  />
                ) : (
                  <a
                    href={formData.brandingLinkUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cw-branding-link font-medium"
                    style={{
                      color: formData.brandingLinkColor || '#2563EB',
                      textDecoration: 'none',
                    }}
                  >
                    {formData.brandingLinkText}
                  </a>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
