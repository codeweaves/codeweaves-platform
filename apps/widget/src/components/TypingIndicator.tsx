import { useEffect, useRef } from 'preact/hooks';
import { Avatar } from './Avatar';
import { showTyping } from '../state/chat-store';

export interface TypingIndicatorProps {
  /** Avatar shape — circle or square */
  avatarShape: 'circle' | 'square';
  /** Custom bot avatar image URL */
  botAvatarUrl?: string;
  /** Called when 30s timeout fires with no response */
  onTimeout: () => void;
}

/** Timeout duration in milliseconds */
const TIMEOUT_MS = 30_000;

/**
 * Typing indicator — three bouncing dots shown while waiting for
 * the first SSE token from the backend.
 * Reads visibility from the store's showTyping signal (Story 5-21).
 */
export function TypingIndicator({
  avatarShape,
  botAvatarUrl,
  onTimeout,
}: TypingIndicatorProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read visibility from store
  const visible = showTyping.value;

  // Start / clear 30-second timeout when visibility changes
  useEffect(() => {
    if (visible) {
      timeoutRef.current = setTimeout(() => {
        onTimeout();
      }, TIMEOUT_MS);
    }

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [visible, onTimeout]);

  if (!visible) return null;

  const avatarClass =
    'cw-msg-avatar' +
    (avatarShape === 'square' ? ' cw-msg-avatar-square' : '');

  return (
    <div class="cw-msg cw-msg-bot" role="status" aria-label="Assistant is typing">
      <Avatar imageUrl={botAvatarUrl} letter="A" avatarClass={avatarClass} />
      <div class="cw-msg-content">
        <div class="cw-msg-bubble cw-typing-bubble">
          <span class="cw-typing-dot" />
          <span class="cw-typing-dot" />
          <span class="cw-typing-dot" />
        </div>
      </div>
    </div>
  );
}
