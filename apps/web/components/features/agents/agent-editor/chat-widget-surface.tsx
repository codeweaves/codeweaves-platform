/* eslint-disable @next/next/no-img-element -- Preview widget uses data URLs and external image sources for avatars/logos */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  MessageCircle,
  Minimize2,
  X,
  Bot,
  Settings as SettingsIcon,
  Zap,
  Headphones,
  User as UserIcon,
  UserCheck,
  Send,
} from 'lucide-react';
import type { PreviewFormData } from './agent-editor-context';

export type ChatWidgetMessage = {
  id: string;
  role: 'user' | 'system' | 'ai';
  text: string;
  timestamp: Date;
};

interface ChatWidgetSurfaceProps {
  formData: PreviewFormData;
  messages: ChatWidgetMessage[];
  isMinimized: boolean;
  onMinimizedChange: (value: boolean) => void;
  isWindowMinimized: boolean;
  onWindowMinimizedChange: (value: boolean) => void;
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
  isWindowMinimized,
  onWindowMinimizedChange,
  showBubble,
  onBubbleChange,
  onSendMessage,
  typingIndicator,
}: ChatWidgetSurfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLInputElement>) => {
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
          ? 'rounded-lg'
          : shape === 'square'
            ? 'rounded-none'
            : 'rounded-full';
    return `w-10 h-10 ${shapeClass} flex items-center justify-center text-sm font-medium`;
  };

  const getBotAvatarContent = () => {
    const iconProps = { className: 'w-6 h-6' } as const;
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
            className="w-8 h-8 rounded-full object-cover"
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
    const iconProps = { className: 'w-6 h-6' } as const;
    switch (formData.userAvatarType) {
      case 'female':
        return <UserCheck {...iconProps} />;
      case 'custom':
        return formData.userCustomImage ? (
          <img
            src={formData.userCustomImage}
            alt="User"
            className="w-8 h-8 rounded-full object-cover"
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

  const formatTimestamp = (timestamp: Date) =>
    timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const iconOnRight = formData.iconPosition === 'right';

  const handleOpen = () => {
    onMinimizedChange(false);
    onWindowMinimizedChange(false);
  };

  const handleClose = () => {
    onMinimizedChange(true);
    onWindowMinimizedChange(false);
  };

  // Auto-scroll: prefer AI reply after last user message, then user message, then bottom
  useEffect(() => {
    if (isWindowMinimized) return;
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
  }, [messages, isWindowMinimized]);

  return (
    <div
      className="pointer-events-none"
      style={{
        fontFamily: formData.fontFamily,
        fontSize: `${formData.defaultFontSize}px`,
      }}
    >
      {/* Bubble prompt */}
      {showBubble && isMinimized && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open chat"
          className={`pointer-events-auto absolute ${iconOnRight ? 'bottom-24 right-6' : 'bottom-24 left-6'} z-10 max-w-xs cursor-pointer rounded-2xl px-4 py-3 shadow-lg transition-all duration-300 hover:scale-105`}
          style={{
            backgroundColor: formData.bubbleBg,
            color: formData.bubbleTextColor,
          }}
          onClick={handleOpen}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
        >
          <div className="flex items-center justify-between">
            <span className="pr-2 text-sm font-medium">
              {formData.bubbleText}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBubbleChange(false);
              }}
              className="ml-2 text-current opacity-60 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div
            className={`absolute top-full ${iconOnRight ? 'right-6' : 'left-6'}`}
          >
            <div
              className="h-0 w-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent"
              style={{ borderTopColor: formData.bubbleBg }}
            />
          </div>
        </div>
      )}

      {/* Minimized icon */}
      {isMinimized && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open chat widget"
          className={`pointer-events-auto absolute ${iconOnRight ? 'bottom-6 right-6' : 'bottom-6 left-6'} z-20 flex cursor-pointer items-center justify-center transition-all duration-300`}
          style={{
            backgroundColor: formData.iconBg,
            borderRadius: `${formData.iconBorderRadius}%`,
            width: `${formData.iconSize ?? 56}px`,
            height: `${formData.iconSize ?? 56}px`,
            boxShadow: formData.iconShadow || '0 4px 12px rgba(0,0,0,0.15)',
          }}
          onClick={handleOpen}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
        >
          {formData.iconCustomImage ? (
            <img
              src={formData.iconCustomImage}
              alt="Chat"
              className="h-3/5 w-3/5 rounded-full object-cover"
            />
          ) : (
            <MessageCircle className="h-7 w-7 text-white" />
          )}
        </div>
      )}

      {/* Expanded chat window */}
      {!isMinimized && (
        <div
          className={`pointer-events-auto absolute ${iconOnRight ? 'bottom-6 right-6' : 'bottom-6 left-6'} z-30 flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300`}
          style={{
            width: 380,
            height: isWindowMinimized ? 80 : 520,
            borderRadius: '14px',
            fontFamily: formData.fontFamily,
            fontSize: `${formData.defaultFontSize}px`,
          }}
        >
          {/* Header */}
          <div
            className="flex cursor-pointer items-center justify-between p-4"
            style={{
              backgroundColor: formData.headerBg,
              color: formData.headerTextColor,
              height: 80,
            }}
            onClick={() => isWindowMinimized && onWindowMinimizedChange(false)}
          >
            <div className="flex items-center gap-3">
              {formData.headerShowLogo && formData.companyLogo && (
                <img
                  src={formData.companyLogo}
                  alt="Logo"
                  className="h-12 w-12 rounded-full object-cover"
                />
              )}
              <div>
                <h4
                  className="font-semibold leading-tight"
                  style={{ fontSize: 18 }}
                >
                  {formData.headerTitle}
                </h4>
                {formData.headerSubtitle && (
                  <p
                    className="text-xs"
                    style={{ color: formData.headerSubtitleColor || 'inherit', opacity: formData.headerSubtitleColor ? 1 : 0.9 }}
                  >
                    {formData.headerSubtitle}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                aria-label="Minimize chat"
                className="flex h-8 w-8 items-center justify-center rounded-full p-0 hover:bg-white/20"
                style={{ color: formData.headerTextColor }}
                onClick={(e) => {
                  e.stopPropagation();
                  onWindowMinimizedChange(true);
                }}
              >
                <Minimize2 className="h-4 w-4" />
              </button>
              <button
                aria-label="Close chat"
                className="flex h-8 w-8 items-center justify-center rounded-full p-0 hover:bg-white/20"
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
          {!isWindowMinimized && (
            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto p-5"
              style={{
                scrollbarColor: '#E5E7EB transparent',
                scrollbarWidth: 'thin',
                backgroundColor: formData.chatBodyBg || '#F9FAFB',
              }}
            >
              {messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <div
                    key={message.id}
                    ref={(el) => {
                      const map = msgRefs.current;
                      if (el) map.set(message.id, el);
                      else map.delete(message.id);
                    }}
                    className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div
                      className={getAvatarClass(isUser)}
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
                    <div
                      className={`max-w-[70%] ${isUser ? 'text-right' : 'text-left'}`}
                    >
                      <div
                        className="px-4 py-3"
                        style={{
                          ...getMessageStyle(isUser),
                          borderRadius: `${isUser ? formData.userMessageBorderRadius || 14 : formData.systemMessageBorderRadius || 14}px`,
                        }}
                      >
                        <p className="text-sm leading-relaxed">{message.text}</p>
                      </div>
                      {formData.showTimestamp && (
                        <p
                          className="mt-1 px-2 text-xs"
                          style={{
                            color: formData.timestampColor || '#6B7280',
                          }}
                        >
                          {formatTimestamp(message.timestamp)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Conversation starters */}
              {messages.length === 1 &&
                formData.conversationalStarters.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {formData.conversationalStarters
                      .slice(0, 4)
                      .map((starter, index) => (
                        <button
                          key={starter + index}
                          onClick={() => onSendMessage(starter)}
                          className="border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors hover:bg-gray-50"
                          style={{
                            borderRadius: `${formData.systemMessageBorderRadius || 14}px`,
                          }}
                        >
                          {starter}
                        </button>
                      ))}
                  </div>
                )}

              {/* Typing indicator */}
              {typingIndicator && (
                <div className="flex gap-3">
                  <div
                    className={getAvatarClass(false)}
                    style={{
                      backgroundColor: formData.botAvatarBg,
                      color: formData.botAvatarColor || '#FFFFFF',
                    }}
                  >
                    {getBotAvatarContent()}
                  </div>
                  <div
                    className="flex items-center space-x-1 bg-white px-4 py-2"
                    style={{
                      borderRadius: `${formData.systemMessageBorderRadius || 14}px`,
                    }}
                  >
                    <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: '0.1s' }}
                    />
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                </div>
              )}

              {/* Scroll sentinel */}
              <div ref={bottomRef} aria-hidden="true" />
            </div>
          )}

          {/* Input area */}
          {!isWindowMinimized && (
            <div
              className="border-t border-gray-200 p-4"
              style={{ backgroundColor: formData.inputBg }}
            >
              <div className="flex gap-3">
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={formData.inputPlaceholder}
                  className="flex-1 border-gray-200 px-4 py-2 focus:ring-2 focus:ring-blue-500"
                  style={{
                    color: formData.inputTextColor,
                    borderRadius: `${formData.inputBorderRadius || 14}px`,
                  }}
                />
                <button
                  onClick={handleSend}
                  aria-label="Send message"
                  className="flex h-10 w-10 items-center justify-center p-0"
                  style={{
                    backgroundColor: formData.sendButtonBg,
                    borderRadius: `${formData.sendButtonBorderRadius || 14}px`,
                    color: formData.sendButtonIconColor || '#FFFFFF',
                  }}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Branding footer */}
          {formData.brandingEnabled && (
            <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
              <p
                className="text-xs"
                style={{ color: formData.brandingTextColor || '#6B7280' }}
              >
                {formData.brandingTextPrefix}{' '}
                {formData.brandingUseLogo && formData.brandingLogo ? (
                  <img
                    src={formData.brandingLogo}
                    alt="Brand"
                    className="inline-block h-4 align-[-2px]"
                  />
                ) : (
                  <a
                    href={formData.brandingLinkUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium"
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
