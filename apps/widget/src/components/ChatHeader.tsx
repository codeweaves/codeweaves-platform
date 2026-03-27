import { useState } from 'preact/hooks';
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
  subtitle: string;
  logoUrl: string;
} {
  if (!theme) return { subtitle: '', logoUrl: '' };

  const header = theme.header as Record<string, unknown> | undefined;
  const subtitle =
    typeof header?.subtitle === 'string' ? header.subtitle.trim() : '';
  const rawLogoUrl =
    typeof header?.logoUrl === 'string' ? header.logoUrl.trim() : '';
  const logoUrl = rawLogoUrl && isSafeUrl(rawLogoUrl) ? rawLogoUrl : '';

  return { subtitle, logoUrl };
}

/** First-letter avatar fallback when no logo is provided */
function LetterAvatar({ name }: { name: string }) {
  const letter = name.charAt(0).toUpperCase() || '?';
  return (
    <div class="cw-header-avatar" aria-hidden="true">
      {letter}
    </div>
  );
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
    const { subtitle, logoUrl } = getHeaderFields(theme);
    const [logoFailed, setLogoFailed] = useState(false);

    const showLogo = logoUrl && !logoFailed;

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
          {showLogo ? (
            <img
              class="cw-header-logo"
              src={logoUrl}
              alt=""
              aria-hidden="true"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <LetterAvatar name={agentConfig.name} />
          )}
          <div class="cw-header-text">
            <span class="cw-header-name">{agentConfig.name}</span>
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
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="M3 8h10" />
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
