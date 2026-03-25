import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { AgentConfig } from '../types';
import { ChatHeader } from './ChatHeader';
import { MessageArea } from './MessageArea';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { lockScroll, unlockScroll } from '../shadow-dom';

const ANIMATION_DURATION_MS = 300;
const MOBILE_BREAKPOINT = 480;
/** Cap keyboard height to 60% of viewport to filter orientation-change spikes */
const MAX_KEYBOARD_RATIO = 0.6;

export interface ChatWindowProps {
  /** Agent configuration */
  agentConfig: AgentConfig;
  /** Theme object for header/chat styling */
  theme: Record<string, unknown> | null;
  /** Called when close button is clicked */
  onClose: () => void;
  /** Called when minimize button is clicked */
  onMinimize: () => void;
  /** Trigger button position — determines transform-origin */
  position: 'left' | 'right';
}

/** Chat window — the expanded chat interface */
export function ChatWindow({
  agentConfig,
  theme,
  onClose,
  onMinimize,
  position,
}: ChatWindowProps) {
  const [animating, setAnimating] = useState(true);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT,
  );
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const windowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);

  // Open animation + auto-focus input after animation
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimating(false);
      inputRef.current?.focus();
    }, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  // P1: Reactive mobile detection via resize listener
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Mobile scroll lock
  useEffect(() => {
    if (isMobile) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isMobile]);

  // iOS keyboard handling via VisualViewport API
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      const kbHeight = window.innerHeight - vv.height;
      // P6: Cap to MAX_KEYBOARD_RATIO to filter orientation-change spikes
      const maxKb = window.innerHeight * MAX_KEYBOARD_RATIO;
      setKeyboardHeight(kbHeight > 50 && kbHeight < maxKb ? kbHeight : 0);
    };

    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  // Escape key closes
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap: Tab cycles within the dialog
      if (e.key === 'Tab') {
        const container = windowRef.current;
        if (!container) return;

        // Collect focusable elements inside shadow DOM component
        const focusableSelector =
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(focusableSelector),
        );

        if (focusables.length === 0) return;

        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;

        // Find active element — in shadow DOM, use getRootNode()
        const root = container.getRootNode() as ShadowRoot | Document;
        const active = root.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          // Shift+Tab from first → wrap to last
          if (active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab from last → wrap to first
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  const transformOrigin =
    position === 'left' ? 'bottom left' : 'bottom right';

  const animationClass = animating
    ? 'cw-chat-window cw-chat-opening'
    : 'cw-chat-window cw-chat-open';

  const mobileClass = isMobile ? ' cw-chat-mobile' : '';

  const windowStyle = keyboardHeight > 0
    ? { maxHeight: `calc(100% - ${keyboardHeight}px)` }
    : undefined;

  return (
    <div
      ref={windowRef}
      class={animationClass + mobileClass}
      style={{ ...windowStyle, transformOrigin }}
      role="dialog"
      aria-modal="true"
      aria-label={`Chat with ${agentConfig.name}`}
      onKeyDown={handleKeyDown}
    >
      <ChatHeader
        agentConfig={agentConfig}
        theme={theme}
        onMinimize={onMinimize}
        onClose={onClose}
      />
      <MessageArea />
      <ChatInput ref={inputRef} />
    </div>
  );
}
