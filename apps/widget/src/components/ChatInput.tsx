import { useRef, useImperativeHandle } from 'preact/hooks';
import { forwardRef } from 'preact/compat';

export interface ChatInputHandle {
  focus: () => void;
  /** Get the underlying input element for focus trap */
  getInputElement: () => HTMLInputElement | null;
}

/** Chat input with send button — stub, actual send logic in later stories */
export const ChatInput = forwardRef<ChatInputHandle>(function ChatInput(
  _props,
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    getInputElement: () => inputRef.current,
  }));

  return (
    <div class="cw-chat-input">
      <input
        ref={inputRef}
        class="cw-chat-input-field"
        type="text"
        placeholder="Type a message..."
        aria-label="Message input"
        autocomplete="off"
      />
      <button
        class="cw-chat-send-btn"
        type="button"
        aria-label="Send message"
        disabled
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
    </div>
  );
});
