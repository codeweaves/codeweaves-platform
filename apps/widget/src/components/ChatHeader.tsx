import { useState, useEffect } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import type { AgentConfig } from '../types';
import { isSafeUrl } from '../utils/url';

export interface ChatHeaderProps {
  /** Agent configuration with name */
  agentConfig: AgentConfig;
  /** Theme object for header subtitle and logo */
  theme: Record<string, unknown> | null;
  /** Whether the window is in minimized state */
  isMinimized: boolean;
  /** Called when minimize button is clicked */
  onMinimize: () => void;
  /** Called when close button is clicked */
  onClose: () => void;
  /** Called when header area is clicked (for expand from minimized) */
  onHeaderClick: (e: MouseEvent) => void;
  /** Called on keydown on the header (for expand from minimized) */
  onHeaderKeyDown: (e: KeyboardEvent) => void;
}

/** Extract header-specific fields from theme */
function getHeaderFields(theme: Record<string, unknown> | null): {
  title: string;
  subtitle: string;
  logoUrl: string;
  showLogo: boolean;
} {
  if (!theme) return { title: '', subtitle: '', logoUrl: '', showLogo: false };

  const header = theme.header as Record<string, unknown> | undefined;
  const title =
    typeof header?.title === 'string' ? header.title.trim() : '';
  const subtitle =
    typeof header?.subtitle === 'string' ? header.subtitle.trim() : '';
  const rawLogoUrl =
    typeof header?.logoUrl === 'string' ? header.logoUrl.trim() : '';
  const logoUrl = rawLogoUrl && isSafeUrl(rawLogoUrl) ? rawLogoUrl : '';
  const showLogo = header?.showLogo === true;

  return { title, subtitle, logoUrl, showLogo };
}

/** Chat window header — displays agent info and window controls */
export const ChatHeader = forwardRef<HTMLDivElement, ChatHeaderProps>(
  function ChatHeader(
    {
      agentConfig,
      theme,
      isMinimized,
      onMinimize,
      onClose,
      onHeaderClick,
      onHeaderKeyDown,
    },
    ref,
  ) {
    const { title: themeTitle, subtitle, logoUrl, showLogo: showLogoConfig } = getHeaderFields(theme);
    const [logoFailed, setLogoFailed] = useState(false);

    // Reset failure state when the logo URL changes (e.g. theme update)
    useEffect(() => { setLogoFailed(false); }, [logoUrl]);

    const showLogo = showLogoConfig && logoUrl && !logoFailed;

    return (
      <div
        ref={ref}
        class="cw-chat-header"
        role={isMinimized ? 'button' : undefined}
        tabIndex={isMinimized ? 0 : undefined}
        aria-expanded={!isMinimized}
        aria-label={isMinimized ? `Expand chat with ${agentConfig.name}` : undefined}
        onClick={onHeaderClick}
        onKeyDown={onHeaderKeyDown}
        style={isMinimized ? { cursor: 'pointer' } : undefined}
      >
        <div class="cw-header-info">
          {showLogo && (
            <img
              class="cw-header-logo"
              src={logoUrl}
              alt=""
              aria-hidden="true"
              onError={() => setLogoFailed(true)}
            />
          )}
          <div class="cw-header-text">
            <span class="cw-header-name">{themeTitle || agentConfig.name}</span>
            {subtitle && (
              <span class="cw-header-subtitle">{subtitle}</span>
            )}
          </div>
        </div>
        <div class="cw-header-actions">
          {!isMinimized && (
            <button
              class="cw-header-btn"
              onClick={onMinimize}
              aria-label="Minimize chat"
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          )}
          <button
            class="cw-header-btn"
            onClick={onClose}
            aria-label="Close chat"
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M3 3l10 10M13 3l-10 10" />
            </svg>
          </button>
        </div>
      </div>
    );
  },
);
