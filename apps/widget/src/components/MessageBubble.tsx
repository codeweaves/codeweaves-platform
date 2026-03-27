import { useMemo } from 'preact/hooks';
import type { ChatMessage } from '../types';
import { Avatar } from './Avatar';
import { getBotAvatarIcon, getUserAvatarIcon } from './avatar-icons';
import { sanitizeHtml } from '../utils/sanitizer';
import { markdownToHtml } from '../utils/markdown';

export interface MessageBubbleProps {
  message: ChatMessage;
  showTimestamp: boolean;
  botAvatarShape: 'circle' | 'square' | 'rounded';
  userAvatarShape: 'circle' | 'square' | 'rounded';
  botAvatarUrl?: string;
  userAvatarUrl?: string;
  botAvatarType?: string;
  userAvatarType?: string;
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

function shapeToClass(shape: 'circle' | 'square' | 'rounded'): string {
  if (shape === 'square') return ' cw-msg-avatar-square';
  if (shape === 'rounded') return ' cw-msg-avatar-rounded';
  return '';
}

/** Chat message bubble with avatar, timestamp, and streaming cursor */
export function MessageBubble({
  message,
  showTimestamp,
  botAvatarShape,
  userAvatarShape,
  botAvatarUrl,
  userAvatarUrl,
  botAvatarType,
  userAvatarType,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAudio = message.type === 'audio';
  const bubbleClass = isUser ? 'cw-msg cw-msg-user' : 'cw-msg cw-msg-bot';
  const avatarClass = 'cw-msg-avatar' + shapeToClass(isUser ? userAvatarShape : botAvatarShape);

  const avatarLetter = isUser ? 'U' : 'A';
  const avatarUrl = isUser ? userAvatarUrl : botAvatarUrl;
  const avatarIcon = isUser
    ? getUserAvatarIcon(userAvatarType)
    : getBotAvatarIcon(botAvatarType);

  // User messages: always plain text (XSS safe). Bot/system: markdown → sanitized HTML.
  // Audio messages: no text sanitization needed (renders player UI).
  const renderedHtml = useMemo(() => {
    if (isUser || isAudio || !message.content) return null;
    return sanitizeHtml(markdownToHtml(message.content));
  }, [message.content, isUser, isAudio]);

  // Append streaming cursor inside sanitized HTML so it appears inline with text
  const displayHtml = useMemo(() => {
    if (!renderedHtml) return null;
    if (message.isStreaming) {
      return renderedHtml + '<span class="cw-msg-cursor" aria-hidden="true"></span>';
    }
    return renderedHtml;
  }, [renderedHtml, message.isStreaming]);

  return (
    <div class={bubbleClass}>
      {!isUser && (
        <Avatar imageUrl={avatarUrl} letter={avatarLetter} avatarClass={avatarClass} icon={avatarIcon} />
      )}
      <div class="cw-msg-content">
        <div class="cw-msg-bubble">
          {isUser ? (
            <span class="cw-msg-text">
              {message.content}
              {message.isStreaming && (
                <span class="cw-msg-cursor" aria-hidden="true" />
              )}
            </span>
          ) : displayHtml ? (
            <span
              class="cw-msg-text"
              dangerouslySetInnerHTML={{ __html: displayHtml }}
            />
          ) : (
            <span class="cw-msg-text">
              {message.content}
              {message.isStreaming && (
                <span class="cw-msg-cursor" aria-hidden="true" />
              )}
            </span>
          )}
        </div>
        {showTimestamp && (
          <time class="cw-msg-time" dateTime={safeISOString(message.timestamp)}>
            {formatTime(message.timestamp)}
          </time>
        )}
      </div>
      {isUser && (
        <Avatar imageUrl={avatarUrl} letter={avatarLetter} avatarClass={avatarClass} icon={avatarIcon} />
      )}
    </div>
  );
}
