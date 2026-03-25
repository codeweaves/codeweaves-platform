import { useState } from 'preact/hooks';
import type { AgentConfig } from '../types';

export interface ChatHeaderProps {
  /** Agent configuration with name */
  agentConfig: AgentConfig;
  /** Theme object for header subtitle and logo */
  theme: Record<string, unknown> | null;
  /** Called when minimize button is clicked */
  onMinimize: () => void;
  /** Called when close button is clicked */
  onClose: () => void;
}

/** Only allow http/https URLs for logo — blocks javascript:, data:, etc. */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
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
export function ChatHeader({
  agentConfig,
  theme,
  onMinimize,
  onClose,
}: ChatHeaderProps) {
  const { subtitle, logoUrl } = getHeaderFields(theme);
  const [logoFailed, setLogoFailed] = useState(false);

  const showLogo = logoUrl && !logoFailed;

  return (
    <div class="cw-chat-header">
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
}
