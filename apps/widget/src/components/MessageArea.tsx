import { useRef, useEffect, useCallback, useMemo } from 'preact/hooks';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';

/** Threshold in px: if user is within this distance of the bottom, auto-scroll */
const SCROLL_THRESHOLD = 50;

export interface MessageAreaProps {
  messages: ChatMessage[];
  showTimestamp: boolean;
  avatarShape: 'circle' | 'square';
  botAvatarUrl?: string;
  userAvatarUrl?: string;
  greeting: string;
  /** Whether to show the typing indicator */
  isTyping?: boolean;
  /** Called when typing indicator times out (30s) — required when isTyping is used */
  onTypingTimeout: () => void;
}

/** Scrollable message list with auto-scroll and empty/greeting state */
export function MessageArea({
  messages,
  showTimestamp,
  avatarShape,
  botAvatarUrl,
  userAvatarUrl,
  greeting,
  isTyping = false,
  onTypingTimeout: handleTypingTimeout,
}: MessageAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Whether the user is at or near the bottom of the scroll */
  const isAtBottomRef = useRef(true);
  /** Stable timestamp for the greeting message — created once on mount */
  const greetingTimestampRef = useRef(new Date());

  /** Check if scrolled to bottom */
  const checkAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
  }, []);

  /** Scroll to bottom if user is near the bottom */
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
  }, [messages, isTyping, scrollToBottom]);

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
    if (trimmedGreeting.length === 0) return messages;
    return [
      {
        id: '__greeting__',
        role: 'assistant',
        content: trimmedGreeting,
        timestamp: greetingTimestampRef.current,
      },
      ...messages,
    ];
  }, [trimmedGreeting, messages]);

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
              avatarShape={avatarShape}
              botAvatarUrl={botAvatarUrl}
              userAvatarUrl={userAvatarUrl}
            />
          ))
        )}
        <TypingIndicator
          visible={isTyping}
          avatarShape={avatarShape}
          botAvatarUrl={botAvatarUrl}
          onTimeout={handleTypingTimeout}
        />
      </div>
    </div>
  );
}
