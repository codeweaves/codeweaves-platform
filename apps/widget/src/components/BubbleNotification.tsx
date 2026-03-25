import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

export interface BubbleNotificationProps {
  /** Agent ID — used for sessionStorage dismiss key */
  agentId: string;
  /** Bubble config from theme API */
  bubbleConfig: {
    enabled: boolean;
    text: string;
    delayMs: number;
  };
  /** Whether the chat window is currently open */
  isOpen: boolean;
  /** Callback to open the chat window */
  onOpen: () => void;
}

/** Session storage key for bubble dismiss state */
function dismissKey(agentId: string): string {
  return `cw_bubble_dismissed_${agentId}`;
}

/** Check if bubble was dismissed this session */
function isDismissed(agentId: string): boolean {
  try {
    return sessionStorage.getItem(dismissKey(agentId)) === 'true';
  } catch {
    return false;
  }
}

/** Persist dismiss state for this session */
function persistDismiss(agentId: string): void {
  try {
    sessionStorage.setItem(dismissKey(agentId), 'true');
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — bubble just won't persist dismiss
  }
}

/** Greeting bubble notification — appears near the chat icon to encourage conversation */
export function BubbleNotification({
  agentId,
  bubbleConfig,
  isOpen,
  onOpen,
}: BubbleNotificationProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Track mount state to prevent state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Delayed appearance
  useEffect(() => {
    // Gate: don't show if disabled, dismissed, or chat is open
    if (!bubbleConfig.enabled || isDismissed(agentId) || isOpen) {
      return;
    }

    const delay = bubbleConfig.delayMs >= 0 ? bubbleConfig.delayMs : 3000;
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setVisible(true);
      }
    }, delay);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [agentId, bubbleConfig.enabled, bubbleConfig.delayMs, isOpen]);

  // Hide when chat opens
  useEffect(() => {
    if (isOpen && visible) {
      setVisible(false);
    }
  }, [isOpen, visible]);

  const dismiss = useCallback(() => {
    persistDismiss(agentId);
    setVisible(false);
  }, [agentId]);

  const handleDismiss = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dismiss();
    },
    [dismiss],
  );

  const handleBubbleClick = useCallback(() => {
    dismiss();
    onOpen();
  }, [dismiss, onOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleBubbleClick();
      }
    },
    [handleBubbleClick],
  );

  const handleDismissKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    },
    [dismiss],
  );

  // Don't render if: not enabled, dismissed, chat open, or not yet visible
  if (!bubbleConfig.enabled || !visible || isOpen) {
    return null;
  }

  return (
    <div
      class="cw-bubble-notification cw-bubble-animate-in"
      role="status"
      aria-live="polite"
      onClick={handleBubbleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <button
        class="cw-bubble-close"
        onClick={handleDismiss}
        onKeyDown={handleDismissKeyDown}
        aria-label="Dismiss notification"
        type="button"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M1 1l8 8M9 1l-8 8" />
        </svg>
      </button>
      <span class="cw-bubble-text">{bubbleConfig.text}</span>
      <span class="cw-bubble-arrow" />
    </div>
  );
}
