import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { LoadedWidgetConfig } from '../types';
import { ChatWidgetSurface } from './ChatWidgetSurface';
import { MessageCircleIcon, XIcon } from './icons';
import { loadConfig } from '../services/config-loader';
import { applyTheme, setupPreviewMode, teardownPreviewMode } from '../services/theme-engine';
import { revealWidget } from '../shadow-dom';
import { isDomainAllowed } from '../utils/domain-validator';
import { debug, warn } from '../utils/debug';
import { initApiClient } from '../services/api-client';
import { initVoiceClient } from '../services/voice-client';
import { initSession, getSessionId } from '../services/session-manager';
import {
  widgetState,
  setStarterCount,
  initPersistence,
  restoreMessages,
  resetStore,
} from '../state/chat-store';
import { signal } from '@preact/signals';

/** Callback registration for external control (global API) */
let externalOpenFn: (() => void) | null = null;
let externalCloseFn: (() => void) | null = null;

export function registerWidgetControls(open: () => void, close: () => void): void {
  externalOpenFn = open;
  externalCloseFn = close;
}

export function unregisterWidgetControls(): void {
  externalOpenFn = null;
  externalCloseFn = null;
}

export function triggerOpen(): void {
  externalOpenFn?.();
}

export function triggerClose(): void {
  externalCloseFn?.();
}

interface WidgetProps {
  agentId: string;
  apiBaseUrl?: string;
  hostElement?: HTMLElement;
}

/** Extract icon-specific config from theme object */
function extractIconConfig(theme: Record<string, unknown> | null): {
  position: 'left' | 'right';
  customImage: string | undefined;
  pulse: boolean;
} {
  if (!theme) return { position: 'right', customImage: undefined, pulse: false };

  const icon = theme.icon as Record<string, unknown> | undefined;
  const position = icon?.position === 'left' ? 'left' : 'right';
  const rawUrl = icon?.customImageUrl;
  const customImage =
    typeof rawUrl === 'string' && rawUrl.trim()
      ? rawUrl.trim()
      : undefined;
  const pulse = icon?.pulse === true;

  return { position, customImage, pulse };
}

/** Extract bubble notification config from theme object */
function extractBubbleConfig(theme: Record<string, unknown> | null): {
  enabled: boolean;
  text: string;
  delayMs: number;
} {
  if (!theme) return { enabled: false, text: '', delayMs: 3000 };

  const bubble = theme.bubble as Record<string, unknown> | undefined;
  if (!bubble) return { enabled: false, text: '', delayMs: 3000 };

  const text = typeof bubble.text === 'string' ? bubble.text.trim() : '';
  const enabled = bubble.enabled === true && text.length > 0;
  const delayMs = typeof bubble.delayMs === 'number' && bubble.delayMs >= 0 ? bubble.delayMs : 3000;

  return { enabled, text, delayMs };
}

// Local signals for non-store config state (not shared across components)
const config = signal<LoadedWidgetConfig | null>(null);
const configError = signal(false);
const domainBlocked = signal(false);

/** Singleton guard — store signals are module-level, only one Widget instance is supported */
let widgetMounted = false;

/** Main widget container — renders trigger button and conditionally renders chat window */
export function Widget({ agentId, apiBaseUrl = '', hostElement }: WidgetProps) {
  const handleOpen = () => { widgetState.value = 'expanded'; };
  const handleClose = () => { widgetState.value = 'closed'; };

  // Use refs so registered callbacks always point to latest handlers
  const openRef = useRef(handleOpen);
  const closeRef = useRef(handleClose);
  openRef.current = handleOpen;
  closeRef.current = handleClose;

  useEffect(() => {
    if (widgetMounted) {
      warn('Multiple Widget instances detected — store signals are shared singletons. Only one Widget instance is supported.');
    }
    widgetMounted = true;

    registerWidgetControls(
      () => openRef.current(),
      () => closeRef.current(),
    );
    return () => {
      widgetMounted = false;
      unregisterWidgetControls();
      resetStore();
      // Reset local config signals
      config.value = null;
      configError.value = false;
      domainBlocked.value = false;
    };
  }, []);

  // Load config on mount, apply theme, init store persistence, then reveal widget
  useEffect(() => {
    let cancelled = false;
    let blocked = false;

    loadConfig(agentId, apiBaseUrl)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          debug('Config loaded for agent:', agentId);

          // Domain validation
          const hostname = window.location.hostname;
          const allowed = isDomainAllowed(hostname, result.allowedDomains ?? []);
          if (!allowed) {
            debug(`Domain "${hostname}" is not in the allowed domains list for agent "${agentId}"`);
            blocked = true;
            domainBlocked.value = true;
            return;
          }

          // Initialize services
          initApiClient(apiBaseUrl);
          initVoiceClient(apiBaseUrl);
          initSession(agentId);

          // Initialize store persistence and restore messages (Story 5-21)
          initPersistence(agentId);
          restoreMessages(agentId, getSessionId());

          // Set starter count for showStarters computed
          const starters = result.agent.starters ?? [];
          setStarterCount(starters.filter((s) => s.trim().length > 0).length);

          // Apply theme before widget becomes visible
          if (hostElement && result.theme) {
            applyTheme(hostElement, result.theme as Record<string, unknown>);
          }

          // Setup preview mode listener
          if (hostElement) {
            setupPreviewMode(hostElement, result.allowedDomains ?? []);
          }

          config.value = result;
        } else {
          warn('No config available for agent:', agentId);
          configError.value = true;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        warn('Config loading failed:', err);
        configError.value = true;
      })
      .finally(() => {
        // Only reveal when config actually loaded and domain is allowed.
        // On failure/block, leave the host element invisible — nothing shows
        // on the customer's site.
        if (!cancelled && !blocked && !configError.value) revealWidget();
      });

    return () => {
      cancelled = true;
      teardownPreviewMode();
    };
  }, [agentId, apiBaseUrl, hostElement]);

  // Read store signal for widget state
  const state = widgetState.value;
  const currentConfig = config.value;

  // Hooks must be called unconditionally (before any early returns)
  const [showBubble, setShowBubble] = useState(false);
  const bubbleDismissed = useRef(false);

  // Body scroll lock + iOS keyboard handling when widget is expanded on mobile
  useEffect(() => {
    if (state !== 'expanded') return;
    const isMobile = window.matchMedia('(max-width: 480px)').matches;
    if (!isMobile) return;

    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    // iOS keyboard handling via VisualViewport
    const vv = window.visualViewport;
    const handleViewportResize = () => {
      if (!vv || !hostElement) return;
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height);
      hostElement.style.setProperty('--cw-keyboard-height', `${keyboardHeight}px`);
    };
    vv?.addEventListener('resize', handleViewportResize);
    handleViewportResize();

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
      vv?.removeEventListener('resize', handleViewportResize);
      hostElement?.style.removeProperty('--cw-keyboard-height');
    };
  }, [state, hostElement]);

  const themeObj = currentConfig?.theme as Record<string, unknown> | null ?? null;
  const bubbleConfig = extractBubbleConfig(themeObj);

  useEffect(() => {
    if (!bubbleConfig.enabled || state !== 'closed' || bubbleDismissed.current) return;
    const t = setTimeout(() => setShowBubble(true), bubbleConfig.delayMs);
    return () => clearTimeout(t);
  }, [bubbleConfig.enabled, bubbleConfig.delayMs, state]);

  useEffect(() => {
    if (state !== 'closed') setShowBubble(false);
  }, [state]);

  const dismissBubble = useCallback((e?: MouseEvent) => {
    e?.stopPropagation();
    bubbleDismissed.current = true;
    setShowBubble(false);
  }, []);

  // If config can't load (API down, 404, network error) or domain is not
  // authorized — render nothing so the customer's site stays clean. We also
  // avoid calling revealWidget() in these branches so the host element stays
  // invisible.
  if (configError.value || domainBlocked.value) return null;

  if (!currentConfig) return null;

  const iconConfig = extractIconConfig(themeObj);
  const iconOnRight = iconConfig.position === 'right';

  // Icon theme
  const iconTheme = themeObj?.icon as Record<string, unknown> | undefined;
  const iconBg = typeof iconTheme?.backgroundColor === 'string' ? iconTheme.backgroundColor : '#3b82f6';
  const iconRadius = typeof iconTheme?.borderRadius === 'number' ? iconTheme.borderRadius : 50;
  const iconSize = typeof iconTheme?.size === 'number' ? iconTheme.size : 60;
  const iconShadow = typeof iconTheme?.shadow === 'string' ? iconTheme.shadow : '0 4px 12px rgba(0,0,0,0.15)';

  // Bubble theme
  const bubbleTheme = themeObj?.bubble as Record<string, unknown> | undefined;
  const bubbleBg = typeof bubbleTheme?.backgroundColor === 'string' ? bubbleTheme.backgroundColor : '#ffffff';
  const bubbleTextColor = typeof bubbleTheme?.textColor === 'string' ? bubbleTheme.textColor : '#1f2937';

  return (
    <div
      class="cw-widget-root pointer-events-none"
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '14px',
        lineHeight: '1.5',
        color: '#1f2937',
        textTransform: 'none',
        textDecoration: 'none',
        fontWeight: '400',
        fontStyle: 'normal',
        letterSpacing: 'normal',
        wordSpacing: 'normal',
        textShadow: 'none',
        zIndex: 2147483647,
      }}
    >
      {/* Bubble notification */}
      {showBubble && state === 'closed' && (
        <div
          class={`cw-bubble pointer-events-auto absolute ${iconOnRight ? 'bottom-22 right-5' : 'bottom-22 left-5'} z-10 max-w-xs cursor-pointer rounded-2xl px-4 py-3 shadow-lg transition-all duration-300 hover:scale-105`}
          style={{
            backgroundColor: bubbleBg,
            color: bubbleTextColor,
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
          }}
          onClick={() => { dismissBubble(); handleOpen(); }}
        >
          <div class="cw-bubble-content">
            <span class="cw-bubble-text text-sm font-medium leading-snug">{bubbleConfig.text}</span>
          </div>
          <button
            onClick={(e) => dismissBubble(e as unknown as MouseEvent)}
            class="cw-bubble-close"
            type="button"
            aria-label="Dismiss"
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              backgroundColor: bubbleBg,
              border: 'none',
              color: bubbleTextColor,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <XIcon class="block h-3 w-3" />
          </button>
          <div
            class={`cw-bubble-arrow absolute -bottom-2 h-0 w-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent ${iconOnRight ? 'right-6' : 'left-6'}`}
            style={{ borderTopColor: bubbleBg }}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Trigger icon */}
      {state === 'closed' && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open chat widget"
          class={`cw-launcher pointer-events-auto absolute ${iconOnRight ? 'bottom-5 right-5' : 'bottom-5 left-5'} z-20 flex cursor-pointer items-center justify-center transition-all duration-300 hover:scale-110`}
          style={{
            backgroundColor: iconBg,
            borderRadius: `${iconRadius}%`,
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            boxShadow: iconShadow,
          }}
          onClick={handleOpen}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
        >
          {iconConfig.customImage ? (
            <img src={iconConfig.customImage} alt="Chat" class="cw-launcher-image h-3/5 w-3/5 rounded-full object-cover" />
          ) : (
            <MessageCircleIcon class="cw-launcher-icon h-7 w-7 text-white" />
          )}
        </div>
      )}

      {/* Expanded chat */}
      {state !== 'closed' && (
        <ChatWidgetSurface
          agentId={agentId}
          agentConfig={currentConfig.agent}
          theme={themeObj}
          position={iconConfig.position}
        />
      )}
    </div>
  );
}
