import type { ChatMessage } from '../types';
import { Avatar } from './Avatar';

export interface MessageBubbleProps {
  message: ChatMessage;
  showTimestamp: boolean;
  avatarShape: 'circle' | 'square';
  botAvatarUrl?: string;
  userAvatarUrl?: string;
}

/** Safely convert a value to an ISO string for the datetime attribute */
function safeISOString(date: Date): string {
  try {
    return date.toISOString();
  } catch {
    return '';
  }
}

/** Format a Date to a short time string (e.g. "2:34 PM") */
function formatTime(date: Date): string {
  try {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Chat message bubble with avatar, timestamp, and streaming cursor */
export function MessageBubble({
  message,
  showTimestamp,
  avatarShape,
  botAvatarUrl,
  userAvatarUrl,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const bubbleClass = isUser ? 'cw-msg cw-msg-user' : 'cw-msg cw-msg-bot';
  const avatarClass =
    'cw-msg-avatar' +
    (avatarShape === 'square' ? ' cw-msg-avatar-square' : '');

  const avatarLetter = isUser ? 'U' : 'A';
  const avatarUrl = isUser ? userAvatarUrl : botAvatarUrl;

  return (
    <div class={bubbleClass}>
      {!isUser && (
        <Avatar imageUrl={avatarUrl} letter={avatarLetter} avatarClass={avatarClass} />
      )}
      <div class="cw-msg-content">
        <div class="cw-msg-bubble">
          <span class="cw-msg-text">
            {message.content}
            {message.isStreaming && (
              <span class="cw-msg-cursor" aria-hidden="true" />
            )}
          </span>
        </div>
        {showTimestamp && (
          <time class="cw-msg-time" dateTime={safeISOString(message.timestamp)}>
            {formatTime(message.timestamp)}
          </time>
        )}
      </div>
      {isUser && (
        <Avatar imageUrl={avatarUrl} letter={avatarLetter} avatarClass={avatarClass} />
      )}
    </div>
  );
}
