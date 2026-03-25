import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import type { AgentConfig, ChatMessage } from '../types';
import { ChatHeader } from './ChatHeader';
import { MessageArea } from './MessageArea';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { ConversationStarters } from './ConversationStarters';
import type { StarterItem } from './ConversationStarters';
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const windowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);

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

  const handleStarterSelect = useCallback(
    (message: string) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      // TODO: send message to API (future story)
    },
    [setMessages],
  );

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
      aria-label={`Chat with ${agentConfig.name}`}
      onKeyDown={handleKeyDown}
    >
      <ChatHeader
        agentConfig={agentConfig}
        theme={theme}
        onMinimize={onMinimize}
        onClose={onClose}
      />
      <MessageArea
        messages={messages}
        showTimestamp={chatConfig.showTimestamp}
        avatarShape={chatConfig.avatarShape}
        botAvatarUrl={chatConfig.botAvatarUrl}
        userAvatarUrl={chatConfig.userAvatarUrl}
        greeting={agentConfig.greeting}
      />
      {starterItems.length > 0 && (
        <ConversationStarters
          starters={starterItems}
          onSelect={handleStarterSelect}
          visible={!hasUserMessages}
        />
      )}
      <ChatInput ref={inputRef} />
    </div>
  );
}
