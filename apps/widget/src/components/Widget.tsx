import { useState, useEffect, useRef } from 'preact/hooks';
import type { WidgetState, LoadedWidgetConfig } from '../types';
import { ChatWindow } from './ChatWindow';
import { TriggerButton } from './TriggerButton';
import { BubbleNotification } from './BubbleNotification';
import { loadConfig } from '../services/config-loader';
import { applyTheme, setupPreviewMode, teardownPreviewMode } from '../services/theme-engine';
import { revealWidget } from '../shadow-dom';
import { debug, warn } from '../utils/debug';

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

/** Main widget container — renders trigger button and conditionally renders chat window */
export function Widget({ agentId, apiBaseUrl = '', hostElement }: WidgetProps) {
  const [state, setState] = useState<WidgetState>('minimized');
  const [config, setConfig] = useState<LoadedWidgetConfig | null>(null);
  const [configError, setConfigError] = useState(false);

  const handleOpen = () => setState('open');
  const handleClose = () => setState('minimized');

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

    loadConfig(agentId, apiBaseUrl)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          debug('Config loaded for agent:', agentId);

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
        if (!cancelled) revealWidget();
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

  // Don't render interactive UI until config is loaded
  if (!config) return null;

  const iconConfig = extractIconConfig(config.theme as Record<string, unknown> | null);

  return (
    <div class="cw-widget" data-position={iconConfig.position}>
      {state === 'open' ? (
        <ChatWindow onClose={handleClose} />
      ) : (
        <>
          <BubbleNotification />
          <TriggerButton
            onClick={handleOpen}
            iconCustomImage={iconConfig.customImage}
            pulse={iconConfig.pulse}
          />
        </>
      )}
    </div>
  );
}
