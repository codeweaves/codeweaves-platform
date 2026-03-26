import { useEffect, useRef } from 'preact/hooks';
import { Avatar } from './Avatar';

export interface TypingIndicatorProps {
  /** Whether the typing indicator is visible */
  visible: boolean;
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
 */
export function TypingIndicator({
  visible,
  avatarShape,
  botAvatarUrl,
  onTimeout,
}: TypingIndicatorProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
