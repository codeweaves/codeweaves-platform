/** Message type — text, audio, or system */
export type MessageType = 'text' | 'audio' | 'system';

/** Message sender role */
export type MessageRole = 'user' | 'assistant';

/** Message delivery status */
export type MessageStatus = 'sending' | 'sent' | 'error';

/** A single chat message with support for text and audio content */
export interface Message {
  /** Unique message ID (UUID or backend-provided) */
  id: string;
  /** Sender role */
  role: MessageRole;
  /** Content type (defaults to 'text') */
  type?: MessageType;
  /** Text content (for text messages) or empty string (for audio-only messages) */
  content: string;
  /** When the message was created */
  timestamp: Date;
  /** Delivery status (defaults to 'sent') */
  status?: MessageStatus;
  /** True while message content is being streamed */
  isStreaming?: boolean;
  /** Object URL or server URL for audio playback */
  audioUrl?: string;
  /** Audio duration in milliseconds */
  audioDuration?: number;
  /** Raw audio blob for user recordings (not serialized to sessionStorage) */
  audioBlob?: Blob;
  /** Error details when status is 'error' */
  errorMessage?: string;
}
