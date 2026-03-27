import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import type { AgentConfig } from '../types';
import { ChatHeader } from './ChatHeader';
import { MessageArea } from './MessageArea';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { ConversationStarters } from './ConversationStarters';
import type { StarterItem } from './ConversationStarters';
import { lockScroll, unlockScroll } from '../shadow-dom';
import { useChat } from '../hooks/useChat';

const ANIMATION_DURATION_MS = 300;
const MOBILE_BREAKPOINT = 480;
/** Cap keyboard height to 60% of viewport to filter orientation-change spikes */
const MAX_KEYBOARD_RATIO = 0.6;

export interface ChatWindowProps {
  /** Agent ID for API calls */
  agentId: string;
  /** Agent configuration */
  agentConfig: AgentConfig;
  /** Theme object for header/chat styling */
  theme: Record<string, unknown> | null;
  /** Called when close button is clicked */
  onClose: () => void;
  /** Called when minimize button is clicked */
  onMinimize: () => void;
  /** Called when expanding from minimized state */
  onExpand: () => void;
  /** Whether the window is in minimized (header-only) state */
  isMinimized: boolean;
  /** Trigger button position — determines transform-origin */
  position: 'left' | 'right';
}

/** Validate URL is safe (http/https only) */
function safeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

/** Extract chat display config from theme */
function extractChatConfig(theme: Record<string, unknown> | null): {
  showTimestamp: boolean;
  avatarShape: 'circle' | 'square';
  botAvatarUrl: string | undefined;
  userAvatarUrl: string | undefined;
} {
  if (!theme) return { showTimestamp: false, avatarShape: 'circle', botAvatarUrl: undefined, userAvatarUrl: undefined };

  const timestamps = theme.timestamps as Record<string, unknown> | undefined;
  const showTimestamp = timestamps?.show === true;

  const botAvatar = theme.botAvatar as Record<string, unknown> | undefined;
  const userAvatar = theme.userAvatar as Record<string, unknown> | undefined;
  const avatarShape =
    botAvatar?.shape === 'square' ? 'square' : 'circle';

  const botAvatarUrl = botAvatar?.type === 'custom' ? safeUrl(botAvatar.customImageUrl) : undefined;
  const userAvatarUrl = userAvatar?.type === 'custom' ? safeUrl(userAvatar.customImageUrl) : undefined;

  return { showTimestamp, avatarShape, botAvatarUrl, userAvatarUrl };
}

/** Chat window — the expanded chat interface */
export function ChatWindow({
  agentId,
  agentConfig,
  theme,
  onClose,
  onMinimize,
  onExpand,
  isMinimized,
  position,
}: ChatWindowProps) {
  const [animating, setAnimating] = useState(true);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT,
  );
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const wasMinimizedRef = useRef(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);

  // Core chat state from useChat hook (Story 5-18)
  const { messages, isLoading, isRateLimited, error, sendMessage, clearError, handleTimeout } = useChat({ agentId });

  const chatConfig = extractChatConfig(theme);

  // Conversation starters: visible only when no user messages exist
  const hasUserMessages = useMemo(
    () => messages.some((m) => m.role === 'user'),
    [messages],
  );

  const starterItems = useMemo<StarterItem[]>(
    () =>
      (agentConfig.starters ?? [])
        .filter((s) => s.trim().length > 0)
        .map((s) => ({ message: s })),
    [agentConfig.starters],
  );

  // Conversation starter click uses same sendMessage flow as manual typing (AC 7)
  const handleStarterSelect = useCallback(
    (message: string) => {
      sendMessage(message);
    },
    [sendMessage],
  );

  /** Called when typing indicator times out after 30s with no response */
  const handleTypingTimeout = useCallback(() => {
    handleTimeout();
  }, [handleTimeout]);

  // Input disabled when loading or rate limited
  const inputDisabled = isLoading || isRateLimited;

  // Placeholder changes during rate limit cooldown
  const inputPlaceholder = isRateLimited ? 'Please wait...' : undefined;

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

  // Mobile scroll lock — only when expanded (not minimized)
  useEffect(() => {
    if (isMobile && !isMinimized) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isMobile, isMinimized]);

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

  // Track minimize/expand transitions for focus management and scroll restore
  useEffect(() => {
    if (isMinimized) {
      wasMinimizedRef.current = true;
      // Focus header when minimized (prevents focus on hidden elements)
      headerRef.current?.focus();
    } else if (wasMinimizedRef.current) {
      // Expanding from minimized: add transition class, scroll to bottom and focus input
      wasMinimizedRef.current = false;
      const el = windowRef.current;
      if (el) {
        el.classList.add('cw-chat-window--expanding');
        const onEnd = () => {
          el.classList.remove('cw-chat-window--expanding');
          el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd, { once: true });
        // Fallback removal if transitionend doesn't fire (e.g. reduced motion)
        setTimeout(onEnd, ANIMATION_DURATION_MS + 50);
      }
      requestAnimationFrame(() => {
        const msgArea = windowRef.current?.querySelector('.cw-message-area');
        if (msgArea) {
          msgArea.scrollTop = msgArea.scrollHeight;
        }
        inputRef.current?.focus();
      });
    }
  }, [isMinimized]);

  /** Handle header click to expand from minimized (AC #3) */
  const handleHeaderClick = useCallback(
    (e: MouseEvent) => {
      if (!isMinimized) return;
      // Don't expand if clicking a button (close/minimize)
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      onExpand();
    },
    [isMinimized, onExpand],
  );

  /** Handle header keyboard to toggle minimized (AC #3 accessibility) */
  const handleHeaderKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isMinimized) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onExpand();
      }
    },
    [isMinimized, onExpand],
  );

  // Escape key closes (ignored when minimized to prevent accidental conversation loss)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMinimized) return; // Don't destroy conversation from minimized state
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap: Tab cycles within the dialog (skip when minimized — only header is interactive)
      if (e.key === 'Tab') {
        const container = windowRef.current;
        if (!container) return;

        // When minimized, only trap focus within the header (visible elements)
        const scope = isMinimized
          ? container.querySelector('.cw-chat-header')
          : container;
        if (!scope) return;

        // Collect focusable elements inside shadow DOM component
        const focusableSelector =
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          scope.querySelectorAll<HTMLElement>(focusableSelector),
        );

        if (focusables.length === 0) return;

        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;

        // Find deepest active element — traverse nested shadow roots
        let active: HTMLElement | null = (container.getRootNode() as ShadowRoot | Document).activeElement as HTMLElement | null;
        while (active?.shadowRoot?.activeElement) {
          active = active.shadowRoot.activeElement as HTMLElement;
        }

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
    [onClose, isMinimized],
  );

  const transformOrigin =
    position === 'left' ? 'bottom left' : 'bottom right';

  const animationClass = animating
    ? 'cw-chat-window cw-chat-opening'
    : 'cw-chat-window cw-chat-open';

  const minimizedClass = isMinimized ? ' cw-chat-window--minimized' : '';
  const mobileClass = isMobile ? ' cw-chat-mobile' : '';

  const windowStyle = keyboardHeight > 0
    ? { maxHeight: `calc(100% - ${keyboardHeight}px)` }
    : undefined;

  // Show typing indicator when loading and last message is from user (AC 3)
  const showTyping = isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'user';

  return (
    <div
      ref={windowRef}
      class={animationClass + minimizedClass + mobileClass}
      style={{ ...windowStyle, transformOrigin }}
      role="dialog"
      aria-label={`Chat with ${agentConfig.name}`}
      onKeyDown={handleKeyDown}
    >
      <ChatHeader
        ref={headerRef}
        agentConfig={agentConfig}
        theme={theme}
        isMinimized={isMinimized}
        onMinimize={onMinimize}
        onClose={onClose}
        onHeaderClick={handleHeaderClick}
        onHeaderKeyDown={handleHeaderKeyDown}
      />
      <div class="cw-chat-body">
        <MessageArea
          messages={messages}
          showTimestamp={chatConfig.showTimestamp}
          avatarShape={chatConfig.avatarShape}
          botAvatarUrl={chatConfig.botAvatarUrl}
          userAvatarUrl={chatConfig.userAvatarUrl}
          greeting={agentConfig.greeting}
          isTyping={showTyping}
          onTypingTimeout={handleTypingTimeout}
        />
        {starterItems.length > 0 && (
          <ConversationStarters
            starters={starterItems}
            onSelect={handleStarterSelect}
            visible={!hasUserMessages}
          />
        )}
        <ChatInput
          ref={inputRef}
          onSend={sendMessage}
          disabled={inputDisabled}
          placeholder={inputPlaceholder}
        />
        {error && (
          <div class="cw-chat-error" role="alert" aria-live="assertive">
            <span class="cw-chat-error-text">{error}</span>
            <button
              type="button"
              class="cw-chat-error-dismiss"
              aria-label="Dismiss error"
              onClick={clearError}
            >
              &times;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
