/** Message type — text, audio, or system */
export type MessageType = 'text' | 'audio' | 'system';

/**
 * Message sender role. `human` = a teammate replying after taking over.
 * `system` = a handover status line (took over / resolved / …) — stored ONLY so
 * it can be sent to the model as context; never rendered as a chat bubble.
 */
export type MessageRole = 'user' | 'assistant' | 'human' | 'system';

/** Message delivery status */
export type MessageStatus = 'sending' | 'sent' | 'error';

/**
 * A knowledge-base source cited in a bot reply. Arrives in the `done` SSE
 * event's metadata; the message text carries matching inline [n] markers.
 */
export interface Citation {
  /** 1-based marker index matching the inline [n] in the message text */
  index: number;
  documentId: string;
  documentName: string;
  sourceType: 'FILE' | 'URL';
  /** Link target for URL documents (null for uploaded files) */
  sourceUrl: string | null;
  /** Short excerpt of the cited passage (shown as chip tooltip) */
  snippet: string;
}

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
  /** Knowledge-base sources cited in this bot reply (set on stream done) */
  citations?: Citation[];
}
