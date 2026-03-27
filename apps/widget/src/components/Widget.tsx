import { useEffect, useRef } from 'preact/hooks';
import type { LoadedWidgetConfig } from '../types';
import { ChatWindow } from './ChatWindow';
import { TriggerButton } from './TriggerButton';
import { BubbleNotification } from './BubbleNotification';
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
        if (!cancelled && !blocked) revealWidget();
      });

    return () => {
      cancelled = true;
      teardownPreviewMode();
    };
  }, [agentId, apiBaseUrl, hostElement]);

  // Read store signal for widget state
  const state = widgetState.value;
  const currentConfig = config.value;

  if (configError.value) {
    return (
      <div class="cw-widget">
        <div class="cw-config-error" style={{ pointerEvents: 'auto' }}>
          Widget unavailable
        </div>
      </div>
    );
  }

  if (domainBlocked.value) {
    return (
      <div class="cw-widget">
        <div class="cw-domain-error">
          This widget is not authorized for this domain
        </div>
      </div>
    );
  }

  if (!currentConfig) return null;

  const themeObj = currentConfig.theme as Record<string, unknown> | null;
  const iconConfig = extractIconConfig(themeObj);
  const bubbleConfig = extractBubbleConfig(themeObj);

  return (
    <div class="cw-widget" data-position={iconConfig.position}>
      {state === 'closed' ? (
        <>
          <BubbleNotification
            agentId={agentId}
            bubbleConfig={bubbleConfig}
            isOpen={false}
            onOpen={handleOpen}
          />
          <TriggerButton
            onClick={handleOpen}
            iconCustomImage={iconConfig.customImage}
            pulse={iconConfig.pulse}
          />
        </>
      ) : (
        <ChatWindow
          agentId={agentId}
          agentConfig={currentConfig.agent}
          theme={themeObj}
          position={iconConfig.position}
        />
      )}
    </div>
  );
}
