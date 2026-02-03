import { useState } from 'preact/hooks';

export function App() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div class="codeweaves-widget">
      {isOpen ? (
        <div class="widget-chat-window">
          <div class="widget-header">
            <span>Chat</span>
            <button onClick={() => setIsOpen(false)}>×</button>
          </div>
          <div class="widget-messages">
            <p>Welcome! How can I help you today?</p>
          </div>
          <div class="widget-input">
            <input type="text" placeholder="Type a message..." />
            <button>Send</button>
          </div>
        </div>
      ) : (
        <button
          class="widget-trigger"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          💬
        </button>
      )}
    </div>
  );
}
