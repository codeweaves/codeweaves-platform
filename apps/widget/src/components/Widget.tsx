import { useState, useEffect, useRef } from 'preact/hooks';
import type { WidgetState, LoadedWidgetConfig } from '../types';
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
import { initSession } from '../services/session-manager';

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

/** Main widget container — renders trigger button and conditionally renders chat window */
export function Widget({ agentId, apiBaseUrl = '', hostElement }: WidgetProps) {
  const [state, setState] = useState<WidgetState>('closed');
  const [config, setConfig] = useState<LoadedWidgetConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [domainBlocked, setDomainBlocked] = useState(false);

  const handleOpen = () => setState('expanded');
  const handleClose = () => setState('closed');
  const handleMinimize = () => setState('minimized');
  const handleExpand = () => setState('expanded');

  // Use refs so registered callbacks always point to latest handlers
  const openRef = useRef(handleOpen);
  const closeRef = useRef(handleClose);
  openRef.current = handleOpen;
  closeRef.current = handleClose;

  useEffect(() => {
    registerWidgetControls(
      () => openRef.current(),
      () => closeRef.current(),
    );
    return () => unregisterWidgetControls();
  }, []);

  // Load config on mount, apply theme, then reveal widget
  useEffect(() => {
    let cancelled = false;
    let blocked = false;

    loadConfig(agentId, apiBaseUrl)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          debug('Config loaded for agent:', agentId);

          // Domain validation: check before rendering full widget (AC #1, #2, #3, #4)
          const hostname = window.location.hostname;
          const allowed = isDomainAllowed(hostname, result.allowedDomains ?? []);
          if (!allowed) {
            debug(`Domain "${hostname}" is not in the allowed domains list for agent "${agentId}"`);
            blocked = true;
            setDomainBlocked(true);
            return;
          }

          // Initialize API client, voice client, and session manager (Story 5-18, 5-20)
          initApiClient(apiBaseUrl);
          initVoiceClient(apiBaseUrl);
          initSession(agentId);

          // Apply theme before widget becomes visible (before opacity transition)
          if (hostElement && result.theme) {
            applyTheme(hostElement, result.theme as Record<string, unknown>);
          }

          // Setup preview mode listener (only activates if data-preview="true")
          if (hostElement) {
            setupPreviewMode(hostElement, result.allowedDomains ?? []);
          }

          setConfig(result);
        } else {
          warn('No config available for agent:', agentId);
          setConfigError(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        warn('Config loading failed:', err);
        setConfigError(true);
      })
      .finally(() => {
        if (!cancelled && !blocked) revealWidget();
      });

    return () => {
      cancelled = true;
      teardownPreviewMode();
    };
  }, [agentId, apiBaseUrl, hostElement]);

  if (configError) {
    return (
      <div class="cw-widget">
        <div class="cw-config-error" style={{ pointerEvents: 'auto' }}>
          Widget unavailable
        </div>
      </div>
    );
  }

  // Unauthorized domain — render minimal error, do not initialize chat (AC #4)
  if (domainBlocked) {
    return (
      <div class="cw-widget">
        <div class="cw-domain-error">
          This widget is not authorized for this domain
        </div>
      </div>
    );
  }

  // Don't render interactive UI until config is loaded
  if (!config) return null;

  const themeObj = config.theme as Record<string, unknown> | null;
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
          agentConfig={config.agent}
          theme={themeObj}
          onClose={handleClose}
          onMinimize={handleMinimize}
          onExpand={handleExpand}
          isMinimized={state === 'minimized'}
          position={iconConfig.position}
        />
      )}
    </div>
  );
}
