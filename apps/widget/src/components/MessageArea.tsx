import { useRef, useEffect, useCallback, useMemo } from 'preact/hooks';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { messages as messagesSignal, showTyping } from '../state/chat-store';

/** Threshold in px: if user is within this distance of the bottom, auto-scroll */
const SCROLL_THRESHOLD = 50;

export interface MessageAreaProps {
  showTimestamp: boolean;
  botAvatarShape: 'circle' | 'square' | 'rounded';
  userAvatarShape: 'circle' | 'square' | 'rounded';
  botAvatarUrl?: string;
  userAvatarUrl?: string;
  botAvatarType?: string;
  userAvatarType?: string;
  greeting: string;
  /** Called when typing indicator times out (30s) */
  onTypingTimeout: () => void;
}

/** Scrollable message list with auto-scroll and empty/greeting state */
export function MessageArea({
  showTimestamp,
  botAvatarShape,
  userAvatarShape,
  botAvatarUrl,
  userAvatarUrl,
  botAvatarType,
  userAvatarType,
  greeting,
  onTypingTimeout: handleTypingTimeout,
}: MessageAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const greetingTimestampRef = useRef(new Date());

  // Read messages from centralized store (Story 5-21)
  const msgs = messagesSignal.value;
  const isTyping = showTyping.value;

  const checkAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Auto-scroll when messages change or typing indicator appears
  useEffect(() => {
    scrollToBottom();
  }, [msgs, isTyping, scrollToBottom]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    checkAtBottom();
  }, [checkAtBottom]);

  // Build display messages: prepend greeting as first bot message if present
  const trimmedGreeting = greeting.trim();
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (trimmedGreeting.length === 0) return msgs;
    return [
      {
        id: '__greeting__',
        role: 'assistant' as const,
        content: trimmedGreeting,
        timestamp: greetingTimestampRef.current,
      },
      ...msgs,
    ];
  }, [trimmedGreeting, msgs]);

  return (
    <div
      ref={containerRef}
      class="cw-message-area"
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      onScroll={handleScroll}
    >
      <div class="cw-message-area-inner">
        {displayMessages.length === 0 ? (
          <div class="cw-msg-empty">No messages yet</div>
        ) : (
          displayMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              showTimestamp={showTimestamp}
              botAvatarShape={botAvatarShape}
              userAvatarShape={userAvatarShape}
              botAvatarUrl={botAvatarUrl}
              userAvatarUrl={userAvatarUrl}
              botAvatarType={botAvatarType}
              userAvatarType={userAvatarType}
            />
          ))
        )}
        <TypingIndicator
          avatarShape={botAvatarShape}
          botAvatarUrl={botAvatarUrl}
          botAvatarType={botAvatarType}
          onTimeout={handleTypingTimeout}
        />
      </div>
    </div>
  );
}
