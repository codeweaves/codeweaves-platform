import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import type { AgentConfig } from '../types';
import { ChatHeader } from './ChatHeader';
import { MessageArea } from './MessageArea';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { BrandingFooter } from './BrandingFooter';
import type { BrandingFooterProps } from './BrandingFooter';
import { ConversationStarters } from './ConversationStarters';
import type { StarterItem } from './ConversationStarters';
import { VoiceRecorder } from './VoiceRecorder';
import { VoiceErrorBanner } from './VoiceErrorBanner';
import { lockScroll, unlockScroll } from '../shadow-dom';
import { isSafeUrl } from '../utils/url';
import { useChat } from '../hooks/useChat';
import { useVoice, getErrorSeverity } from '../hooks/useVoice';
import {
  widgetState,
  isLoading,
  isStreaming,
  isRateLimited,
  error as errorSignal,
} from '../state/chat-store';

const ANIMATION_DURATION_MS = 300;
const MOBILE_BREAKPOINT = 480;
const MAX_KEYBOARD_RATIO = 0.6;

export interface ChatWindowProps {
  agentId: string;
  agentConfig: AgentConfig;
  theme: Record<string, unknown> | null;
  position: 'left' | 'right';
}

/** Extract and validate a URL string from theme config */
function safeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  return isSafeUrl(trimmed) ? trimmed : undefined;
}

type AvatarShape = 'circle' | 'square' | 'rounded';

function parseShape(raw: unknown): AvatarShape {
  return raw === 'square' ? 'square' : raw === 'rounded' ? 'rounded' : 'circle';
}

/** Extract chat display config from theme */
function extractChatConfig(theme: Record<string, unknown> | null): {
  showTimestamp: boolean;
  botAvatarShape: AvatarShape;
  userAvatarShape: AvatarShape;
  botAvatarUrl: string | undefined;
  userAvatarUrl: string | undefined;
  botAvatarType: string | undefined;
  userAvatarType: string | undefined;
} {
  if (!theme) return { showTimestamp: false, botAvatarShape: 'circle', userAvatarShape: 'circle', botAvatarUrl: undefined, userAvatarUrl: undefined, botAvatarType: undefined, userAvatarType: undefined };

  const timestamps = theme.timestamps as Record<string, unknown> | undefined;
  const showTimestamp = timestamps?.show === true;

  const botAvatar = theme.botAvatar as Record<string, unknown> | undefined;
  const userAvatar = theme.userAvatar as Record<string, unknown> | undefined;
  const botAvatarShape = parseShape(botAvatar?.shape);
  const userAvatarShape = parseShape(userAvatar?.shape);

  const botAvatarType = typeof botAvatar?.type === 'string' ? botAvatar.type : undefined;
  const userAvatarType = typeof userAvatar?.type === 'string' ? userAvatar.type : undefined;

  const botAvatarUrl = botAvatarType === 'custom' ? safeUrl(botAvatar?.customImageUrl) : undefined;
  const userAvatarUrl = userAvatarType === 'custom' ? safeUrl(userAvatar?.customImageUrl) : undefined;

  return { showTimestamp, botAvatarShape, userAvatarShape, botAvatarUrl, userAvatarUrl, botAvatarType, userAvatarType };
}

/** Chat window — the expanded chat interface */
export function ChatWindow({
  agentId,
  agentConfig,
  theme,
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

  // Read store signals
  const state = widgetState.value;
  const isMinimized = state === 'minimized';
  const loading = isLoading.value;
  const streaming = isStreaming.value;
  const rateLimited = isRateLimited.value;
  const chatError = errorSignal.value;

  // Chat actions from hook (streaming orchestration)
  const {
    sendMessage, stopStream, clearError, handleTimeout,
    addUserMessage, createBotMessage, appendBotMessageText, finalizeBotMessage, setVoiceLoading,
  } = useChat({ agentId });

  const chatConfig = extractChatConfig(theme);

  // Branding configuration from theme (Story 5-23)
  const brandingConfig = useMemo<BrandingFooterProps>(() => {
    const branding = (theme as Record<string, unknown> | null)?.branding as Record<string, unknown> | undefined;
    return {
      enabled: branding?.enabled === true,
      textPrefix: typeof branding?.textPrefix === 'string' ? branding.textPrefix : 'Powered by',
      useLogo: branding?.useLogo === true,
      logo: typeof branding?.logo === 'string' ? branding.logo : '',
      linkText: typeof branding?.linkText === 'string' ? branding.linkText : '',
      linkUrl: typeof branding?.linkUrl === 'string' ? branding.linkUrl : '',
      textColor: typeof branding?.textColor === 'string' ? branding.textColor : '',
      linkColor: typeof branding?.linkColor === 'string' ? branding.linkColor : '',
    };
  }, [theme]);

  // Voice configuration from theme (Story 5-20)
  const voiceConfig = useMemo(() => {
    return {
      enabled: agentConfig.voiceEnabled === true,
      language: agentConfig.voiceConfig?.defaultLanguage,
      autoPlay: true,
    };
  }, [agentConfig.voiceEnabled, agentConfig.voiceConfig]);

  // Typewriter buffer for progressive text display
  const typewriterBufferRef = useRef('');
  const typewriterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceBotMsgIdRef = useRef<string | null>(null);

  const TYPEWRITER_MS = 12;
  const TYPEWRITER_CHARS = 2;

  const stopTypewriter = useCallback(() => {
    if (typewriterIntervalRef.current) {
      clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
  }, []);

  const flushTypewriter = useCallback(() => {
    stopTypewriter();
    if (voiceBotMsgIdRef.current && typewriterBufferRef.current) {
      appendBotMessageText(voiceBotMsgIdRef.current, typewriterBufferRef.current);
      typewriterBufferRef.current = '';
    }
  }, [stopTypewriter, appendBotMessageText]);

  const startTypewriter = useCallback(() => {
    if (typewriterIntervalRef.current) return;
    typewriterIntervalRef.current = setInterval(() => {
      if (!typewriterBufferRef.current || !voiceBotMsgIdRef.current) return;
      const chars = typewriterBufferRef.current.slice(0, TYPEWRITER_CHARS);
      typewriterBufferRef.current = typewriterBufferRef.current.slice(TYPEWRITER_CHARS);
      if (chars) {
        appendBotMessageText(voiceBotMsgIdRef.current, chars);
      }
      if (!typewriterBufferRef.current) {
        stopTypewriter();
      }
    }, TYPEWRITER_MS);
  }, [appendBotMessageText, stopTypewriter]);

  // Voice hook
  const {
    voiceState,
    isSupported: voiceIsSupported,
    recordingDurationMs,
    error: voiceError,
    errorCode: voiceErrorCode,
    startRecording,
    cancelRecording,
    stopRecording,
    stopPlayback,
    clearError: clearVoiceError,
  } = useVoice({
    agentId,
    voiceEnabled: voiceConfig.enabled,
    voiceLanguage: voiceConfig.language,
    voiceAutoPlay: voiceConfig.autoPlay,
    onTranscription: useCallback((text: string) => {
      addUserMessage(text);
      setVoiceLoading(true);
    }, [addUserMessage, setVoiceLoading]),
    onAudioSentence: useCallback((text: string, sentenceIndex: number) => {
      if (sentenceIndex === 0) {
        const id = createBotMessage();
        voiceBotMsgIdRef.current = id;
        typewriterBufferRef.current = text;
        startTypewriter();
        setVoiceLoading(false);
      } else {
        typewriterBufferRef.current += ' ' + text;
        startTypewriter();
      }
    }, [createBotMessage, startTypewriter, setVoiceLoading]),
    onComplete: useCallback((fullText: string) => {
      flushTypewriter();
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current, fullText);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [flushTypewriter, finalizeBotMessage, setVoiceLoading]),
    onError: useCallback(() => {
      flushTypewriter();
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [flushTypewriter, finalizeBotMessage, setVoiceLoading]),
  });

  // Cleanup typewriter interval on unmount
  useEffect(() => {
    return () => {
      stopTypewriter();
    };
  }, [stopTypewriter]);

  const showVoice = voiceConfig.enabled && voiceIsSupported;
  const isVoiceActive = voiceState !== 'idle';

  const handleCancelRecording = useCallback(() => {
    cancelRecording();
  }, [cancelRecording]);

  // Conversation starters
  const starterItems = useMemo<StarterItem[]>(
    () =>
      (agentConfig.starters ?? [])
        .filter((s) => s.trim().length > 0)
        .map((s) => ({ message: s })),
    [agentConfig.starters],
  );

  const handleStarterSelect = useCallback(
    (message: string) => {
      sendMessage(message);
    },
    [sendMessage],
  );

  const handleTypingTimeout = useCallback(() => {
    handleTimeout();
  }, [handleTimeout]);

  // Input disabled when loading/streaming, rate limited, or voice active
  const inputDisabled = loading || streaming || rateLimited || isVoiceActive;
  const themePlaceholder = useMemo(() => {
    const input = theme?.input as Record<string, unknown> | undefined;
    const text = typeof input?.placeholderText === 'string' ? input.placeholderText.trim() : '';
    return text || undefined;
  }, [theme]);
  const inputPlaceholder = rateLimited ? 'Please wait...' : themePlaceholder;

  // Widget state handlers (write directly to store)
  const handleClose = useCallback(() => {
    widgetState.value = 'closed';
  }, []);

  const handleMinimize = useCallback(() => {
    widgetState.value = 'minimized';
  }, []);

  const handleExpand = useCallback(() => {
    widgetState.value = 'expanded';
  }, []);

  // Open animation + auto-focus input after animation
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimating(false);
      inputRef.current?.focus();
    }, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  // Reactive mobile detection via resize listener
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
      headerRef.current?.focus();
    } else if (wasMinimizedRef.current) {
      wasMinimizedRef.current = false;
      const el = windowRef.current;
      if (el) {
        el.classList.add('cw-chat-window--expanding');
        const onEnd = () => {
          el.classList.remove('cw-chat-window--expanding');
          el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd, { once: true });
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

  /** Handle header click to expand from minimized */
  const handleHeaderClick = useCallback(
    (e: MouseEvent) => {
      if (!isMinimized) return;
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      handleExpand();
    },
    [isMinimized, handleExpand],
  );

  /** Handle header keyboard to toggle minimized */
  const handleHeaderKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isMinimized) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleExpand();
      }
    },
    [isMinimized, handleExpand],
  );

  // Escape key closes; Tab focus trap
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMinimized) return;
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === 'Tab') {
        const container = windowRef.current;
        if (!container) return;

        const scope = isMinimized
          ? container.querySelector('.cw-chat-header')
          : container;
        if (!scope) return;

        const focusableSelector =
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          scope.querySelectorAll<HTMLElement>(focusableSelector),
        );

        if (focusables.length === 0) return;

        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;

        let active: HTMLElement | null = (container.getRootNode() as ShadowRoot | Document).activeElement as HTMLElement | null;
        while (active?.shadowRoot?.activeElement) {
          active = active.shadowRoot.activeElement as HTMLElement;
        }

        if (e.shiftKey) {
          if (active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [handleClose, isMinimized],
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

  // Voice recorder slot for ChatInput
  const voiceSlot = showVoice ? (
    <VoiceRecorder
      voiceState={voiceState}
      recordingDurationMs={recordingDurationMs}
      onStartRecording={startRecording}
      onStopRecording={stopRecording}
      onStopPlayback={stopPlayback}
      onCancelRecording={handleCancelRecording}
      disabled={loading || streaming || rateLimited}
    />
  ) : undefined;

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
        onMinimize={handleMinimize}
        onClose={handleClose}
        onHeaderClick={handleHeaderClick}
        onHeaderKeyDown={handleHeaderKeyDown}
      />
      <div class="cw-chat-body">
        <MessageArea
          showTimestamp={chatConfig.showTimestamp}
          botAvatarShape={chatConfig.botAvatarShape}
          userAvatarShape={chatConfig.userAvatarShape}
          botAvatarUrl={chatConfig.botAvatarUrl}
          userAvatarUrl={chatConfig.userAvatarUrl}
          botAvatarType={chatConfig.botAvatarType}
          userAvatarType={chatConfig.userAvatarType}
          greeting={agentConfig.greeting}
          onTypingTimeout={handleTypingTimeout}
        />
        {starterItems.length > 0 && (
          <ConversationStarters
            starters={starterItems}
            onSelect={handleStarterSelect}
          />
        )}
        {voiceError && (
          <VoiceErrorBanner
            message={voiceError}
            severity={getErrorSeverity(voiceErrorCode)}
            onDismiss={clearVoiceError}
          />
        )}
        <ChatInput
          ref={inputRef}
          onSend={sendMessage}
          disabled={inputDisabled}
          placeholder={inputPlaceholder}
          isStreaming={streaming}
          onStop={stopStream}
          voiceSlot={voiceSlot}
        />
        <BrandingFooter {...brandingConfig} />
        {chatError && (
          <div class="cw-chat-error" role="alert" aria-live="assertive">
            <span class="cw-chat-error-text">{chatError}</span>
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
