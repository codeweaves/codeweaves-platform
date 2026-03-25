interface ChatWindowProps {
  onClose: () => void;
}

/** Chat window placeholder — full implementation in later stories */
export function ChatWindow({ onClose }: ChatWindowProps) {
  return (
    <div class="cw-chat-window">
      <div class="cw-chat-header">
        <span>Chat</span>
        <button onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </div>
      <div class="cw-chat-messages">
        <p>Welcome! How can I help you today?</p>
      </div>
    </div>
  );
}
