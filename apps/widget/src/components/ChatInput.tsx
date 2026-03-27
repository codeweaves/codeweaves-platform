import { useRef, useImperativeHandle, useState, useCallback } from 'preact/hooks';
import { forwardRef } from 'preact/compat';

export interface ChatInputHandle {
  focus: () => void;
  /** Get the underlying input element for focus trap */
  getInputElement: () => HTMLInputElement | null;
}

export interface ChatInputProps {
  /** Called with the message text when user submits */
  onSend?: (text: string) => void;
  /** Whether input and send button are disabled */
  disabled?: boolean;
  /** Placeholder text override */
  placeholder?: string;
  /** Whether a stream is currently active — shows Stop button */
  isStreaming?: boolean;
  /** Called when user clicks Stop button to cancel active stream */
  onStop?: () => void;
}

/** Chat input with send/stop button — wired to useChat hook (Story 5-18, 5-19) */
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ onSend, disabled = false, placeholder, isStreaming = false, onStop }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [text, setText] = useState('');

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      getInputElement: () => inputRef.current,
    }));

    const handleSubmit = useCallback(() => {
      const trimmed = text.trim();
      if (!trimmed || disabled || !onSend) return;
      onSend(trimmed);
      setText('');
    }, [text, disabled, onSend]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit],
    );

    const handleInput = useCallback((e: Event) => {
      setText((e.target as HTMLInputElement).value);
    }, []);

    const canSend = text.trim().length > 0 && !disabled;

    return (
      <div class="cw-chat-input">
        <input
          ref={inputRef}
          class="cw-chat-input-field"
          type="text"
          placeholder={placeholder ?? 'Type a message...'}
          aria-label="Message input"
          autocomplete="off"
          value={text}
          maxLength={4000}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {isStreaming ? (
          <button
            class="cw-chat-stop-btn"
            type="button"
            aria-label="Stop generating"
            onClick={onStop}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            class="cw-chat-send-btn"
            type="button"
            aria-label="Send message"
            disabled={!canSend}
            onClick={handleSubmit}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);
